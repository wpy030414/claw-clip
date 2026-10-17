/**
 * Markdown 源码 → HTML（含附件 object URL 水合）。
 *
 * 渲染管线（markdown-it / KaTeX / highlight.js）**按需动态加载**：
 * 只有进入预览/打印时才付出这部分体积，编辑态只加载 CodeMirror。
 * 一次渲染供「预览」「打印」共用，避免两处各自 hydrate 导致 URL 被提前 revoke。
 *
 * 返回 `ready`：渲染是否完成（空文档也算完成），供「打印前必须等到内容就绪」判断。
 */
import { useEffect, useState } from "react";
import { hydrateMarkdown, releaseBlobUrls } from "@/data/blobStore";

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
    setState((s) => (s.ready ? { ...s, ready: false } : s));
    void (async () => {
      const [{ renderMarkdown }, hydrated] = await Promise.all([
        import("@/utils/markdownRender"),
        hydrateMarkdown(markdown),
      ]);
      if (!alive) return;
      setState({ html: renderMarkdown(hydrated), ready: true });
    })();
    return () => {
      alive = false;
      releaseBlobUrls();
    };
  }, [markdown, enabled]);

  return enabled ? state : { html: "", ready: false };
}
