/**
 * 全库备份与危险区。
 *
 * - 导出 `.dat`（BackupPayload JSON，白名单序列化，绝不包含 PAT/设置）；
 * - 导入前先解析并预览，再选择「合并（较新者胜）」或「覆盖（原子替换）」；
 * - 清空全部数据需要输入「清空」二次确认，可选同时清除云同步配置与 PAT。
 */
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toastSuccess } from "@/components/common/Snackbar";
import { backupFilename, parseBackupPayload, serializeBackup } from "@/data/backupFile";
import { downloadText } from "@/data/exchange";
import { formatBytes } from "@/data/stats";
import { useIntegrationStore } from "@/stores/integrationStore";
import { useNotesStore } from "@/stores/notesStore";
import { useUiStore } from "@/stores/uiStore";
import type { BackupPayload } from "@/types/backup";

interface Message {
  kind: "ok" | "error";
  text: string;
}

interface PendingImport {
  filename: string;
  bytes: number;
  payload: BackupPayload;
}

function bytesOf(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BackupSection() {
  const exportBackup = useNotesStore((s) => s.exportBackup);
  const importBackup = useNotesStore((s) => s.importBackup);
  const reset = useNotesStore((s) => s.reset);
  const setCurrentFolderId = useUiStore((s) => s.setCurrentFolderId);
  const setOutline = useUiStore((s) => s.setOutline);
  const clearGist = useIntegrationStore((s) => s.clearGist);
  const navigate = useNavigate();

  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | "clear" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importOverwrite, setImportOverwrite] = useState("");
  const [clearOpen, setClearOpen] = useState(false);
  const [clearInput, setClearInput] = useState("");
  const [clearIntegrations, setClearIntegrations] = useState(false);

  const onExport = async () => {
    setBusy("export");
    setMessage(null);
    try {
      const payload = await exportBackup();
      const text = serializeBackup(payload);
      downloadText(backupFilename(), text, "application/json");
      setMessage({
        kind: "ok",
        text: `已导出 ${payload.notes.length} 条笔记 · ${payload.folders?.length ?? 0} 个文件夹 · ${payload.blobs.length} 个附件（${formatBytes(bytesOf(text))}）`,
      });
    } catch (error) {
      setMessage({ kind: "error", text: `导出失败：${messageOf(error)}` });
    } finally {
      setBusy(null);
    }
  };

  const onPickFile = async (file: File) => {
    setBusy("import");
    setMessage(null);
    setPendingImport(null);
    setImportOverwrite("");
    try {
      const text = await file.text();
      const payload = parseBackupPayload(text);
      setPendingImport({ filename: file.name, bytes: bytesOf(text), payload });
    } catch (error) {
      setMessage({ kind: "error", text: `无法导入：${messageOf(error)}` });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onApplyImport = async () => {
    if (!pendingImport) return;
    if (importMode === "replace" && importOverwrite.trim() !== "覆盖") {
      setMessage({ kind: "error", text: "覆盖导入需要先输入「覆盖」确认" });
      return;
    }
    setBusy("import");
    setMessage(null);
    try {
      await importBackup(pendingImport.payload, importMode);
      setMessage({
        kind: "ok",
        text: `已${importMode === "merge" ? "合并" : "覆盖"}导入 ${pendingImport.payload.notes.length} 条笔记 · ${pendingImport.payload.blobs.length} 个附件`,
      });
      setPendingImport(null);
      setImportOverwrite("");
    } catch (error) {
      setMessage({ kind: "error", text: `导入失败：${messageOf(error)}` });
    } finally {
      setBusy(null);
    }
  };

  const onClearAll = async () => {
    if (clearInput.trim() !== "清空") return;
    setBusy("clear");
    setMessage(null);
    try {
      await reset();
      if (clearIntegrations) clearGist();
      setCurrentFolderId(null);
      setOutline([]);
      setClearOpen(false);
      setClearInput("");
      setClearIntegrations(false);
      navigate("/", { replace: true });
      toastSuccess("已清空全部数据");
    } catch (error) {
      setMessage({ kind: "error", text: `清空失败：${messageOf(error)}` });
    } finally {
      setBusy(null);
    }
  };

  const disabled = busy !== null;

  return (
    <>
      <section className="storage-section" data-testid="storage-backup">
        <h3 className="storage-section-title">
          <span className="material-symbols-outlined" aria-hidden="true">
            backup
          </span>
          全库备份
        </h3>
        <p className="storage-hint">
          导出 `.dat`（JSON）：包含全部笔记、文件夹与附件（base64）。文件不含主题设置、PAT
          或图床偏好。
        </p>
        <div className="storage-actions">
          <button
            type="button"
            className="storage-btn storage-btn--primary"
            data-testid="storage-backup-export"
            disabled={disabled}
            onClick={() => void onExport()}
          >
            {busy === "export" ? "导出中…" : "导出全库备份"}
          </button>
          <button
            type="button"
            className="storage-btn"
            data-testid="storage-backup-import"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
          >
            {busy === "import" ? "读取中…" : "导入备份"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".dat,.json,application/json"
            data-testid="storage-import-input"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPickFile(file);
            }}
          />
        </div>

        {pendingImport && (
          <div className="storage-card" data-testid="storage-import-preview">
            <p className="storage-hint">
              {pendingImport.filename} · {pendingImport.payload.notes.length} 条笔记 ·{" "}
              {pendingImport.payload.folders?.length ?? 0} 个文件夹 ·{" "}
              {pendingImport.payload.blobs.length} 个附件 · {formatBytes(pendingImport.bytes)}
            </p>
            <label className="storage-check">
              <input
                type="radio"
                name="storage-import-mode"
                data-testid="storage-import-mode-merge"
                checked={importMode === "merge"}
                onChange={() => setImportMode("merge")}
              />
              合并导入（较新者胜，本地独有内容保留）
            </label>
            <label className="storage-check">
              <input
                type="radio"
                name="storage-import-mode"
                data-testid="storage-import-mode-replace"
                checked={importMode === "replace"}
                onChange={() => setImportMode("replace")}
              />
              覆盖导入（删除本地未包含在备份中的内容）
            </label>
            {importMode === "replace" && (
              <input
                className="storage-input"
                data-testid="storage-import-overwrite-input"
                value={importOverwrite}
                placeholder="输入「覆盖」以确认"
                onChange={(e) => setImportOverwrite(e.target.value)}
              />
            )}
            <div className="storage-actions">
              <button
                type="button"
                className="storage-btn storage-btn--primary"
                data-testid="storage-import-apply"
                disabled={disabled}
                onClick={() => void onApplyImport()}
              >
                应用备份
              </button>
              <button
                type="button"
                className="storage-btn"
                data-testid="storage-import-cancel"
                onClick={() => {
                  setPendingImport(null);
                  setImportOverwrite("");
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {message && (
          <p
            className={`storage-message storage-message--${message.kind}`}
            data-testid="storage-backup-message"
          >
            {message.text}
          </p>
        )}
      </section>

      <section className="storage-section" data-testid="storage-danger">
        <h3 className="storage-section-title">
          <span className="material-symbols-outlined" aria-hidden="true">
            delete_forever
          </span>
          危险区
        </h3>
        <p className="storage-hint">
          清空会删除全部笔记、文件夹与附件，且无法恢复。主题设置与云同步配置默认保留。
        </p>
        {!clearOpen ? (
          <div className="storage-actions">
            <button
              type="button"
              className="storage-btn storage-btn--danger"
              data-testid="storage-clear"
              disabled={disabled}
              onClick={() => setClearOpen(true)}
            >
              清空全部数据
            </button>
          </div>
        ) : (
          <div className="storage-card" data-testid="storage-clear-panel">
            <label className="storage-label" htmlFor="storage-clear-input">
              输入「清空」以确认
            </label>
            <input
              id="storage-clear-input"
              className="storage-input"
              data-testid="storage-clear-input"
              value={clearInput}
              placeholder="清空"
              onChange={(e) => setClearInput(e.target.value)}
            />
            <label className="storage-check">
              <input
                type="checkbox"
                data-testid="storage-clear-integrations"
                checked={clearIntegrations}
                onChange={(e) => setClearIntegrations(e.target.checked)}
              />
              同时清除云同步配置与 PAT
            </label>
            <div className="storage-actions">
              <button
                type="button"
                className="storage-btn storage-btn--danger"
                data-testid="storage-clear-confirm"
                disabled={disabled || clearInput.trim() !== "清空"}
                onClick={() => void onClearAll()}
              >
                {busy === "clear" ? "清空中…" : "确认清空"}
              </button>
              <button
                type="button"
                className="storage-btn"
                data-testid="storage-clear-cancel"
                onClick={() => {
                  setClearOpen(false);
                  setClearInput("");
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
