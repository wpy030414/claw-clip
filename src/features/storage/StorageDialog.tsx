/**
 * 「存储空间」大 dialog：用量概览 / 云同步 / 图床 / 备份与危险区。
 *
 * 挂在 AppShell（不在移动端 `.note-list-pane { zoom: 1.12 }` 子树内），
 * 打开状态在 uiStore，侧栏收起或断点切换都不会把它卸载。
 */
import { useState, type CSSProperties } from "react";
import { M3eDialog } from "@/components/m3e";
import { useUiStore } from "@/stores/uiStore";
import { BackupSection } from "./BackupSection";
import { CloudSyncSection } from "./CloudSyncSection";
import { ImageHostSection } from "./ImageHostSection";
import { StorageOverview } from "./StorageOverview";
import "@/features/storage/storage.css";

type Section = "overview" | "sync" | "image" | "backup";

const SECTIONS: Array<{ key: Section; label: string; icon: string }> = [
  { key: "overview", label: "概览", icon: "database" },
  { key: "sync", label: "云同步", icon: "cloud_sync" },
  { key: "image", label: "图床", icon: "image" },
  { key: "backup", label: "备份", icon: "backup" },
];

/** M3E dialog 的尺寸由 host 上的 CSS 变量控制（host 是 display: contents）。 */
const DIALOG_STYLE = {
  // min = max：M3E dialog 是 shrink-to-fit，min/max 不同会让内容多的 tab 把 dialog 撑宽
  "--m3e-dialog-min-width": "min(880px, calc(100vw - 48px))",
  "--m3e-dialog-max-width": "min(880px, calc(100vw - 48px))",
  "--m3e-dialog-max-height": "min(760px, calc(100vh - 48px))",
} as CSSProperties;

export function StorageDialog() {
  const open = useUiStore((s) => s.storageDialogOpen);
  const setOpen = useUiStore((s) => s.setStorageDialogOpen);
  const [section, setSection] = useState<Section>("overview");

  return (
    <M3eDialog
      open={open}
      data-testid="storage-dialog"
      onClosed={() => setOpen(false)}
      style={DIALOG_STYLE}
    >
      <span slot="header">存储空间</span>
      <div className="storage-dialog" data-testid="storage-dialog-content">
        <div className="storage-tabs" role="tablist" aria-label="存储空间分区">
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={section === item.key}
              className="storage-tab"
              data-active={section === item.key ? "true" : "false"}
              data-testid={`storage-tab-${item.key}`}
              onClick={() => setSection(item.key)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>

        <div className="storage-body">
          {section === "overview" && <StorageOverview open={open} />}
          {section === "sync" && <CloudSyncSection />}
          {section === "image" && <ImageHostSection />}
          {section === "backup" && <BackupSection />}
        </div>

        <div className="storage-footer">
          <button
            type="button"
            className="storage-btn"
            data-testid="storage-dialog-close"
            onClick={() => setOpen(false)}
          >
            关闭
          </button>
        </div>
      </div>
    </M3eDialog>
  );
}
