/**
 * GitHub Gist 云同步（纯前端直连 api.github.com）。
 *
 * 语义：**手动全量快照**。推送 = 覆盖 gist 里的单个快照文件；拉取 = 取回快照后
 * 由用户选择「合并（较新者胜）」或「覆盖」应用到本地。不做增量、不做墓碑、不做自动合并。
 *
 * 细节：
 * - api.github.com 支持 CORS；Authorization: Bearer <PAT>，需要 gist 权限。
 * - Gist 文件内容超过 1MB 时 API 返回的 `content` 会被截断，必须走 `raw_url`；
 *   超过 10MB 时 raw_url 也无法完整获取（GitHub 要求 git clone），因此推送前拦截。
 * - raw_url 请求**不带 Authorization**，避免把 PAT 发给 gist.githubusercontent.com。
 * - 错误信息只包含状态码与可读原因，绝不拼接请求头/token。
 */
import type { BackupPayload } from "@/types/backup";
import { parseBackupPayload } from "./backupFile";

const API_BASE = "https://api.github.com";

export const GIST_FILENAME = "clawclip-backup.json";
export const GIST_DESCRIPTION = "ClawClip 全库快照";
/** API 返回的 content 超过该值会被截断，需要用 raw_url */
export const GIST_CONTENT_LIMIT = 1024 * 1024;
/** raw_url 能完整读取的上限，同时也是推送快照的硬上限 */
export const GIST_READ_LIMIT = 10 * 1024 * 1024;

export type CloudSyncErrorCode =
  | "auth"
  | "forbidden"
  | "not_found"
  | "rate_limit"
  | "network"
  | "timeout"
  | "invalid_payload"
  | "too_large"
  | "http";

export class CloudSyncError extends Error {
  constructor(
    readonly code: CloudSyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CloudSyncError";
  }
}

export interface GistUser {
  login: string;
  scopes: string[];
}

export interface PushResult {
  gistId: string;
  htmlUrl: string;
  updatedAt: string;
  bytes: number;
  created: boolean;
}

export interface PullResult {
  payload: BackupPayload;
  bytes: number;
  updatedAt: string;
  rawUrl: string;
}

interface GistFile {
  filename?: string;
  size?: number;
  truncated?: boolean;
  content?: string;
  raw_url?: string;
}

interface GistResponse {
  id: string;
  html_url?: string;
  updated_at?: string;
  files?: Record<string, GistFile>;
}

interface RequestOptions {
  token?: string;
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  timeoutMs?: number;
  /** 仅 GET 的网络错误/5xx 重试一次（POST 重试可能重复创建 gist） */
  retryGet?: boolean;
}

function bytesOf(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function errorFromResponse(res: Response, context: "api" | "gist"): CloudSyncError {
  if (res.status === 401) return new CloudSyncError("auth", "令牌无效或已过期");
  if (res.status === 403) {
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const when =
        Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toLocaleTimeString() : "稍后";
      return new CloudSyncError("rate_limit", `GitHub API 限流，请 ${when} 后重试`);
    }
    return new CloudSyncError("forbidden", "令牌权限不足（需要 gist 权限）");
  }
  if (res.status === 404) {
    return new CloudSyncError(
      "not_found",
      context === "gist" ? "Gist 不存在或无权访问" : "请求的资源不存在",
    );
  }
  if (res.status === 422) return new CloudSyncError("http", "GitHub 拒绝了请求内容");
  return new CloudSyncError("http", `GitHub 返回 ${res.status}`);
}

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    done: () => clearTimeout(timer),
  };
}

async function request<T>(
  path: string,
  { token, method = "GET", body, timeoutMs = 20_000, retryGet = false }: RequestOptions = {},
): Promise<{ data: T; headers: Headers }> {
  const attempts = retryGet ? 2 : 1;
  let lastError: CloudSyncError | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const guard = withTimeout(timeoutMs);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: guard.signal,
      });
      if (!res.ok) {
        const error = errorFromResponse(res, path.includes("/gists/") ? "gist" : "api");
        if (attempt === 0 && retryGet && (res.status >= 500 || error.code === "rate_limit")) {
          lastError = error;
          continue;
        }
        throw error;
      }
      const data = (res.status === 204 ? null : await res.json()) as T;
      return { data, headers: res.headers };
    } catch (error) {
      if (error instanceof CloudSyncError) throw error;
      const aborted = (error as Error | undefined)?.name === "AbortError";
      lastError = new CloudSyncError(
        aborted ? "timeout" : "network",
        aborted ? "请求超时" : "网络异常，请检查连接",
      );
      if (attempt === 0 && retryGet) continue;
      throw lastError;
    } finally {
      guard.done();
    }
  }
  throw lastError ?? new CloudSyncError("network", "网络异常");
}

/** 从 Gist 链接或裸 id 中提取 gist id。 */
export function normalizeGistId(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) {
    try {
      const segments = new URL(value).pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1] ?? "";
      return /^[A-Za-z0-9]+$/.test(last) ? last : "";
    } catch {
      return "";
    }
  }
  const bare = value.match(/^([A-Za-z0-9]+)$/);
  return bare ? bare[1] : "";
}

