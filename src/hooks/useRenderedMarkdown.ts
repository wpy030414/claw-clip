/**
 * Markdown 源码 → HTML（含附件 object URL 水合）。
 *
 * 渲染管线（markdown-it / KaTeX / highlight.js）**按需动态加载**：
 * 只有进入预览/打印时才付出这部分体积，编辑态只加载 CodeMirror。
 * 一次渲染供「预览」「打印」共用，避免两处各自 hydrate 导致 URL 被提前 revoke。
 *
 * 实时预览会随输入触发渲染，这里做 120ms 防抖：连续打字不重复渲染，
 * 但停顿一下就能看到结果。object URL 的回收由 EditorPane 按笔记切换/卸载负责，
 * 不在每次渲染后 revoke（否则图片会在输入过程中反复闪断）。
 */
import { useEffect, useState } from "react";
import { hydrateMarkdown } from "@/data/blobStore";

const PREVIEW_DEBOUNCE = 120;

interface Rendered {
  html: string;
  ready: boolean;
}

export function useRenderedMarkdown(markdown: string, enabled = true): Rendered {
  const [state, setState] = useState<Rendered>({ html: "", ready: false });

  useEffect(() => {
    if (!enabled) {
      setState({ html: "", ready: false });
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        const [{ renderMarkdown }, hydrated] = await Promise.all([
          import("@/utils/markdownRender"),
          hydrateMarkdown(markdown),
        ]);
        if (!alive) return;
        setState({ html: renderMarkdown(hydrated), ready: true });
      })();
    }, PREVIEW_DEBOUNCE);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [markdown, enabled]);

  return enabled ? state : { html: "", ready: false };
}
