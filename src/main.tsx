import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { datasource } from "@/data/datasource";
import "@/styles/fonts.css";
import "@/styles/global.css";
import "@/styles/tokens.css";
import "@/styles/scrollbar.css";
import "@/styles/layout.css";
import "katex/dist/katex.min.css";

/**
 * 启动引导：先校准附件引用计数，再渲染。
 *
 * 旧版本/异常退出可能留下「没有笔记引用」的 blob（或缺失 refCount 的旧记录）。
 * 这一步以笔记正文为准重算并回收，避免孤儿附件长期占着 IndexedDB；
 * 失败不阻塞应用启动（数据仍在，只是本次不回收）。
 */
async function bootstrap(): Promise<void> {
  try {
    const { purged } = await datasource.reconcileAttachmentRefs();
    if (purged > 0) {
      console.info(`[claw-clip] 已回收 ${purged} 个无引用附件`);
    }
  } catch (err) {
    console.warn("[claw-clip] 附件引用计数校准失败，跳过本次回收", err);
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
