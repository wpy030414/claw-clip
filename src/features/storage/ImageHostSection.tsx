/**
 * 图床设置：上传目标（本地 IndexedDB / img.scdn.io）与整库迁移。
 *
 * 「全部迁移到当前目标」：目标为图床时把所有被引用的本地图片上传并改写引用；
 * 目标为本地时把所有外链图片下载回 IDB 并改写引用。迁移是**逐张一致**的：
 * 中途刷新后重跑不会重复处理已完成的图片。
 */
import { useState } from "react";
import {
  migrateHostImagesToLocal,
  migrateLocalImagesToHost,
  type MigrationResult,
} from "@/data/imageMigration";
import { formatBytes } from "@/data/stats";
import { flushActiveEditor } from "@/features/editor/activeEditor";
import { useIntegrationStore } from "@/stores/integrationStore";
import { useNotesStore } from "@/stores/notesStore";
import { useTaskProgressStore } from "@/stores/taskProgressStore";
import type { ImageHostKind } from "@/types/integration";

const OPTIONS: Array<{ kind: ImageHostKind; icon: string; title: string; desc: string }> = [
  {
    kind: "local",
    icon: "database",
    title: "本地 IndexedDB（默认）",
    desc: "随笔记保存，参与本地备份与云快照；删除笔记时按引用计数回收。",
  },
  {
    kind: "scdn",
    icon: "cloud_upload",
    title: "img.scdn.io 图床",
    desc: "上传后正文写外链，不占本地空间；图片公开可读，60 天无人访问会被自动删除。",
  },
];

