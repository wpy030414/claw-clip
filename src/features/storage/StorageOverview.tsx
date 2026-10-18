/**
 * 存储概览：浏览器配额、四张表的载荷分解、按笔记/附件排行。
 *
 * 三种数字口径（UI 中明确区分，避免误解）：
 * - 本应用数据：IDB 记录的 JSON + 附件二进制，近似值；
 * - IndexedDB 实际占用：浏览器 usageDetails.indexedDB（含索引/页开销）；
 * - 整站配额：navigator.storage.estimate 的 usage / quota。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatBytes } from "@/data/stats";
import {
  getStorageReport,
  requestPersistentStorage,
  type StorageReport,
} from "@/data/storageReport";
import { useNotesStore } from "@/stores/notesStore";
import { useUiStore } from "@/stores/uiStore";

const TOP_LIMIT = 10;

function percent(part: number | null, total: number | null): number {
  if (!part || !total || total <= 0) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}

function timeText(at: number): string {
  return new Date(at).toLocaleString();
}

export function StorageOverview({ open }: { open: boolean }) {
  const revision = useNotesStore((s) => s.revision);
  const dataEpoch = useNotesStore((s) => s.dataEpoch);
  const setDialogOpen = useUiStore((s) => s.setStorageDialogOpen);
  const navigate = useNavigate();
  const [report, setReport] = useState<StorageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [showAllBlobs, setShowAllBlobs] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setLoading(true);
    try {
      const next = await getStorageReport();
      if (seq === requestSeq.current) {
        setReport(next);
        setError(null);
      }
    } catch (e) {
      if (seq === requestSeq.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // 打开期间数据变化：400ms 防抖后重算（与侧栏统计一致）
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => void load(), 400);
    return () => clearTimeout(timer);
  }, [open, revision, dataEpoch, load]);

  const openNote = (id: string) => {
    setDialogOpen(false);
    navigate(`/n/${id}`);
  };

  if (loading && !report) {
    return <p className="storage-hint">统计中…</p>;
  }
  if (error && !report) {
    return (
      <div className="storage-section">
        <p className="storage-message storage-message--error">统计失败：{error}</p>
        <div className="storage-actions">
          <button type="button" className="storage-btn" onClick={() => void load()}>
            重试
          </button>
        </div>
      </div>
    );
  }
  if (!report) return null;

  const quota = report.quota;
  const usagePercent = percent(quota.usage, quota.quota);
  const notes = showAllNotes ? report.noteRanking : report.noteRanking.slice(0, TOP_LIMIT);
  const blobs = showAllBlobs
    ? report.attachmentRanking
    : report.attachmentRanking.slice(0, TOP_LIMIT);
  const empty = report.noteCount === 0 && report.attachmentCount === 0;

  return (
    <>
      <section className="storage-section" data-testid="storage-overview">
        <h3 className="storage-section-title">
          <span className="material-symbols-outlined" aria-hidden="true">
            hard_drive
          </span>
          浏览器配额
        </h3>
        <div className="storage-card">
          {quota.supported && quota.quota !== null ? (
            <div className="storage-quota" data-testid="storage-quota">
              <div className="storage-quota-head">
                <span>
                  整站已用 <strong>{formatBytes(quota.usage ?? 0)}</strong> /{" "}
                  {formatBytes(quota.quota)}
                </span>
                <span>{usagePercent < 1 ? "<1" : Math.round(usagePercent)}%</span>
              </div>
              <div
                className="storage-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(usagePercent)}
              >
                <span style={{ width: `${Math.max(1, usagePercent)}%` }} />
              </div>
              <p className="storage-hint">
                本应用数据 {formatBytes(report.appBytes)}（含附件二进制{" "}
                {formatBytes(report.binaryBytes)}）
                {quota.indexedDbUsage !== null
                  ? ` · IndexedDB 实际占用 ${formatBytes(quota.indexedDbUsage)}`
                  : ""}
                {quota.available !== null ? ` · 剩余 ${formatBytes(quota.available)}` : ""}
              </p>
            </div>
          ) : (
            <p className="storage-hint">浏览器未提供配额信息（不影响本地使用）。</p>
          )}
          <div className="storage-inline">
            <span className="storage-hint">
              持久化状态：{quota.persisted ? "已持久化，数据不易被自动清理" : "未持久化"}
            </span>
            {!quota.persisted && (
              <button
                type="button"
                className="storage-btn"
                data-testid="storage-persist"
                onClick={async () => {
                  await requestPersistentStorage();
                  await load();
                }}
              >
                申请持久化
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="storage-section">
        <h3 className="storage-section-title">
          <span className="material-symbols-outlined" aria-hidden="true">
            database
          </span>
          数据分解
        </h3>
        <div className="storage-card storage-card--plain">
          <div className="storage-rows">
            {[
              { key: "notes", label: "笔记", icon: "description", usage: report.stores.notes },
              { key: "folders", label: "文件夹", icon: "folder", usage: report.stores.folders },
              { key: "blobs", label: "附件", icon: "attachment", usage: report.stores.blobs },
              { key: "meta", label: "其他", icon: "tune", usage: report.stores.meta },
            ].map((row) => (
              <div className="storage-row" key={row.key} data-testid={`storage-store-${row.key}`}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {row.icon}
                </span>
                <span className="storage-row-label">
                  {row.label}（{row.usage.count}）
                </span>
                <span className="storage-row-spacer" />
                <span className="storage-row-size">{formatBytes(row.usage.bytes)}</span>
              </div>
            ))}
            <div className="storage-row">
              <span className="material-symbols-outlined" aria-hidden="true">
                functions
              </span>
              <span className="storage-row-label">本应用数据合计</span>
              <span className="storage-row-spacer" />
              <span className="storage-row-size">{formatBytes(report.appBytes)}</span>
            </div>
            {report.orphanBytes > 0 && (
              <p className="storage-hint">
                其中无引用附件 {formatBytes(report.orphanBytes)}，会在启动校准或导入后被回收。
              </p>
            )}
          </div>
        </div>
      </section>

      {empty ? (
        <p className="storage-hint" data-testid="storage-empty">
          还没有任何笔记数据，写点什么吧。
        </p>
      ) : (
        <>
          <section className="storage-section">
            <h3 className="storage-section-title">
              <span className="material-symbols-outlined" aria-hidden="true">
                description
              </span>
              笔记占用排行
            </h3>
            <ul className="storage-rank" data-testid="storage-note-ranking">
              {notes.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="storage-rank-row"
                    data-testid={`storage-note-row-${item.id}`}
                    onClick={() => openNote(item.id)}
                  >
                    <span className="storage-rank-title">{item.title || "未命名"}</span>
                    <span className="storage-rank-meta">{formatBytes(item.totalBytes)}</span>
                    <span className="storage-rank-sub">
                      正文 {formatBytes(item.recordBytes)}
                      {item.attachmentCount > 0
                        ? ` · 附件 ${item.attachmentCount} 个（均摊 ${formatBytes(item.attachmentBytes)}）`
                        : ""}
                      {item.sharedAttachmentCount > 0 ? " · 含共享附件" : ""}
                      {` · ${timeText(item.updatedAt)}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {report.noteRanking.length > TOP_LIMIT && (
              <button
                type="button"
                className="storage-btn"
                onClick={() => setShowAllNotes((v) => !v)}
              >
                {showAllNotes ? "收起" : `显示全部（${report.noteRanking.length}）`}
              </button>
            )}
          </section>

          {report.attachmentRanking.length > 0 && (
            <section className="storage-section">
              <h3 className="storage-section-title">
                <span className="material-symbols-outlined" aria-hidden="true">
                  attachment
                </span>
                附件占用排行
              </h3>
              <ul className="storage-rank" data-testid="storage-blob-ranking">
                {blobs.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="storage-rank-row"
                      data-testid={`storage-blob-row-${item.id}`}
                      disabled={item.ownerIds.length !== 1}
                      onClick={() => {
                        const owner = item.ownerIds[0];
                        if (owner) openNote(owner);
                      }}
                    >
                      <span className="storage-rank-title">
                        {item.mime || "application/octet-stream"}
                        {item.shared && <span className="storage-tag">共享</span>}
                        {item.orphan && <span className="storage-tag">无引用</span>}
                      </span>
                      <span className="storage-rank-meta">{formatBytes(item.size)}</span>
                      <span className="storage-rank-sub">
                        {item.ownerTitles.length > 0
                          ? `引用：${item.ownerTitles.join("、")}`
                          : "没有笔记引用"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {report.attachmentRanking.length > TOP_LIMIT && (
                <button
                  type="button"
                  className="storage-btn"
                  onClick={() => setShowAllBlobs((v) => !v)}
                >
                  {showAllBlobs ? "收起" : `显示全部（${report.attachmentRanking.length}）`}
                </button>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