/** 校验 PAT 并确认具备 gist 读取权限。 */
export async function validateGistToken(token: string): Promise<GistUser> {
  const trimmed = token.trim();
  if (!trimmed) throw new CloudSyncError("auth", "请先填写 GitHub PAT");

  const { data, headers } = await request<{ login: string }>("/user", { token: trimmed });
  const scopes = (headers.get("x-oauth-scopes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    await request<unknown>("/gists?per_page=1", { token: trimmed });
  } catch (error) {
    if (
      error instanceof CloudSyncError &&
      (error.code === "forbidden" || error.code === "not_found")
    ) {
      throw new CloudSyncError("forbidden", "令牌缺少 gist 权限");
    }
    throw error;
  }

  return { login: data.login, scopes };
}

/** 白名单序列化：即使传入对象被扩展，也绝不会把 token 等字段写进快照。 */
export function serializeSnapshot(payload: BackupPayload): string {
  return JSON.stringify({
    schemaVersion: 2,
    exportedAt: payload.exportedAt,
    notes: payload.notes,
    folders: payload.folders ?? [],
    blobs: payload.blobs,
  });
}

/** 推送快照：无 gistId 时新建 secret gist，有则 PATCH 覆盖同名文件。 */
export async function pushSnapshot({
  token,
  gistId,
  content,
}: {
  token: string;
  gistId?: string;
  content: string;
}): Promise<PushResult> {
  if (!token.trim()) throw new CloudSyncError("auth", "请先填写 GitHub PAT");
  const bytes = bytesOf(content);
  if (bytes > GIST_READ_LIMIT) {
    throw new CloudSyncError("too_large", "快照超过 10MB，无法通过 Gist 同步");
  }

  const input = (gistId ?? "").trim();
  const id = normalizeGistId(input);
  if (input && !id) throw new CloudSyncError("not_found", "Gist 地址格式错误");

  const body = {
    description: GIST_DESCRIPTION,
    files: { [GIST_FILENAME]: { content } },
    ...(id ? {} : { public: false }),
  };

  const { data } = id
    ? await request<GistResponse>(`/gists/${id}`, {
        token,
        method: "PATCH",
        body,
        timeoutMs: 60_000,
      })
    : await request<GistResponse>("/gists", {
        token,
        method: "POST",
        body,
        timeoutMs: 60_000,
      });

  return {
    gistId: data.id,
    htmlUrl: data.html_url ?? `https://gist.github.com/${data.id}`,
    updatedAt: data.updated_at ?? new Date().toISOString(),
    bytes,
    created: !id,
  };
}

async function fetchRaw(url: string): Promise<string> {
  const guard = withTimeout(60_000);
  try {
    // 不带 Authorization：raw 域名不需要 token，也避免把 PAT 发出去
    const res = await fetch(url, { signal: guard.signal });
    if (!res.ok) throw new CloudSyncError("http", `下载快照失败（${res.status}）`);
    return await res.text();
  } catch (error) {
    if (error instanceof CloudSyncError) throw error;
    const aborted = (error as Error | undefined)?.name === "AbortError";
    throw new CloudSyncError(
      aborted ? "timeout" : "network",
      aborted ? "下载快照超时" : "下载快照失败",
    );
  } finally {
    guard.done();
  }
}

/** 拉取快照：返回校验后的 payload，由调用方决定合并还是覆盖。 */
export async function pullSnapshot({
  token,
  gistId,
}: {
  token: string;
  gistId: string;
}): Promise<PullResult> {
  if (!token.trim()) throw new CloudSyncError("auth", "请先填写 GitHub PAT");
  const id = normalizeGistId(gistId);
  if (!id) throw new CloudSyncError("not_found", "请填写 Gist id 或链接");

  const { data } = await request<GistResponse>(`/gists/${id}`, {
    token,
    timeoutMs: 30_000,
    retryGet: true,
  });
  const file = data.files?.[GIST_FILENAME];
  if (!file) {
    const names = Object.keys(data.files ?? {});
    throw new CloudSyncError(
      "not_found",
      `Gist 中没有 ${GIST_FILENAME}${names.length ? `（现有：${names.join("、")}）` : ""}`,
    );
  }
  if (typeof file.size === "number" && file.size > GIST_READ_LIMIT) {
    throw new CloudSyncError("too_large", "快照超过 10MB，raw_url 无法完整获取，请改用本地备份");
  }

  let text = file.content ?? "";
  if (file.truncated || !text) {
    if (!file.raw_url) throw new CloudSyncError("invalid_payload", "无法获取完整快照内容");
    text = await fetchRaw(file.raw_url);
  }

  let payload: BackupPayload;
  try {
    payload = parseBackupPayload(text);
  } catch (error) {
    throw new CloudSyncError(
      "invalid_payload",
      error instanceof Error ? error.message : "快照格式错误",
    );
  }

  return {
    payload,
    bytes: bytesOf(text),
    updatedAt: data.updated_at ?? "",
    rawUrl: file.raw_url ?? "",
  };
}