interface Message {
  kind: "ok" | "error";
  text: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ImageHostSection() {
  const imageHost = useIntegrationStore((s) => s.imageHost);
  const count = useIntegrationStore((s) => s.imageHostCount);
  const bytes = useIntegrationStore((s) => s.imageHostBytes);
  const setImageHost = useIntegrationStore((s) => s.setImageHost);
  const beginBulkMutation = useNotesStore((s) => s.beginBulkMutation);
  const finishBulkMutation = useNotesStore((s) => s.finishBulkMutation);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [summary, setSummary] = useState<MigrationResult | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const direction = imageHost === "scdn" ? "upload" : "download";
  const migrateLabel = direction === "upload" ? "全部上传到图床" : "全部下载到本地";

  const runMigration = async () => {
    const task = useTaskProgressStore.getState();
    const taskId = task.begin(
      direction === "upload" ? "正在上传图片到图床" : "正在下载图片到本地",
      0,
    );
    if (taskId === null) {
      setMessage({ kind: "error", text: "已有图片任务正在进行，请稍后再试" });
      return;
    }

    setMigrating(true);
    setConfirmOpen(false);
    setMessage(null);
    setSummary(null);
    let started = false;
    try {
      // 1) 先把编辑器里的实时内容落库，避免迁移后被未保存的旧内容覆盖
      await flushActiveEditor();
      // 2) 换代际并等待在途写入
      await beginBulkMutation();
      started = true;

      const run = direction === "upload" ? migrateLocalImagesToHost : migrateHostImagesToLocal;
      const result = await run({
        onProgress: (progress) =>
          useTaskProgressStore.getState().update(taskId, {
            done: progress.done,
            total: progress.total,
            detail: progress.detail,
          }),
        onSpeed: (speed) => useTaskProgressStore.getState().update(taskId, { speed }),
      });
      setSummary(result);
      if (result.failed === 0) {
        setMessage({
          kind: "ok",
          text:
            direction === "upload"
              ? `已把 ${result.migrated} 张本地图片迁移到图床`
              : `已把 ${result.migrated} 张外链图片下载到本地`,
        });
      }
    } catch (error) {
      setMessage({ kind: "error", text: `迁移失败：${messageOf(error)}` });
    } finally {
      if (started) {
        try {
          // 3) 清缓存、换代际、重载树与当前笔记（编辑器重挂载）
          await finishBulkMutation();
        } catch (error) {
          setMessage({
            kind: "error",
            text: `迁移已完成，但刷新界面失败：${messageOf(error)}（重新打开页面即可）`,
          });
        }
      }
      useTaskProgressStore.getState().end(taskId);
      setMigrating(false);
    }
  };

  return (
    <section className="storage-section" data-testid="storage-image">
      <h3 className="storage-section-title">
        <span className="material-symbols-outlined" aria-hidden="true">
          image
        </span>
        图片上传目标
      </h3>

      <div className="storage-section">
        {OPTIONS.map((option) => (
          <button
            key={option.kind}
            type="button"
            className="storage-radio-card"
            data-active={imageHost === option.kind ? "true" : "false"}
            data-testid={`storage-image-host-${option.kind}`}
            onClick={() => setImageHost(option.kind)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {option.icon}
            </span>
            <span className="storage-radio-text">
              <strong>{option.title}</strong>
              <span>{option.desc}</span>
            </span>
          </button>
        ))}
      </div>

      {imageHost === "scdn" && (
        <div className="storage-warning" data-testid="storage-image-warning">
          <span className="material-symbols-outlined" aria-hidden="true">
            warning
          </span>
          <span>
            图床会在图片 60 天无人访问后自动删除；外链不参与本地引用计数，删除笔记不会删除远端图片，
            也不会进入本地备份或云快照。重要图片建议保留在本地。
          </span>
        </div>
      )}

      <div className="storage-card storage-card--plain" data-testid="storage-image-migrate">
        <h4 className="storage-section-title">
          <span className="material-symbols-outlined" aria-hidden="true">
            sync_alt
          </span>
          全部迁移到当前目标
        </h4>
        <p className="storage-hint">
          {direction === "upload"
            ? "把所有被正文引用的本地图片上传到 img.scdn.io，并把引用改为外链；上传成功后本地副本会被回收。"
            : "把所有正文里的外链图片下载到本地 IndexedDB，并把引用改为本地附件；无法跨域读取的图片会被跳过，远端图片不会删除。"}
        </p>
        {!confirmOpen ? (
          <div className="storage-actions">
            <button
              type="button"
              className="storage-btn"
              data-testid="storage-image-migrate-start"
              disabled={migrating}
              onClick={() => {
                setConfirmOpen(true);
                setMessage(null);
              }}
            >
              {migrateLabel}
            </button>
          </div>
        ) : (
          <div className="storage-card" data-testid="storage-image-migrate-confirm">
            <p className="storage-warning">
              <span className="material-symbols-outlined" aria-hidden="true">
                warning
              </span>
              <span>
                {direction === "upload"
                  ? "上传成功后本地图片会被回收；图床图片公开可读且 60 天无人访问会删除，外链失效后笔记将缺图。"
                  : "下载会把外链图片复制到本地，但无法验证远端内容；跨域受限的图片会跳过。远端图片不会被删除。"}
                迁移期间请勿刷新或关闭页面。
              </span>
            </p>
            <div className="storage-actions">
              <button
                type="button"
                className="storage-btn storage-btn--primary"
                data-testid="storage-image-migrate-confirm-button"
                disabled={migrating}
                onClick={() => void runMigration()}
              >
                确认迁移
              </button>
              <button
                type="button"
                className="storage-btn"
                data-testid="storage-image-migrate-cancel"
                onClick={() => setConfirmOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {message && (
          <p
            className={`storage-message storage-message--${message.kind}`}
            data-testid="storage-image-migrate-message"
          >
            {message.text}
          </p>
        )}
        {summary && (
          <div className="storage-hint" data-testid="storage-image-migrate-summary">
            <p>
              成功 {summary.migrated} 张 · 失败 {summary.failed} 张
            </p>
            {summary.errors.length > 0 && (
              <ul className="storage-migrate-errors">
                {summary.errors.slice(0, 3).map((error) => (
                  <li key={error}>{error}</li>
                ))}
                {summary.failed > summary.errors.length && (
                  <li>其余 {summary.failed - summary.errors.length} 个错误略</li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      <p className="storage-hint">
        本机累计上传：{count} 张 · {formatBytes(bytes)}。仅统计开启图床后上传成功的图片。
      </p>
      <p className="storage-hint">
        提示：导出 HTML/PDF 时会尝试把外链图片内联为 data URL；若 CDN 不允许跨域读取，
        导出文件会保留外链（需要联网查看）。DOCX 导出会跳过无法下载的外链图片。
      </p>
    </section>
  );
}
