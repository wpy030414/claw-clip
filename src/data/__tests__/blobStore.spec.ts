/**
 * blobStore 单测：附件存取 + object URL 生命周期 + clawclip:// hydrate。
 */
import { describe, expect, it } from "vitest";
import {
  BLOB_URL_SCHEME,
  deleteBlobsOfNote,
  getBlob,
  hydrateMarkdown,
  releaseBlobUrls,
  resolveBlobUrl,
  saveBlob,
} from "@/data/blobStore";
import { makeBlob } from "@/test/factories";

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

describe("blobStore.deleteBlobsOfNote（级联）", () => {
  it("删除某笔记全部附件，不影响其它笔记", async () => {
    const b1 = await saveBlob("note-a", makeBlob("a", "image/png"));
    const b2 = await saveBlob("note-a", makeBlob("b", "image/png"));
    const b3 = await saveBlob("note-b", makeBlob("c", "image/png"));

    await deleteBlobsOfNote("note-a");

    expect(await getBlob(b1)).toBeUndefined();
    expect(await getBlob(b2)).toBeUndefined();
    expect(await getBlob(b3)).toBeDefined(); // note-b 的不受影响
  });
});
