/**
 * 云快照组装单测：图片转图床、失败回退、缓存复用与超限剔除。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BLOB_URL_SCHEME, setBlobRemoteUrl } from "@/data/blobStore";
import { CloudSyncError } from "@/data/cloudSync";
import { LocalDataSource } from "@/data/local";
import {
  __resetImageHostThrottle,
  __setUploadTransport,
  type UploadResponse,
  type UploadTransport,
} from "@/data/imageHost";
import { buildCloudSnapshot } from "@/data/snapshot";
import { makeBlob, makeNote } from "@/test/factories";

const ds = new LocalDataSource();

/** jsdom 的 FormData 不接受 Node 原生 File；用最小替身让上传流程走通。 */
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

/** 注入上传传输层；返回 mock 便于断言是否发生上传。 */
function useTransport(handler: UploadTransport) {
  const mock = vi.fn(handler);
  __setUploadTransport(mock);
  return mock;
}

async function noteWithBlobs(content: string, blobs: Array<{ blob: Blob }>): Promise<string> {
  const ids: string[] = [];
  for (const item of blobs) ids.push(await ds.saveAttachment("note-snapshot", item.blob));
  const body = content.replace(/\{id\}/g, () => {
    const id = ids.shift();
    return id ? `${BLOB_URL_SCHEME}${id}` : "";
  });
  await ds.upsertNote(makeNote({ id: "note-snapshot", title: "快照笔记", content: body }));
  return body;
}

beforeEach(() => {
  __resetImageHostThrottle();
});

afterEach(() => {
  __setUploadTransport(null);
  vi.unstubAllGlobals();
});

describe("buildCloudSnapshot", () => {
  it("图片上传图床并在快照中替换为外链，本地内容不动", async () => {
    stubFormData();
    useTransport(async () => uploadResponse("https://img.cdn1.vip/i/s.webp"));

    await noteWithBlobs("![图]({id})", [{ blob: makeBlob("png-bytes", "image/png") }]);
    const { content, stats } = await buildCloudSnapshot();

    const snapshot = JSON.parse(content) as { notes: Array<{ content: string }>; blobs: unknown[] };
    expect(snapshot.notes[0].content).toContain("https://img.cdn1.vip/i/s.webp");
    expect(snapshot.notes[0].content).not.toContain("clawclip://blob/");
    expect(snapshot.blobs).toHaveLength(0);
    expect(stats.imagesUploaded).toBe(1);
    expect(stats.imagesFailed).toBe(0);

    // 本地笔记仍是 clawclip:// 引用（只转快照）
    const local = await ds.getNote("note-snapshot");
    expect(local!.content).toContain("clawclip://blob/");
  });

  it("上传失败回退 base64，快照仍保留图片", async () => {
    stubFormData();
    useTransport(async () => ({
      ok: false,
      status: 400,
      header: () => null,
      json: async () => ({ success: false, error: "bad" }),
    }));

    await noteWithBlobs("![图]({id})", [{ blob: makeBlob("png-bytes", "image/png") }]);
    const { content, stats } = await buildCloudSnapshot();

    const snapshot = JSON.parse(content) as { notes: Array<{ content: string }>; blobs: unknown[] };
    expect(snapshot.notes[0].content).toContain("clawclip://blob/");
    expect(snapshot.blobs).toHaveLength(1);
    expect(stats.imagesFailed).toBe(1);
    expect(stats.imagesUploaded).toBe(0);
  });

  it("复用 remoteUrl 缓存，不重复上传", async () => {
    const transport = useTransport(async () => {
      throw new Error("不应发生上传");
    });

    const ids: string[] = [];
    const id = await ds.saveAttachment("note-snapshot", makeBlob("png", "image/png"));
    ids.push(id);
    await ds.upsertNote(
      makeNote({
        id: "note-snapshot",
        title: "缓存",
        content: `![图](${BLOB_URL_SCHEME}${id})`,
      }),
    );
    await setBlobRemoteUrl(id, "https://img.cdn1.vip/i/cached.webp");

    const { content, stats } = await buildCloudSnapshot();
    expect(transport).not.toHaveBeenCalled();
    expect(stats.imagesReused).toBe(1);
    expect(content).toContain("https://img.cdn1.vip/i/cached.webp");
  });

  it("超限时从最大的非图片附件开始剔除，正文引用保留", async () => {
    const big = await ds.saveAttachment(
      "note-snapshot",
      makeBlob("a".repeat(900), "application/octet-stream"),
    );
    const small = await ds.saveAttachment(
      "note-snapshot",
      makeBlob("b".repeat(600), "application/octet-stream"),
    );
    await ds.upsertNote(
      makeNote({
        id: "note-snapshot",
        title: "超限",
        content: `[大](${BLOB_URL_SCHEME}${big})\n[小](${BLOB_URL_SCHEME}${small})`,
      }),
    );

    const { content, stats } = await buildCloudSnapshot({ limit: 2000 });
    const snapshot = JSON.parse(content) as {
      notes: Array<{ content: string }>;
      blobs: Array<{ id: string }>;
    };

    expect(stats.attachmentsOmitted).toBe(1);
    expect(stats.omittedBytes).toBe(900);
    expect(snapshot.blobs.map((b) => b.id)).toEqual([small]);
    // 被剔除的附件只保留本地引用
    expect(snapshot.notes[0].content).toContain(`${BLOB_URL_SCHEME}${big}`);
  });

  it("仅笔记就超过上限时抛 too_large", async () => {
    await ds.upsertNote(makeNote({ id: "note-snapshot", content: "# 很长的笔记" }));
    await expect(buildCloudSnapshot({ limit: 10 })).rejects.toBeInstanceOf(CloudSyncError);
  });

  it("孤儿附件不会进入快照", async () => {
    await ds.upsertNote(makeNote({ id: "note-snapshot", content: "没有附件" }));
    await ds.saveAttachment("note-snapshot", makeBlob("orphan", "application/octet-stream"));

    const { content } = await buildCloudSnapshot();
    const snapshot = JSON.parse(content) as { blobs: unknown[] };
    expect(snapshot.blobs).toHaveLength(0);
  });
});
