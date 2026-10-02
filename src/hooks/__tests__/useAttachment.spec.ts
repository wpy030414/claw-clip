/**
 * useAttachment 单测：makeUploadHandler 逻辑。
 *
 * ★ R6 实测真相：Vditor handler 返回 string 会被当错误提示，不插入正文；
 *   handler 必须自己调 insert 回调插入 markdown，返回 null。
 *   插入的 URL 用 object URL（当场可渲染），落库时 dehydrate 回 clawclip://。
 */
import { describe, expect, it, vi } from "vitest";
import { makeUploadHandler } from "@/hooks/useAttachment";
import { datasource } from "@/data/datasource";

function makeFile(name: string, type: string, content: string): File {
  return new File([content], name, { type });
}

/** 从插入的 Markdown 提取 object URL（blob:...）。 */
function extractUrl(md: string): string {
  return md.match(/blob:[^\s)"']+/)?.[0] ?? "";
}

describe("makeUploadHandler", () => {
  it("图片文件 → 存 blob + 调 insert 插入 ![](object URL)，返回 null", async () => {
    const insert = vi.fn();
    const handler = makeUploadHandler(() => "note-1", insert);
    const result = await handler([makeFile("照片.png", "image/png", "binarydata")]);

    // ★ 返回 null（成功），不是 string（string 会被 Vditor 当错误提示）
    expect(result).toBeNull();
    // ★ 自己调 insert 插入 markdown
    expect(insert).toHaveBeenCalledTimes(1);
    const md = insert.mock.calls[0][0] as string;
    expect(md).toMatch(/^!\[照片\.png\]\(blob:[^\s)]+\)$/);

    // blob 确实存进了 IndexedDB
    const { blobs } = await datasource.exportAll();
    expect(blobs).toHaveLength(1);
    expect(blobs[0].noteId).toBe("note-1");
    expect(blobs[0].mime).toBe("image/png");
  });

  it("视频文件 → insert 插入 <video src=objectURL> 标签", async () => {
    const insert = vi.fn();
    const handler = makeUploadHandler(() => "note-2", insert);
    await handler([makeFile("clip.mp4", "video/mp4", "videodata")]);
    const md = insert.mock.calls[0][0] as string;
    expect(md).toMatch(/<video src="blob:[^"]+" controls><\/video>/);
  });

  it("其它类型文件 → insert 插入下载链接 [name](objectURL)", async () => {
    const insert = vi.fn();
    const handler = makeUploadHandler(() => "note-3", insert);
    await handler([makeFile("doc.pdf", "application/pdf", "pdfdata")]);
    const md = insert.mock.calls[0][0] as string;
    expect(md).toMatch(/^\[doc\.pdf\]\(blob:[^\s)]+\)$/);
  });

  it("多文件 → insert 一次插入换行拼接的多条引用，各自存库", async () => {
    const insert = vi.fn();
    const handler = makeUploadHandler(() => "note-4", insert);
    await handler([
      makeFile("a.png", "image/png", "a"),
      makeFile("b.png", "image/png", "b"),
    ]);

    expect(insert).toHaveBeenCalledTimes(1); // 多文件合并成一次插入
    const md = insert.mock.calls[0][0] as string;
    const lines = md.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("a.png");
    expect(lines[1]).toContain("b.png");
    expect(extractUrl(lines[0])).not.toBe(extractUrl(lines[1])); // URL 各异
  });

  it("noteIdRef 每次调用取最新值（闭包捕获 store）", async () => {
    let currentId = "note-A";
    const handler = makeUploadHandler(() => currentId, vi.fn());

    await handler([makeFile("x.png", "image/png", "x")]);
    currentId = "note-B"; // 切换当前笔记
    await handler([makeFile("y.png", "image/png", "y")]);

    const { blobs } = await datasource.exportAll();
    const noteIds = blobs.map((b) => b.noteId).sort();
    expect(noteIds).toEqual(["note-A", "note-B"]); // ★ 用了调用时的最新 noteId
  });

  it("图片无文件名时用兜底 alt「图片」", async () => {
    const insert = vi.fn();
    const handler = makeUploadHandler(() => "note-5", insert);
    await handler([makeFile("", "image/png", "data")]);
    expect(insert.mock.calls[0][0]).toMatch(/^!\[图片\]\(blob:/);
  });

  it("空文件列表 → 不调 insert，返回 null", async () => {
    const insert = vi.fn();
    const handler = makeUploadHandler(() => "note-6", insert);
    const result = await handler([]);
    expect(result).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });
});
