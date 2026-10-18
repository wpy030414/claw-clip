/**
 * 图床客户端单测：请求形状、错误映射、20MB 限制与本地回退。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOB_URL_SCHEME, getBlob } from "@/data/blobStore";
import {
  IMAGE_HOST_MAX_BYTES,
  ImageUploadError,
  __resetImageHostThrottle,
  __setUploadTransport,
  resolveUploadTarget,
  uploadToScdn,
  type UploadResponse,
  type UploadTransport,
} from "@/data/imageHost";

/** jsdom 的 FormData 不接受 Node 原生 File；用最小替身验证字段名与调用次数。 */
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

function uploadResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): UploadResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    header: (name) => headers[name.toLowerCase()] ?? null,
    json: async () => body,
  };
}

/** 注入上传传输层，绕过 XHR；返回 mock 以便断言调用次数。 */
function useTransport(handler: UploadTransport) {
  const mock = vi.fn(handler);
  __setUploadTransport(mock);
  return mock;
}

function png(name = "a.png"): File {
  return new File(["png-bytes"], name, { type: "image/png" });
}

beforeEach(() => {
  __resetImageHostThrottle();
});

afterEach(() => {
  __setUploadTransport(null);
  vi.unstubAllGlobals();
});

describe("uploadToScdn", () => {
  it("用 multipart 字段 image 上传，解析 data.url", async () => {
    stubFormData();
    let captured: FormData | null = null;
    useTransport(async (form) => {
      captured = form;
      return uploadResponse(200, {
        success: true,
        data: { url: "https://img.cdn1.vip/i/a.webp" },
      });
    });

    await expect(uploadToScdn(png())).resolves.toBe("https://img.cdn1.vip/i/a.webp");
    expect(captured!.get("image")).toBeTruthy();
  });

  it("把上传进度回调透传给传输层", async () => {
    stubFormData();
    const onProgress = vi.fn();
    useTransport(async (_form, options) => {
      options.onProgress?.(1024, 4096);
      return uploadResponse(200, { success: true, data: { url: "https://x/y.webp" } });
    });

    await uploadToScdn(png(), { onProgress });
    expect(onProgress).toHaveBeenCalledWith(1024, 4096);
  });

  it("success:false 抛 invalid，并带上服务端错误文案", async () => {
    stubFormData();
    useTransport(async () => uploadResponse(200, { success: false, error: "格式不支持" }));
    await expect(uploadToScdn(png())).rejects.toMatchObject({
      name: "ImageUploadError",
      code: "invalid",
      message: "格式不支持",
    });
  });

  it("413 → too_large", async () => {
    stubFormData();
    useTransport(async () => uploadResponse(413, {}));
    await expect(uploadToScdn(png())).rejects.toMatchObject({ code: "too_large" });
  });

  it("超过 20MB 时不发请求，直接拒绝", async () => {
    const transport = useTransport(async () => uploadResponse(200, {}));
    const file = png();
    Object.defineProperty(file, "size", { value: IMAGE_HOST_MAX_BYTES + 1 });

    await expect(uploadToScdn(file)).rejects.toBeInstanceOf(ImageUploadError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("429 后按 Retry-After 重试一次", async () => {
    stubFormData();
    const transport = vi
      .fn<UploadTransport>()
      .mockResolvedValueOnce(uploadResponse(429, {}, { "retry-after": "0.01" }))
      .mockResolvedValueOnce(
        uploadResponse(200, { success: true, url: "https://img.cdn1.vip/i/b.webp" }),
      );
    __setUploadTransport(transport);

    await expect(uploadToScdn(png())).resolves.toBe("https://img.cdn1.vip/i/b.webp");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("网络错误重试一次后仍失败 → network", async () => {
    stubFormData();
    const transport = useTransport(async () => {
      throw new TypeError("failed to fetch");
    });
    await expect(uploadToScdn(png())).rejects.toMatchObject({ code: "network" });
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe("resolveUploadTarget", () => {
  it("本地目标：写入 IndexedDB 并返回 clawclip:// 引用", async () => {
    const result = await resolveUploadTarget(png(), "note-local", "local");
    expect(result.kind).toBe("local");
    expect(result.target.startsWith(BLOB_URL_SCHEME)).toBe(true);
    const id = result.target.slice(BLOB_URL_SCHEME.length);
    expect(await getBlob(id)).toBeDefined();
  });

  it("scdn + 图片：成功返回外链", async () => {
    stubFormData();
    useTransport(async () =>
      uploadResponse(200, { success: true, data: { url: "https://img.cdn1.vip/i/c.webp" } }),
    );
    const result = await resolveUploadTarget(png(), "note-remote", "scdn");
    expect(result).toEqual({ target: "https://img.cdn1.vip/i/c.webp", kind: "remote" });
  });

  it("scdn 上传失败：回退本地并带回原因", async () => {
    stubFormData();
    useTransport(async () => uploadResponse(500, {}));
    const result = await resolveUploadTarget(png(), "note-fallback", "scdn");
    expect(result.kind).toBe("local");
    expect(result.target.startsWith(BLOB_URL_SCHEME)).toBe(true);
    expect(result.error).toBeTruthy();
    const id = result.target.slice(BLOB_URL_SCHEME.length);
    expect(await getBlob(id)).toBeDefined();
  });

  it("非图片文件即使在 scdn 目标下也走本地", async () => {
    const transport = useTransport(async () => uploadResponse(200, {}));
    const file = new File(["pdf"], "a.pdf", { type: "application/pdf" });
    const result = await resolveUploadTarget(file, "note-pdf", "scdn");
    expect(result.kind).toBe("local");
    expect(transport).not.toHaveBeenCalled();
  });
});
