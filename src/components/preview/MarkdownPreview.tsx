/**
 * MarkdownPreview：渲染结果展示 + 语法高亮主题 + Mermaid 增强。
 *
 * HTML 由 useRenderedMarkdown 生成（markdown-it，html:false 防 XSS）；
 * 本组件只负责注入主题 CSS 与把 ```mermaid 代码块替换成 SVG。
 */
import { useEffect, useRef } from "react";
import hljsLight from "highlight.js/styles/github.css?inline";
import hljsDark from "highlight.js/styles/github-dark.css?inline";
import { useSettingsStore } from "@/stores/settingsStore";

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
    const blocks = Array.from(root.querySelectorAll<HTMLElement>("code.language-mermaid"));
    if (blocks.length === 0) return;

    let alive = true;
    void (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: scheme === "dark" ? "dark" : "default",
      });
      for (const block of blocks) {
        if (!alive) return;
        const code = block.textContent ?? "";
        try {
          const id = `mermaid-${Math.random().toString(36).slice(2)}`;
          const { svg } = await mermaid.render(id, code);
          const pre = block.closest("pre");
          const holder = document.createElement("div");
          holder.className = "mermaid-rendered";
          holder.innerHTML = svg;
          (pre ?? block).replaceWith(holder);
        } catch {
          /* 单个图表失败不影响整篇预览 */
        }
      }
    })();

    return () => {
      alive = false;
    };
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
