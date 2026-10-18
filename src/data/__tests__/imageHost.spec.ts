/**
 * 图床客户端单测：请求形状、错误映射、20MB 限制与本地回退。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOB_URL_SCHEME, getBlob } from "@/data/blobStore";
import {
  IMAGE_HOST_ENDPOINT,
  IMAGE_HOST_MAX_BYTES,
  ImageUploadError,
  __resetImageHostThrottle,
  resolveUploadTarget,
  uploadToScdn,
} from "@/data/imageHost";

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

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

function png(name = "a.png"): File {
  return new File(["png-bytes"], name, { type: "image/png" });
}

beforeEach(() => {
  __resetImageHostThrottle();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadToScdn", () => {
  it("用 multipart 字段 image 上传，解析 data.url", async () => {
    const fetchMock = vi.fn(async () =>
      response(200, { success: true, data: { url: "https://img.cdn1.vip/i/a.webp" } }),
    );
    stubFormData();
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadToScdn(png())).resolves.toBe("https://img.cdn1.vip/i/a.webp");

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0];
    expect(url).toBe(IMAGE_HOST_ENDPOINT);
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("image")).toBeTruthy();
    // 不手动设置 Content-Type（交给浏览器生成 boundary）
    expect((init.headers as Record<string, string> | undefined)?.["Content-Type"]).toBeUndefined();
  });

  it("success:false 抛 invalid，并带上服务端错误文案", async () => {
    stubFormData();
    vi.stubGlobal("fetch", vi.fn(async () => response(200, { success: false, error: "格式不支持" })));
    await expect(uploadToScdn(png())).rejects.toMatchObject({
      name: "ImageUploadError",
      code: "invalid",
      message: "格式不支持",
    });
  });

  it("413 → too_large", async () => {
    stubFormData();
    vi.stubGlobal("fetch", vi.fn(async () => response(413, {})));
    await expect(uploadToScdn(png())).rejects.toMatchObject({ code: "too_large" });
  });

  it("超过 20MB 时不发请求，直接拒绝", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const file = png();
    Object.defineProperty(file, "size", { value: IMAGE_HOST_MAX_BYTES + 1 });

    await expect(uploadToScdn(file)).rejects.toBeInstanceOf(ImageUploadError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429 后按 Retry-After 重试一次", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429, {}, { "retry-after": "0.01" }))
      .mockResolvedValueOnce(response(200, { success: true, url: "https://img.cdn1.vip/i/b.webp" }));
    stubFormData();
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadToScdn(png())).resolves.toBe("https://img.cdn1.vip/i/b.webp");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("网络错误重试一次后仍失败 → network", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("failed to fetch");
    });
    stubFormData();
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadToScdn(png())).rejects.toMatchObject({ code: "network" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(200, { success: true, data: { url: "https://img.cdn1.vip/i/c.webp" } })),
    );
    const result = await resolveUploadTarget(png(), "note-remote", "scdn");
    expect(result).toEqual({ target: "https://img.cdn1.vip/i/c.webp", kind: "remote" });
  });

  it("scdn 上传失败：回退本地并带回原因", async () => {
    stubFormData();
    vi.stubGlobal("fetch", vi.fn(async () => response(500, {})));
    const result = await resolveUploadTarget(png(), "note-fallback", "scdn");
    expect(result.kind).toBe("local");
    expect(result.target.startsWith(BLOB_URL_SCHEME)).toBe(true);
    expect(result.error).toBeTruthy();
    const id = result.target.slice(BLOB_URL_SCHEME.length);
    expect(await getBlob(id)).toBeDefined();
  });

  it("非图片文件即使在 scdn 目标下也走本地", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["pdf"], "a.pdf", { type: "application/pdf" });
    const result = await resolveUploadTarget(file, "note-pdf", "scdn");
    expect(result.kind).toBe("local");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
