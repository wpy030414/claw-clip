/**
 * 云同步：GitHub Gist 手动全量快照。
 *
 * 推送时先组装快照（图片转图床、超限剔除附件），再创建/更新 secret gist；
 * 拉取后由用户显式选择「合并（较新者胜）」或「覆盖（原子替换）」。
 */
import { useState } from "react";
import { pullSnapshot, pushSnapshot, validateGistToken, type PullResult } from "@/data/cloudSync";
import { buildCloudSnapshot } from "@/data/snapshot";
import { formatBytes } from "@/data/stats";
import { useIntegrationStore } from "@/stores/integrationStore";
import { useNotesStore } from "@/stores/notesStore";

type Busy = "validate" | "push" | "pull" | "apply" | null;

interface Message {
  kind: "ok" | "error";
  text: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function CloudSyncSection() {
  const token = useIntegrationStore((s) => s.gistToken);
  const remember = useIntegrationStore((s) => s.rememberToken);
  const gistId = useIntegrationStore((s) => s.gistId);
  const lastSyncAt = useIntegrationStore((s) => s.lastSyncAt);
  const lastDirection = useIntegrationStore((s) => s.lastSyncDirection);
  const setToken = useIntegrationStore((s) => s.setGistToken);
  const setRemember = useIntegrationStore((s) => s.setRememberToken);
  const setGistId = useIntegrationStore((s) => s.setGistId);
  const recordSync = useIntegrationStore((s) => s.recordSync);
  const importBackup = useNotesStore((s) => s.importBackup);

  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [progress, setProgress] = useState("");
  const [pendingPull, setPendingPull] = useState<PullResult | null>(null);
  const [pullMode, setPullMode] = useState<"merge" | "replace">("merge");
  const [overwriteInput, setOverwriteInput] = useState("");

  const disabled = busy !== null;

  const onValidate = async () => {
    setBusy("validate");
    setMessage(null);
    try {
      const user = await validateGistToken(token);
      setMessage({
        kind: "ok",
        text: `已连接 @${user.login}${user.scopes.length ? `（scope：${user.scopes.join(", ")}）` : ""}`,
      });
    } catch (error) {
      setMessage({ kind: "error", text: messageOf(error) });
    } finally {
      setBusy(null);
    }
  };

  const onPush = async () => {
    setBusy("push");
    setMessage(null);
    setProgress("正在统计与组装快照…");
    try {
      const { content, stats } = await buildCloudSnapshot({
        onProgress: (p) =>
          setProgress(p.phase === "images" ? `正在上传图片 ${p.done}/${p.total}` : "正在打包快照…"),
      });
      const result = await pushSnapshot({ token, gistId, content });
      setGistId(result.gistId);
      recordSync("push");

      const parts = [`已推送 ${formatBytes(stats.bytes)}`, `笔记 ${stats.notes} 条`];
      if (stats.imagesUploaded > 0) parts.push(`新上传图片 ${stats.imagesUploaded} 张`);
      if (stats.imagesReused > 0) parts.push(`复用图床缓存 ${stats.imagesReused} 张`);
      if (stats.imagesFailed > 0) parts.push(`${stats.imagesFailed} 张图片上传失败，已内嵌`);
      if (stats.attachmentsOmitted > 0) {
        parts.push(
          `剔除附件 ${stats.attachmentsOmitted} 个（${formatBytes(stats.omittedBytes)}，仅保留本地引用）`,
        );
      }
      setMessage({ kind: "ok", text: parts.join(" · ") });
    } catch (error) {
      setMessage({ kind: "error", text: messageOf(error) });
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const onPull = async () => {
    setBusy("pull");
    setMessage(null);
    setPendingPull(null);
    setOverwriteInput("");
    try {
      const result = await pullSnapshot({ token, gistId });
      setPendingPull(result);
    } catch (error) {
      setMessage({ kind: "error", text: messageOf(error) });
    } finally {
      setBusy(null);
    }
  };

  const onApplyPull = async () => {
    if (!pendingPull) return;
    if (pullMode === "replace" && overwriteInput.trim() !== "覆盖") {
      setMessage({ kind: "error", text: "覆盖导入需要先输入「覆盖」确认" });
      return;
    }
    setBusy("apply");
    setMessage(null);
    try {
      await importBackup(pendingPull.payload, pullMode);
      recordSync("pull");
      setMessage({
        kind: "ok",
        text: `已${pullMode === "merge" ? "合并" : "覆盖"}导入 ${pendingPull.payload.notes.length} 条笔记（${formatBytes(pendingPull.bytes)}）`,
      });
      setPendingPull(null);
      setOverwriteInput("");
    } catch (error) {
      setMessage({ kind: "error", text: messageOf(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="storage-section" data-testid="storage-sync">
      <h3 className="storage-section-title">
        <span className="material-symbols-outlined" aria-hidden="true">
          cloud_sync
        </span>
        云同步（GitHub Gist）
      </h3>

      <div className="storage-warning">
        <span className="material-symbols-outlined" aria-hidden="true">
          warning
        </span>
        <span>
          secret gist 只是不出现在列表里——任何拿到链接的人都能读取快照内容，快照不加密。 PAT
          会以明文保存在本机 localStorage，请使用仅勾选 gist 权限的令牌，勿在共享设备上使用。
        </span>
      </div>

      <div className="storage-field">
        <label className="storage-label" htmlFor="storage-sync-token">
          GitHub Personal Access Token
        </label>
        <div className="storage-inline">
          <input
            id="storage-sync-token"
            className="storage-input"
            data-testid="storage-sync-token"
            type={showToken ? "text" : "password"}
            value={token}
            placeholder="ghp_… 或 github_pat_…"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setToken(e.target.value)}
          />
          <button type="button" className="storage-btn" onClick={() => setShowToken((v) => !v)}>
            {showToken ? "隐藏" : "显示"}
          </button>
          <button
            type="button"
            className="storage-btn"
            onClick={() => {
              setToken("");
              setMessage(null);
            }}
          >
            清除
          </button>
        </div>
        <label className="storage-check">
          <input
            type="checkbox"
            data-testid="storage-sync-remember"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          记住令牌（取消勾选会立即清除本地保存的 token）
        </label>
      </div>

      <div className="storage-field">
        <label className="storage-label" htmlFor="storage-sync-gist-id">
          Gist id 或链接（首次推送后自动填入）
        </label>
        <input
          id="storage-sync-gist-id"
          className="storage-input"
          data-testid="storage-sync-gist-id"
          value={gistId}
          placeholder="https://gist.github.com/… 或裸 id"
          onChange={(e) => setGistId(e.target.value)}
        />
      </div>

      <div className="storage-actions">
        <button
          type="button"
          className="storage-btn"
          data-testid="storage-sync-validate"
          disabled={disabled || !token.trim()}
          onClick={() => void onValidate()}
        >
          校验连接
        </button>
        <button
          type="button"
          className="storage-btn storage-btn--primary"
          data-testid="storage-sync-push"
          disabled={disabled || !token.trim()}
          onClick={() => void onPush()}
        >
          {busy === "push" ? "推送中…" : "推送到 Gist"}
        </button>
        <button
          type="button"
          className="storage-btn"
          data-testid="storage-sync-pull"
          disabled={disabled || !token.trim() || !gistId.trim()}
          onClick={() => void onPull()}
        >
          {busy === "pull" ? "拉取中…" : "从 Gist 拉取"}
        </button>
      </div>

      {progress && <p className="storage-hint">{progress}</p>}
      {message && (
        <p
          className={`storage-message storage-message--${message.kind}`}
          data-testid="storage-sync-message"
        >
          {message.text}
        </p>
      )}

      {pendingPull && (
        <div className="storage-card" data-testid="storage-sync-preview">
          <p className="storage-hint">
            快照：{pendingPull.payload.notes.length} 条笔记 ·{" "}
            {pendingPull.payload.folders?.length ?? 0} 个文件夹 · {pendingPull.payload.blobs.length}{" "}
            个附件 · {formatBytes(pendingPull.bytes)}
            {pendingPull.updatedAt
              ? ` · 远端更新于 ${new Date(pendingPull.updatedAt).toLocaleString()}`
              : ""}
          </p>
          <label className="storage-check">
            <input
              type="radio"
              name="storage-pull-mode"
              data-testid="storage-sync-mode-merge"
              checked={pullMode === "merge"}
              onChange={() => setPullMode("merge")}
            />
            合并导入（较新者胜，本地独有内容保留）
          </label>
          <label className="storage-check">
            <input
              type="radio"
              name="storage-pull-mode"
              data-testid="storage-sync-mode-replace"
              checked={pullMode === "replace"}
              onChange={() => setPullMode("replace")}
            />
            覆盖导入（删除本地未包含在快照中的内容）
          </label>
          {pullMode === "replace" && (
            <input
              className="storage-input"
              data-testid="storage-sync-overwrite-input"
              value={overwriteInput}
              placeholder="输入「覆盖」以确认"
              onChange={(e) => setOverwriteInput(e.target.value)}
            />
          )}
          <div className="storage-actions">
            <button
              type="button"
              className="storage-btn storage-btn--primary"
              data-testid="storage-sync-apply"
              disabled={disabled}
              onClick={() => void onApplyPull()}
            >
              {busy === "apply" ? "导入中…" : "应用快照"}
            </button>
            <button type="button" className="storage-btn" onClick={() => setPendingPull(null)}>
              取消
            </button>
          </div>
        </div>
      )}

      <p className="storage-hint" data-testid="storage-sync-last">
        上次同步：
        {lastSyncAt
          ? `${new Date(lastSyncAt).toLocaleString()}（${lastDirection === "push" ? "推送" : "拉取"}）`
          : "尚未同步"}
        。推送时图片会上传到 img.scdn.io 并写成外链，过大的非图片附件只保留本地引用。
      </p>
    </section>
  );
}
