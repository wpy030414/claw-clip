/**
 * 外部集成配置：图床上传目标 + GitHub Gist 同步凭据。
 *
 * 与 settingsStore（主题/编辑器偏好）分开：这里含敏感凭据（PAT），
 * 需要单独的控制（默认记住、可一键清除、未记住时不落盘）。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ImageHostKind, SyncDirection } from "@/types/integration";

interface IntegrationState {
  /** 图片上传目标：本地 IDB（默认）或 img.scdn.io */
  imageHost: ImageHostKind;
  /** GitHub 细粒度/经典 PAT（需要 gist 权限） */
  gistToken: string;
  /** 是否把 PAT 写入 localStorage（默认记住） */
  rememberToken: boolean;
  /** 目标 Gist id（首次推送后自动写入） */
  gistId: string;
  lastSyncAt: number | null;
  lastSyncDirection: SyncDirection | null;
  /** 本机累计上传到图床的张数与字节数（仅展示） */
  imageHostCount: number;
  imageHostBytes: number;

  setImageHost: (host: ImageHostKind) => void;
  setGistToken: (token: string) => void;
  setRememberToken: (remember: boolean) => void;
  setGistId: (id: string) => void;
  recordSync: (direction: SyncDirection, at?: number) => void;
  recordImageUpload: (bytes: number) => void;
  /** 清除 PAT 与 Gist id（不影响图床偏好） */
  clearGist: () => void;
}

export const useIntegrationStore = create<IntegrationState>()(
  persist(
    (set, get) => ({
      imageHost: "local",
      gistToken: "",
      rememberToken: true,
      gistId: "",
      lastSyncAt: null,
      lastSyncDirection: null,
      imageHostCount: 0,
      imageHostBytes: 0,

      setImageHost: (imageHost) => set({ imageHost }),
      setGistToken: (gistToken) => set({ gistToken }),
      setRememberToken: (rememberToken) =>
        // 取消记住时立刻把明文 token 从内存/持久化状态里删掉
        set(rememberToken ? { rememberToken } : { rememberToken, gistToken: "" }),
      setGistId: (gistId) => set({ gistId }),
      recordSync: (lastSyncDirection, lastSyncAt = Date.now()) =>
        set({ lastSyncDirection, lastSyncAt }),
      recordImageUpload: (bytes) =>
        set({
          imageHostCount: get().imageHostCount + 1,
          imageHostBytes: get().imageHostBytes + Math.max(0, bytes),
        }),
      clearGist: () =>
        set({ gistToken: "", gistId: "", lastSyncAt: null, lastSyncDirection: null }),
    }),
    {
      name: "claw-clip-integrations",
      partialize: (s) => ({
        imageHost: s.imageHost,
        rememberToken: s.rememberToken,
        gistId: s.gistId,
        lastSyncAt: s.lastSyncAt,
        lastSyncDirection: s.lastSyncDirection,
        imageHostCount: s.imageHostCount,
        imageHostBytes: s.imageHostBytes,
        // ★ 只有显式记住时才把 PAT 写进 localStorage
        ...(s.rememberToken ? { gistToken: s.gistToken } : {}),
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<IntegrationState>;
        return {
          ...current,
          ...p,
          imageHost: p.imageHost === "scdn" ? "scdn" : "local",
          // 未记住时即使旧数据里有 token 也强制丢弃
          gistToken: p.rememberToken ? (p.gistToken ?? "") : "",
          rememberToken: p.rememberToken ?? current.rememberToken,
        };
      },
    },
  ),
);
