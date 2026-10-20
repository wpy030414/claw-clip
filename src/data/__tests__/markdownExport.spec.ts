/**
 * MD 导出预处理单测：本地图片上传/缓存复用/失败回退、历史内联 base64 转外链。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BLOB_URL_SCHEME, getBlob, saveBlob, setBlobRemoteUrl } from "@/data/blobStore";
import { __resetImageHostThrottle, __setUploadTransport } from "@/data/imageHost";
import {
  countMarkdownImageCandidates,
  extractDataImageUrls,
  prepareMarkdownExport,
} from "@/data/export/markdown";
import type { UploadResponse, UploadTransport } from "@/data/imageHost";

class FakeFormData {
  private readonly fields = new Map<string, unknown>();

  append(key: string, value: unknown): void {
    this.fields.set(key, value);
  }

  get(key: string): unknown {
    return this.fields.get(key) ?? null;
  }
}

const SUCCESS: UploadResponse = {
  ok: true,
  status: 200,
  header: () => null,
  json: async () => ({ success: true, data: { url: "https://img.cdn1.vip/i/out.webp" } }),
};

function useTransport(handler: UploadTransport) {
  const mock = vi.fn(handler);
  __setUploadTransport(mock);
  return mock;
}

function pngBlob(): File {
  return new File(["png-bytes"], "a.png", { type: "image/png" });
}

beforeEach(() => {
  __resetImageHostThrottle();
  vi.stubGlobal("FormData", FakeFormData);
});

afterEach(() => {
  __setUploadTransport(null);
  vi.unstubAllGlobals();
});

describe("extractDataImageUrls / countMarkdownImageCandidates", () => {
  it("识别 Markdown 与 HTML 内联图片并去重", () => {
    const url = "data:image/png;base64,AAAA";
    const content = `![a](${url})\n\n<img src="${url}" />\n\n![b](https://x/y.png)`;
    expect(extractDataImageUrls(content)).toEqual([url]);
    expect(countMarkdownImageCandidates(content)).toBe(1);
  });
});

describe("prepareMarkdownExport", () => {
  it("本地图片上传后替换引用并写入 remoteUrl 缓存", async () => {
    const id = await saveBlob("note-1", pngBlob());
    const transport = useTransport(async () => SUCCESS);

    const result = await prepareMarkdownExport(`![图](${BLOB_URL_SCHEME}${id})`);

    expect(result.content).toBe("![图](https://img.cdn1.vip/i/out.webp)");
    expect(result.stats).toMatchObject({ total: 1, uploaded: 1, reused: 0, failed: 0 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await getBlob(id))?.remoteUrl).toBe("https://img.cdn1.vip/i/out.webp");
  });

  it("命中 remoteUrl 缓存时不再上传", async () => {
    const id = await saveBlob("note-2", pngBlob());
    await setBlobRemoteUrl(id, "https://img.cdn1.vip/i/cached.webp");
    const transport = useTransport(async () => SUCCESS);

    const result = await prepareMarkdownExport(`![图](${BLOB_URL_SCHEME}${id})`);

    expect(result.content).toContain("https://img.cdn1.vip/i/cached.webp");
    expect(result.stats).toMatchObject({ uploaded: 0, reused: 1, failed: 0 });
    expect(transport).not.toHaveBeenCalled();
  });

  it("上传失败保留本地引用并记录错误", async () => {
    const id = await saveBlob("note-3", pngBlob());
    const transport = useTransport(async () => ({
      ...SUCCESS,
      json: async () => ({ success: false, error: "boom" }),
    }));

    const result = await prepareMarkdownExport(`![图](${BLOB_URL_SCHEME}${id})`);

    expect(result.content).toBe(`![图](${BLOB_URL_SCHEME}${id})`);
    expect(result.stats.failed).toBe(1);
    expect(result.stats.errors[0]).toContain("boom");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("历史内联 base64 图片上传后换成外链", async () => {
    const dataUrl = `data:image/png;base64,${btoa("inline-png")}`;
    useTransport(async () => SUCCESS);

    const result = await prepareMarkdownExport(`![内联](${dataUrl})`);

    expect(result.content).toBe("![内联](https://img.cdn1.vip/i/out.webp)");
    expect(result.stats).toMatchObject({ total: 1, uploaded: 1, failed: 0 });
  });

  it("非图片附件与已有外链保持原样", async () => {
    const id = await saveBlob("note-4", new File(["pdf"], "a.pdf", { type: "application/pdf" }));
    const transport = useTransport(async () => SUCCESS);
    const content = `[附件](${BLOB_URL_SCHEME}${id})\n\n![外链](https://x/y.png)`;

    const result = await prepareMarkdownExport(content);

    expect(result.content).toBe(content);
    expect(result.stats.total).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });
});
