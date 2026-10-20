/**
 * 「主题」dialog：编辑作用在整个页面的自定义 CSS。
 *
 * 输入即写入 settingsStore.customCss，由 <CustomCss> 同步到 <head> 的 <style>，
 * 所见即所得；「恢复默认」清空后回到内置样式。与 StorageDialog 一样挂在
 * AppShell 上，不随侧栏收起或断点切换卸载。
 */
import type { CSSProperties } from "react";
import { useState } from "react";
import { M3eDialog } from "@/components/m3e";
import { useOverlayScrollbar } from "@/hooks/useOverlayScrollbar";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import "@/features/theme/theme.css";

/** M3E dialog 的尺寸由 host 上的 CSS 变量控制（host 是 display: contents）。 */
const DIALOG_STYLE = {
  "--m3e-dialog-min-width": "min(720px, calc(100vw - 48px))",
  "--m3e-dialog-max-width": "min(720px, calc(100vw - 48px))",
  "--m3e-dialog-max-height": "min(680px, calc(100vh - 48px))",
} as CSSProperties;

const CSS_PLACEHOLDER = `/* 示例：改主色与预览正文宽度 */
m3e-theme {
  --md-sys-color-primary: #6750a4;
}
.md-preview-content {
  max-width: 46rem;
}`;

export function ThemeDialog() {
  const open = useUiStore((s) => s.themeDialogOpen);
  const setOpen = useUiStore((s) => s.setThemeDialogOpen);
  const customCss = useSettingsStore((s) => s.customCss);
  const set = useSettingsStore((s) => s.set);
  /** 自定义 CSS 输入框自己滚动，overlay 缩略条挂到 .theme-dialog 上。 */
  const [cssInput, setCssInput] = useState<HTMLTextAreaElement | null>(null);
  useOverlayScrollbar(cssInput);

  return (
    <M3eDialog
      open={open}
      data-testid="theme-dialog"
      onClosed={() => setOpen(false)}
      style={DIALOG_STYLE}
    >
      <span slot="header">主题</span>
      <div className="theme-dialog">
        <p className="theme-dialog-intro">
          自定义 CSS
          会作用在整个页面（侧栏、编辑器与预览）。输入即时生效，并通过本地设置持久保存；留空则使用内置样式。
        </p>
        <textarea
          ref={setCssInput}
          className="theme-css-input"
          data-testid="theme-css-input"
          aria-label="自定义页面 CSS"
          spellCheck={false}
          placeholder={CSS_PLACEHOLDER}
          value={customCss}
          onChange={(e) => set("customCss", e.target.value)}
        />
        <div className="theme-dialog-footer">
          <span className="theme-css-count" data-testid="theme-css-count">
            {customCss.length} 字符
          </span>
          <div className="theme-dialog-actions">
            <button
              type="button"
              className="theme-btn"
              data-testid="theme-css-reset"
              disabled={!customCss}
              onClick={() => set("customCss", "")}
            >
              恢复默认
            </button>
            <button
              type="button"
              className="theme-btn theme-btn-primary"
              data-testid="theme-dialog-close"
              onClick={() => setOpen(false)}
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </M3eDialog>
  );
}
