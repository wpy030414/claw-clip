/**
 * GitHub Gist 同步单测（mock fetch）：API 形状、截断处理、错误映射与白名单序列化。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudSyncError,
  GIST_FILENAME,
  normalizeGistId,
  pullSnapshot,
  pushSnapshot,
  serializeSnapshot,
  validateGistToken,
} from "@/data/cloudSync";
import type { BackupPayload } from "@/types/backup";
import { makeNote } from "@/test/factories";

function snapshotPayload(): BackupPayload {
  return {
    schemaVersion: 2,
    exportedAt: 1700000000000,
    notes: [makeNote({ id: "n1", title: "标题", content: "# 标题" })],
    folders: [],
    blobs: [],
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("serializeSnapshot", () => {
  it("白名单输出，扩展字段（token）不会被写进快照", () => {
    const dirty = { ...snapshotPayload(), gistToken: "ghp_secret" } as BackupPayload;
    const text = serializeSnapshot(dirty);
    expect(text).not.toContain("ghp_secret");
    expect(JSON.parse(text).schemaVersion).toBe(2);
  });
});

describe("normalizeGistId", () => {
  it("支持裸 id 与 Gist 链接", () => {
    expect(normalizeGistId("g1")).toBe("g1");
    expect(normalizeGistId("https://gist.github.com/user/g1")).toBe("g1");
    expect(normalizeGistId("https://gist.github.com/g1")).toBe("g1");
    expect(normalizeGistId("not a gist!")).toBe("");
  });
});

describe("validateGistToken", () => {
  it("返回 login 与 scope，并带上 Bearer 头", async () => {
    const fetchMock = mockFetch(async (url) =>
      url.endsWith("/user")
        ? jsonResponse(200, { login: "octocat" }, { "x-oauth-scopes": "gist, read:user" })
        : jsonResponse(200, []),
    );

    const user = await validateGistToken("ghp_test");
    expect(user.login).toBe("octocat");
    expect(user.scopes).toEqual(["gist", "read:user"]);
    const headers = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0][1]
      .headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_test");
  });

  it("401 → auth", async () => {
    mockFetch(async () => jsonResponse(401, { message: "Bad credentials" }));
    await expect(validateGistToken("bad")).rejects.toMatchObject({ code: "auth" });
  });

  it("403 + 限流头 → rate_limit", async () => {
    mockFetch(async () =>
      jsonResponse(403, {}, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000" }),
    );
    await expect(validateGistToken("t")).rejects.toMatchObject({ code: "rate_limit" });
  });

  it("缺少 gist 权限 → forbidden", async () => {
    mockFetch(async (url) =>
      url.endsWith("/user") ? jsonResponse(200, { login: "u" }) : jsonResponse(403, {}),
    );
    await expect(validateGistToken("t")).rejects.toMatchObject({
      code: "forbidden",
      message: "令牌缺少 gist 权限",
    });
  });
});

describe("pushSnapshot", () => {
  it("无 gistId 时 POST 新建 secret gist，文件与内容正确且不含 token", async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(200, {
        id: "g1",
        html_url: "https://gist.github.com/g1",
        updated_at: "2026-10-18T00:00:00Z",
      }),
    );
    const content = serializeSnapshot(snapshotPayload());
    const result = await pushSnapshot({ token: "ghp_secret", content });

    expect(result).toMatchObject({ gistId: "g1", created: true });
    const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
    expect(url).toBe("https://api.github.com/gists");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as {
      public: boolean;
      files: Record<string, { content: string }>;
    };
    expect(body.public).toBe(false);
    expect(body.files[GIST_FILENAME].content).toContain("标题");
    expect(init.body as string).not.toContain("ghp_secret");
  });

  it("有 gistId 时 PATCH 覆盖", async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(200, { id: "g1", html_url: "https://gist.github.com/g1" }),
    );
    await pushSnapshot({ token: "t", gistId: "g1", content: serializeSnapshot(snapshotPayload()) });
    const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
    expect(url).toBe("https://api.github.com/gists/g1");
    expect(init.method).toBe("PATCH");
  });

  it("超过 10MB 直接拒绝，不发请求", async () => {
    const fetchMock = mockFetch(async () => jsonResponse(200, {}));
    const huge = "x".repeat(10 * 1024 * 1024 + 1);
    await expect(pushSnapshot({ token: "t", content: huge })).rejects.toMatchObject({
      code: "too_large",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("pullSnapshot", () => {
  it("读取 content 并校验 payload", async () => {
    const text = serializeSnapshot(snapshotPayload());
    mockFetch(async () =>
      jsonResponse(200, {
        id: "g1",
        updated_at: "2026-10-18T00:00:00Z",
        files: { [GIST_FILENAME]: { size: text.length, truncated: false, content: text } },
      }),
    );
    const result = await pullSnapshot({ token: "t", gistId: "g1" });
    expect(result.payload.notes).toHaveLength(1);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("truncated 时走 raw_url，且不带 Authorization", async () => {
    const text = serializeSnapshot(snapshotPayload());
    const fetchMock = mockFetch(async (url) => {
      if (url.startsWith("https://gist.githubusercontent.com/")) {
        return {
          ok: true,
          status: 200,
          text: async () => text,
        } as unknown as Response;
      }
      return jsonResponse(200, {
        id: "g1",
        files: {
          [GIST_FILENAME]: {
            size: text.length,
            truncated: true,
            raw_url: "https://gist.githubusercontent.com/u/g1/raw/x",
          },
        },
      });
    });

    const result = await pullSnapshot({ token: "ghp_secret", gistId: "g1" });
    expect(result.payload.notes).toHaveLength(1);
    const rawCall = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).find(([url]) =>
      url.startsWith("https://gist.githubusercontent.com/"),
    )!;
    const headers = (rawCall[1].headers as Record<string, string> | undefined) ?? {};
    expect(headers.Authorization).toBeUndefined();
  });

  it("缺文件 → not_found；非法内容 → invalid_payload；超大 → too_large", async () => {
    mockFetch(async () => jsonResponse(200, { id: "g1", files: {} }));
    await expect(pullSnapshot({ token: "t", gistId: "g1" })).rejects.toMatchObject({
      code: "not_found",
    });

    mockFetch(async () =>
      jsonResponse(200, {
        id: "g1",
        files: { [GIST_FILENAME]: { size: 2, truncated: false, content: "{}" } },
      }),
    );
    await expect(pullSnapshot({ token: "t", gistId: "g1" })).rejects.toMatchObject({
      code: "invalid_payload",
    });

    mockFetch(async () =>
      jsonResponse(200, {
        id: "g1",
        files: { [GIST_FILENAME]: { size: 10 * 1024 * 1024 + 1, truncated: false, content: "" } },
      }),
    );
    await expect(pullSnapshot({ token: "t", gistId: "g1" })).rejects.toMatchObject({
      code: "too_large",
    });
  });

  it("错误类可区分状态码", () => {
    const error = new CloudSyncError("auth", "令牌无效");
    expect(error.name).toBe("CloudSyncError");
    expect(error.code).toBe("auth");
  });
});
