/**
 * blobStore 单测：附件存取 + object URL 生命周期 + clawclip:// hydrate。
 */
import { describe, expect, it } from "vite-plus/test";
import {
  BLOB_URL_SCHEME,
  extractBlobRefIds,
  getBlob,
  hydrateMarkdown,
  reconcileBlobRefs,
  releaseBlobUrls,
  resolveBlobUrl,
  saveBlob,
} from "@/data/blobStore";
import { globalConfig } from "@/config";
import { withTx } from "@/data/db";
import { idbReq } from "@/utils/idb";
import type { BlobRecord } from "@/types/blob";
import type { Note } from "@/types/note";
import { makeBlob, makeNote } from "@/test/factories";

const notesStore = globalConfig.storeNames.notes;
const blobsStore = globalConfig.storeNames.blobs;

/** 直接写原始记录，模拟历史版本/异常残留数据。 */
async function putRawNote(note: Note): Promise<void> {
  await withTx(notesStore, "readwrite", (tx) => {
    tx.objectStore(notesStore).put(note);
  });
}

async function readRawNote(id: string): Promise<Note | undefined> {
  return withTx<Note | undefined>(notesStore, "readonly", (tx) =>
    idbReq<Note | undefined>(tx.objectStore(notesStore).get(id)),
  );
}

async function putRawBlob(record: BlobRecord): Promise<void> {
  await withTx(blobsStore, "readwrite", (tx) => {
    tx.objectStore(blobsStore).put(record);
  });
}

describe("blobStore.saveBlob / getBlob", () => {
  it("saveBlob 返回 id，getBlob 取回记录", async () => {
    const id = await saveBlob("note-1", makeBlob("图片数据", "image/png"));
    expect(id).toBeTruthy();

    const rec = await getBlob(id);
    expect(rec).toBeDefined();
    expect(rec!.noteId).toBe("note-1");
    expect(rec!.mime).toBe("image/png");
    expect(rec!.size).toBeGreaterThan(0);
    expect(await rec!.data.text()).toBe("图片数据");
  });

  it("getBlob 不存在的 id 返回 undefined", async () => {
    expect(await getBlob("no-such-blob")).toBeUndefined();
  });
});

describe("blobStore.resolveBlobUrl（object URL + 缓存）", () => {
  it("解析为 blob: URL 且缓存复用（同一 id 多次解析返回同一 URL）", async () => {
    const id = await saveBlob("note-2", makeBlob("data", "image/png"));
    const url1 = await resolveBlobUrl(id);
    const url2 = await resolveBlobUrl(id);

    expect(url1).toMatch(/^blob:mock\//);
    expect(url1).toBe(url2); // ★ 缓存命中，同一 URL
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1); // ★ 只创建一次
  });

  it("悬空引用（blob 不存在）返回空串", async () => {
    expect(await resolveBlobUrl("dangling-id")).toBe("");
  });
});

describe("blobStore.hydrateMarkdown（clawclip:// → object URL）", () => {
  it("把正文里的 clawclip://blob/<id> 批量替换成 object URL", async () => {
    const id1 = await saveBlob("n", makeBlob("a", "image/png"));
    const id2 = await saveBlob("n", makeBlob("b", "image/png"));

    const md = `# 标题\n\n![图1](${BLOB_URL_SCHEME}${id1})\n\n![图2](${BLOB_URL_SCHEME}${id2})`;
    const hydrated = await hydrateMarkdown(md);

    expect(hydrated).not.toContain("clawclip://"); // 协议引用全被替换
    expect(hydrated).toContain("blob:mock/");
    expect(hydrated).toContain("![图1](blob:mock/");
  });

  it("同一附件多处引用只建一次 URL（去重）", async () => {
    const id = await saveBlob("n", makeBlob("dup", "image/png"));
    const md = `![](${BLOB_URL_SCHEME}${id}) 和 ![](${BLOB_URL_SCHEME}${id})`;
    const hydrated = await hydrateMarkdown(md);

    // 两处替换成同一个 URL
    const urls = hydrated.match(/blob:mock\/\d+/g) ?? [];
    expect(urls[0]).toBe(urls[1]);
  });

  it("悬空引用替换为空串", async () => {
    const md = `![坏图](${BLOB_URL_SCHEME}deleted-blob-id)`;
    const hydrated = await hydrateMarkdown(md);
    expect(hydrated).toBe("![坏图]()");
  });

  it("无引用的正文原样返回", async () => {
    const md = "# 纯文本\n\n没有附件";
    expect(await hydrateMarkdown(md)).toBe(md);
  });
});

