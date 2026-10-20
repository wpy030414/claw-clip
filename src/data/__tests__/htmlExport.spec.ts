/**
 * HTML 导出图片策略单测：本地图片上传图床并复用缓存、外部链接不动、
 * 上传失败回退 data URL。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getBlob, resolveBlobUrl, saveBlob, setBlobRemoteUrl } from "@/data/blobStore";
import { prepareExportHtml } from "@/data/export/prepare";
import type { ExportImageStats } from "@/data/export/prepare";
import { __resetImageHostThrottle, __setUploadTransport } from "@/data/imageHost";
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
  json: async () => ({ success: true, data: { url: "https://img.cdn1.vip/i/html.webp" } }),
};

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;

function useTransport(handler: UploadTransport) {
  const mock = vi.fn(handler);
  __setUploadTransport(mock);
  return mock;
}

function pngFile(): File {
  return new File([PNG], "a.png", { type: "image/png" });
}

beforeEach(() => {
  __resetImageHostThrottle();
  vi.stubGlobal("FormData", FakeFormData);
});

afterEach(() => {
  __setUploadTransport(null);
  vi.unstubAllGlobals();
});

describe("prepareExportHtml images=host", () => {
  it("本地 blob 图片上传后改写为图床外链并缓存", async () => {
    const id = await saveBlob("note-1", pngFile());
    const url = await resolveBlobUrl(id);
    const transport = useTransport(async () => SUCCESS);
    let stats: ExportImageStats | null = null;

    const html = await prepareExportHtml(`<p><img src="${url}"></p>`, {
      mermaid: "none",
      images: "host",
      onImageStats: (next) => {
        stats = next;
      },
    });

    expect(html).toContain("https://img.cdn1.vip/i/html.webp");
    expect(html).not.toContain(url);
    expect((await getBlob(id))?.remoteUrl).toBe("https://img.cdn1.vip/i/html.webp");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(stats).toMatchObject({ total: 1, uploaded: 1, reused: 0, fallbacks: 0 });
  });

  it("命中 remoteUrl 缓存时不再上传", async () => {
    const id = await saveBlob("note-2", pngFile());
    await setBlobRemoteUrl(id, "https://img.cdn1.vip/i/cached.webp");
    const url = await resolveBlobUrl(id);
    const transport = useTransport(async () => SUCCESS);

    const html = await prepareExportHtml(`<img src="${url}">`, {
      mermaid: "none",
      images: "host",
    });

    expect(html).toContain("https://img.cdn1.vip/i/cached.webp");
    expect(transport).not.toHaveBeenCalled();
  });

  it("内联 base64 上传后换外链；已有外链保持原样", async () => {
    useTransport(async () => SUCCESS);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const html = await prepareExportHtml(
      `<img src="${DATA_URL}"><img src="https://other.example/x.png">`,
      { mermaid: "none", images: "host" },
    );

    expect(html).toContain("https://img.cdn1.vip/i/html.webp");
    expect(html).toContain("https://other.example/x.png");
    expect(html).not.toContain("data:image/png;base64,");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("上传失败时本地图片回退为 data URL", async () => {
    const id = await saveBlob("note-3", pngFile());
    const url = await resolveBlobUrl(id);
    useTransport(async () => ({
      ...SUCCESS,
      json: async () => ({ success: false, error: "boom" }),
    }));
    let stats: ExportImageStats | null = null;

    const html = await prepareExportHtml(`<img src="${url}">`, {
      mermaid: "none",
      images: "host",
      onImageStats: (next) => {
        stats = next;
      },
    });

    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain(url);
    expect(stats).toMatchObject({ uploaded: 0, fallbacks: 1, failed: 0 });
  });
});
