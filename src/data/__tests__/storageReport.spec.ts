/**
 * 存储报告单测：分解、排行、共享附件均摊、孤儿字节与配额降级。
 */
import { afterEach, describe, expect, it } from "vitest";
import { BLOB_URL_SCHEME } from "@/data/blobStore";
import { withTx } from "@/data/db";
import { LocalDataSource } from "@/data/local";
import { getDbStats } from "@/data/stats";
import { getQuotaInfo, getStorageReport } from "@/data/storageReport";
import { globalConfig } from "@/config";
import { idbReq } from "@/utils/idb";
import { makeBlob, makeNote } from "@/test/factories";

const ds = new LocalDataSource();

const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");

afterEach(() => {
  if (originalStorage) Object.defineProperty(navigator, "storage", originalStorage);
  else delete (navigator as unknown as { storage?: unknown }).storage;
});

async function seed() {
  const shared = await ds.saveAttachment("note-a", makeBlob("shared", "image/png")); // 6 字节
  const own = await ds.saveAttachment("note-a", makeBlob("own", "text/plain")); // 3 字节
  await ds.upsertNote(
    makeNote({
      id: "note-a",
      title: "A",
      content: `![s](${BLOB_URL_SCHEME}${shared})\n![o](${BLOB_URL_SCHEME}${own})`,
    }),
  );
  await ds.upsertNote(
    makeNote({ id: "note-b", title: "B", content: `![s](${BLOB_URL_SCHEME}${shared})` }),
  );
  const orphan = await ds.saveAttachment("note-a", makeBlob("orphan-bytes", "text/plain")); // 12 字节
  return { shared, own, orphan };
}

describe("getStorageReport", () => {
  it("按 store 分解，并与 getDbStats 的总量一致", async () => {
    await seed();
    const report = await getStorageReport();
    const stats = await getDbStats();

    expect(report.noteCount).toBe(2);
    expect(report.attachmentCount).toBe(3);
    expect(report.appBytes).toBe(stats.bytes);
    expect(report.stores.notes.count).toBe(2);
    expect(report.binaryBytes).toBe(6 + 3 + 12);
  });

  it("共享附件按引用笔记数均摊，附件排行不漏不重", async () => {
    const { shared } = await seed();
    const report = await getStorageReport();

    const a = report.noteRanking.find((n) => n.id === "note-a")!;
    const b = report.noteRanking.find((n) => n.id === "note-b")!;
    // note-a：shared 6/2 + own 3 = 6；note-b：shared 6/2 = 3
    expect(a.attachmentBytes).toBeCloseTo(6, 5);
    expect(b.attachmentBytes).toBeCloseTo(3, 5);
    expect(a.attachmentCount).toBe(2);
    expect(a.sharedAttachmentCount).toBe(1);

    const sharedRow = report.attachmentRanking.find((r) => r.id === shared)!;
    expect(sharedRow.shared).toBe(true);
    expect(sharedRow.ownerIds.sort()).toEqual(["note-a", "note-b"]);
    expect(sharedRow.size).toBe(6);
  });

  it("无引用附件计入 orphanBytes，且不摊进任何笔记", async () => {
    const { orphan } = await seed();
    const report = await getStorageReport();

    expect(report.orphanBytes).toBe(12);
    const row = report.attachmentRanking.find((r) => r.id === orphan)!;
    expect(row.orphan).toBe(true);
    expect(row.ownerIds).toHaveLength(0);
    expect(report.noteRanking.every((n) => n.attachmentBytes < 7)).toBe(true);
  });

  it("恒等式：Σ笔记 + 孤儿 + 文件夹 + 附件元数据 + meta = appBytes", async () => {
    await seed();
    const report = await getStorageReport();
    const noteTotal = report.noteRanking.reduce((sum, n) => sum + n.totalBytes, 0);
    const blobMeta = report.stores.blobs.bytes - report.binaryBytes;
    const total =
      noteTotal + report.orphanBytes + report.stores.folders.bytes + blobMeta + report.stores.meta.bytes;
    expect(total).toBeCloseTo(report.appBytes, 5);
  });

  it("attachmentIds 陈旧时以正文引用为准，不把附件算给错误的笔记", async () => {
    const { shared } = await seed();
    // 直接写一条「attachmentIds 声称引用、正文却没有引用」的笔记
    await withTx(globalConfig.storeNames.notes, "readwrite", (tx) =>
      idbReq(
        tx.objectStore(globalConfig.storeNames.notes).put(
          makeNote({
            id: "stale-note",
            title: "陈旧索引",
            content: "正文没有引用",
            attachmentIds: [shared],
          }),
        ),
      ),
    );

    const report = await getStorageReport();
    const row = report.attachmentRanking.find((r) => r.id === shared)!;
    expect(row.ownerIds).not.toContain("stale-note");
    const stale = report.noteRanking.find((n) => n.id === "stale-note")!;
    expect(stale.attachmentCount).toBe(0);
  });
});

describe("getQuotaInfo", () => {
  it("读取 usage / quota / persisted / indexedDB 用量", async () => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 100, quota: 1000, usageDetails: { indexedDB: 80 } }),
        persisted: async () => true,
      },
    });

    expect(await getQuotaInfo()).toEqual({
      supported: true,
      usage: 100,
      quota: 1000,
      available: 900,
      persisted: true,
      indexedDbUsage: 80,
    });
  });

  it("浏览器不提供 storage.estimate 时降级，不抛错", async () => {
    Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
    expect(await getQuotaInfo()).toEqual({
      supported: false,
      usage: null,
      quota: null,
      available: null,
      persisted: false,
      indexedDbUsage: null,
    });
  });
});
