/**
 * 图床迁移单测：双向迁移、引用改写、失败保留原状与去重。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOB_URL_SCHEME, saveBlob } from "@/data/blobStore";
import { LocalDataSource } from "@/data/local";
import {
  __resetImageHostThrottle,
  __setUploadTransport,
  type UploadResponse,
  type UploadTransport,
} from "@/data/imageHost";
import {
  extractExternalImageUrls,
  migrateHostImagesToLocal,
  migrateLocalImagesToHost,
} from "@/data/imageMigration";
import { makeBlob, makeNote } from "@/test/factories";

const ds = new LocalDataSource();

/** jsdom 的 FormData 不接受 Node 原生 File；上传路径用最小替身。 */
class FakeFormData {
  private readonly fields = new Map<string, unknown>();
  append(key: string, value: unknown): void {
    this.fields.set(key, value);
  }
  get(key: string): unknown {
    return this.fields.get(key) ?? null;
  }
}

function stubFormData(): void {
  vi.stubGlobal("FormData", FakeFormData);
}

function uploadResponse(url: string): UploadResponse {
  return {
    ok: true,
    status: 200,
    header: () => null,
    json: async () => ({ success: true, data: { url } }),
  };
}

function useTransport(handler: UploadTransport) {
  const mock = vi.fn(handler);
  __setUploadTransport(mock);
  return mock;
}

function remoteImage(bytes = "image-bytes", type = "image/png"): Response {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([bytes], { type }),
  } as unknown as Response;
}

beforeEach(() => {
  __resetImageHostThrottle();
});

afterEach(() => {
  __setUploadTransport(null);
  vi.unstubAllGlobals();
});

describe("extractExternalImageUrls", () => {
  it("提取 Markdown 内联图片与 HTML img，去重并忽略非 http 地址", () => {
    const content = [
      "![a](https://img.example/a.png)",
      "![b](https://img.example/a.png)",
      '<img src="https://img.example/b.webp" alt="x">',
      "![c](clawclip://blob/abc)",
      "![d](./local.png)",
    ].join("\n");
    expect(extractExternalImageUrls(content).sort()).toEqual([
      "https://img.example/a.png",
      "https://img.example/b.webp",
    ]);
  });
});

describe("migrateLocalImagesToHost", () => {
  it("上传本地图片并把所有引用（含共享）替换为外链，成功后回收 blob", async () => {
    stubFormData();
    useTransport(async (_form, options) => {
      options.onProgress?.(100, 100);
      return uploadResponse("https://img.cdn1.vip/i/a.webp");
    });

    const blobId = await ds.saveAttachment("note-a", makeBlob("png-bytes", "image/png"));
    const ref = `${BLOB_URL_SCHEME}${blobId}`;
    await ds.upsertNote(makeNote({ id: "note-a", title: "A", content: `![x](${ref})` }));
    await ds.upsertNote(makeNote({ id: "note-b", title: "B", content: `![x](${ref})` }));

    const result = await migrateLocalImagesToHost();
    expect(result).toMatchObject({ migrated: 1, failed: 0 });

    const a = await ds.getNote("note-a");
    const b = await ds.getNote("note-b");
    expect(a!.content).toContain("https://img.cdn1.vip/i/a.webp");
    expect(b!.content).toContain("https://img.cdn1.vip/i/a.webp");
    expect(a!.content).not.toContain("clawclip://");
    // 引用全部移除后，blob 被引用计数回收
    expect(await ds.getAttachment(blobId)).toBeUndefined();
  });

  it("上传失败时保留原引用与本地附件", async () => {
    stubFormData();
    useTransport(async () => ({
      ok: false,
      status: 500,
      header: () => null,
      json: async () => ({}),
    }));

    const blobId = await ds.saveAttachment("note-c", makeBlob("png-bytes", "image/png"));
    await ds.upsertNote(
      makeNote({ id: "note-c", title: "C", content: `![x](${BLOB_URL_SCHEME}${blobId})` }),
    );

    const result = await migrateLocalImagesToHost();
    expect(result.migrated).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    expect((await ds.getNote("note-c"))!.content).toContain("clawclip://");
    expect(await ds.getAttachment(blobId)).toBeDefined();
  });
});

describe("migrateHostImagesToLocal", () => {
  it("下载外链图片并在多条笔记间共享同一个 blob，重复执行不再下载", async () => {
    const fetchMock = vi.fn(async () => remoteImage());
    vi.stubGlobal("fetch", fetchMock);

    const url = "https://img.example/a.png";
    await ds.upsertNote(makeNote({ id: "note-d", title: "D", content: `![x](${url})` }));
    await ds.upsertNote(makeNote({ id: "note-e", title: "E", content: `![y](${url})` }));

    const result = await migrateHostImagesToLocal();
    expect(result).toMatchObject({ migrated: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const d = await ds.getNote("note-d");
    const e = await ds.getNote("note-e");
    expect(d!.content).toContain("clawclip://blob/");
    expect(e!.content).toContain("clawclip://blob/");
    // 两条笔记引用同一个 blob
    const id = d!.content.match(/clawclip:\/\/blob\/([\w-]+)/)![1];
    expect(e!.content).toContain(`clawclip://blob/${id}`);
    expect(await ds.getAttachment(id)).toBeDefined();

    // 再跑一次：已经没有外链，不再发请求
    const again = await migrateHostImagesToLocal();
    expect(again.migrated).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("下载失败时保留原始外链", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response));
    const url = "https://img.example/blocked.png";
    await ds.upsertNote(makeNote({ id: "note-f", title: "F", content: `![x](${url})` }));

    const result = await migrateHostImagesToLocal();
    expect(result.migrated).toBe(0);
    expect(result.failed).toBe(1);
    expect((await ds.getNote("note-f"))!.content).toContain(url);
  });

  it("同一 URL 已有 sourceUrl 缓存时直接复用，不重复下载", async () => {
    const url = "https://img.example/cached.png";
    // 模拟上次中断后留下的本地副本（sourceUrl 相同）
    const cachedId = await saveBlob("note-cache", makeBlob("cached", "image/png"), {
      sourceUrl: url,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await ds.upsertNote(
      makeNote({ id: "note-cache", title: "缓存", content: `![x](${url})` }),
    );
    const result = await migrateHostImagesToLocal();

    expect(result).toMatchObject({ migrated: 1, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await ds.getNote("note-cache"))!.content).toContain(`clawclip://blob/${cachedId}`);
  });
});
