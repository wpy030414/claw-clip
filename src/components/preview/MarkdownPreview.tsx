/**
 * MarkdownPreview：渲染结果展示 + 语法高亮主题 + Mermaid 增强。
 *
 * HTML 由 useRenderedMarkdown 生成（markdown-it，html:true 支持手写 HTML，不做 XSS 过滤）；
 * 本组件只负责注入主题 CSS 与把 ```mermaid 代码块替换成 SVG。
 */
import { useEffect, useRef } from "react";
import hljsLight from "highlight.js/styles/github.css?inline";
import hljsDark from "highlight.js/styles/github-dark.css?inline";
import { useSettingsStore } from "@/stores/settingsStore";
import { renderMermaidBlocks } from "@/utils/mermaid";

interface Props {
  html: string;
  css: string;
  className?: string;
  /** 测试定位用；打印根使用独立 testid 避免与可见预览重复。 */
  testId?: string;
}

export function MarkdownPreview({ html, css, className, testId = "md-preview" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scheme = useSettingsStore((s) => s.resolvedScheme);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // 渲染逻辑与 HTML/DOCX/PDF 导出共用（utils/mermaid.ts）；
    // 这里不取消：切走后节点已脱离文档，替换操作无副作用。
    void renderMermaidBlocks(root, {
      theme: scheme === "dark" ? "dark" : "default",
    });
  }, [html, scheme]);

  return (
    <div className={`md-preview ${className ?? ""}`} ref={ref}>
      <style>{scheme === "dark" ? hljsDark : hljsLight}</style>
      <style>{css}</style>
      <div
        className="md-preview-content"
        data-testid={testId}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
