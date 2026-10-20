/**
 * 导入图片落盘单测：base64 必处理、本地图片尝试读取、外部图床链接跳过；
 * 目标为本地时写 IDB，目标为图床时上传并缓存 remoteUrl。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BLOB_URL_SCHEME, getBlob, saveBlob, setBlobRemoteUrl } from "@/data/blobStore";
import { __resetImageHostThrottle, __setUploadTransport } from "@/data/imageHost";
import {
  countImportImageCandidates,
  persistImportedImages,
  resolveImportedImage,
} from "@/data/importImages";
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
  json: async () => ({ success: true, data: { url: "https://img.cdn1.vip/i/imported.webp" } }),
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

function findBlobId(content: string): string {
  const match = content.match(/clawclip:\/\/blob\/([\w-]+)/);
  return match?.[1] ?? "";
}

beforeEach(() => {
  __resetImageHostThrottle();
  vi.stubGlobal("FormData", FakeFormData);
});

afterEach(() => {
  __setUploadTransport(null);
  vi.unstubAllGlobals();
});

describe("countImportImageCandidates", () => {
  it("统计 base64 与本地图片，排除外部图床链接", () => {
    const content = [
      `![内联](${DATA_URL})`,
      '<img src="blob:https://app/1" />',
      "![外链](https://other.example/x.png)",
    ].join("\n");
    expect(countImportImageCandidates(content)).toBe(2);
  });
});

describe("persistImportedImages", () => {
  it("本地目标：base64 解码后存进 IDB，正文改为 clawclip://", async () => {
    const result = await persistImportedImages(`![内联](${DATA_URL})`, {
      noteId: "note-1",
      host: "local",
    });

    const id = findBlobId(result.content);
    expect(id).not.toBe("");
    expect(result.content).toBe(`![内联](${BLOB_URL_SCHEME}${id})`);
    expect(result.stats).toMatchObject({ total: 1, local: 1, remote: 0, failed: 0 });

    const record = await getBlob(id);
    expect(record?.mime).toBe("image/png");
    expect(record?.noteId).toBe("note-1");
  });

  it("图床目标：base64 上传后写外链，不落本地", async () => {
    const transport = useTransport(async () => SUCCESS);

    const result = await persistImportedImages(`![内联](${DATA_URL})`, {
      noteId: "note-2",
      host: "scdn",
    });

    expect(result.content).toBe("![内联](https://img.cdn1.vip/i/imported.webp)");
    expect(result.stats).toMatchObject({ total: 1, local: 0, remote: 1, failed: 0 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(findBlobId(result.content)).toBe("");
  });

  it("外部图床链接保持原样且不发起请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await persistImportedImages(
      `![外链](https://other.example/x.png)\n\n![内联](${DATA_URL})`,
      { noteId: "note-3", host: "local" },
    );

    expect(result.content).toContain("https://other.example/x.png");
    expect(result.content).toContain("clawclip://blob/");
    expect(result.stats).toMatchObject({ total: 1, kept: 1, local: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("本地图片：尝试 fetch 读取后导入；失败保留原引用", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => pngFile(),
    });

    const success = await persistImportedImages("![本地](blob:https://app/1)", {
      noteId: "note-4",
      host: "local",
    });
    expect(success.content).toContain("clawclip://blob/");
    expect(success.stats.local).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockRejectedValueOnce(new Error("blocked"));
    const failed = await persistImportedImages("![本地](blob:https://app/2)", {
      noteId: "note-5",
      host: "local",
    });
    expect(failed.content).toBe("![本地](blob:https://app/2)");
    expect(failed.stats).toMatchObject({ failed: 1, local: 0 });
  });

  it("已有本地图片 + 图床目标：复用 remoteUrl，不重复上传", async () => {
    const id = await saveBlob("note-6", pngFile());
    await setBlobRemoteUrl(id, "https://img.cdn1.vip/i/cached.webp");
    const transport = useTransport(async () => SUCCESS);

    const result = await persistImportedImages(`![本地](${BLOB_URL_SCHEME}${id})`, {
      noteId: "note-6",
      host: "scdn",
    });

    expect(result.content).toBe("![本地](https://img.cdn1.vip/i/cached.webp)");
    expect(result.stats).toMatchObject({ reused: 1, remote: 0, failed: 0 });
    expect(transport).not.toHaveBeenCalled();
  });

  it("悬空的 clawclip 引用无法读取时保留原文", async () => {
    const result = await persistImportedImages(`![缺失](${BLOB_URL_SCHEME}missing-id)`, {
      noteId: "note-7",
      host: "scdn",
    });
    expect(result.content).toBe(`![缺失](${BLOB_URL_SCHEME}missing-id)`);
    expect(result.stats.failed).toBe(1);
  });

  it("图床上传失败时回退本地并记录 fallback", async () => {
    useTransport(async () => ({
      ...SUCCESS,
      json: async () => ({ success: false, error: "boom" }),
    }));

    const result = await persistImportedImages(`![内联](${DATA_URL})`, {
      noteId: "note-8",
      host: "scdn",
    });

    expect(result.content).toContain("clawclip://blob/");
    expect(result.stats).toMatchObject({ local: 1, fallbacks: 1, failed: 0 });
    expect(result.stats.errors[0]).toContain("boom");
  });
});

describe("resolveImportedImage", () => {
  it("按设置处理 DOCX 内嵌图片", async () => {
    useTransport(async () => SUCCESS);
    const remote = await resolveImportedImage(pngFile(), "note-9", "scdn");
    expect(remote).toEqual({ target: "https://img.cdn1.vip/i/imported.webp", kind: "remote" });

    const local = await resolveImportedImage(pngFile(), "note-9", "local");
    expect(local.kind).toBe("local");
    expect(local.target).toContain("clawclip://blob/");
  });
});