describe("blobStore.releaseBlobUrls（防泄漏）", () => {
  it("revoke 全部缓存 URL 并清空缓存", async () => {
    const id = await saveBlob("n", makeBlob("data", "image/png"));
    await resolveBlobUrl(id);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    releaseBlobUrls();
    expect(URL.revokeObjectURL).toHaveBeenCalled();

    // 释放后再解析应重新创建 URL（缓存已清）
    (URL.createObjectURL as any).mockClear();
    await resolveBlobUrl(id);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1); // ★ 重新创建
  });
});

describe("blobStore.extractBlobRefIds（正文引用提取）", () => {
  it("提取全部 clawclip://blob/<id> 并按 id 去重", () => {
    const md = `![](${BLOB_URL_SCHEME}a-1) ![](${BLOB_URL_SCHEME}b_2) ![](${BLOB_URL_SCHEME}a-1)`;
    expect(extractBlobRefIds(md).sort()).toEqual(["a-1", "b_2"]);
  });

  it("无引用正文返回空数组", () => {
    expect(extractBlobRefIds("# 纯文本\n\n没有附件")).toEqual([]);
  });
});

describe("blobStore.reconcileBlobRefs（引用计数校准 + 孤儿回收）", () => {
  it("按笔记正文回填 refCount，并删除没有任何笔记引用的 blob", async () => {
    const b1 = await saveBlob("n1", makeBlob("a", "image/png"));
    const b2 = await saveBlob("n1", makeBlob("b", "image/png")); // 孤儿
    const b3 = await saveBlob("n1", makeBlob("c", "image/png"));

    // note-a 两次引用 b1（只算 1），再引用 b3；attachmentIds 故意留空模拟陈旧索引
    await putRawNote(
      makeNote({
        id: "note-a",
        content: `![](${BLOB_URL_SCHEME}${b1}) 和 ![](${BLOB_URL_SCHEME}${b1}) ![](${BLOB_URL_SCHEME}${b3})`,
        attachmentIds: [],
      }),
    );
    // note-b 也引用 b3 → 共享附件计数 2
    await putRawNote(
      makeNote({ id: "note-b", content: `![](${BLOB_URL_SCHEME}${b3})`, attachmentIds: [] }),
    );

    const result = await reconcileBlobRefs();

    expect((await getBlob(b1))!.refCount).toBe(1);
    expect((await getBlob(b3))!.refCount).toBe(2);
    expect(await getBlob(b2)).toBeUndefined(); // ★ 无引用 → 自动回收
    expect(result).toEqual({ kept: 2, purged: 1 });

    // 陈旧的 attachmentIds 也被修复
    expect((await readRawNote("note-a"))!.attachmentIds.sort()).toEqual([b1, b3].sort());
  });

  it("旧版本记录缺失 refCount 时按正文补回（不做数据迁移也能自愈）", async () => {
    const id = await saveBlob("n", makeBlob("legacy", "image/png"));
    const rec = (await getBlob(id))!;
    // 模拟旧版本记录：没有 refCount 字段
    const { refCount: _omit, ...legacy } = rec;
    await putRawBlob(legacy as BlobRecord);
    await putRawNote(makeNote({ id: "legacy-note", content: `![](${BLOB_URL_SCHEME}${id})` }));

    await reconcileBlobRefs();

    expect((await getBlob(id))!.refCount).toBe(1);
  });

  it("没有任何引用时全部回收（清空笔记后的残留）", async () => {
    const id = await saveBlob("n", makeBlob("orphan"));
    const res = await reconcileBlobRefs();
    expect(res.purged).toBe(1);
    expect(await getBlob(id)).toBeUndefined();
  });
});
