/**
 * PDF 导出：同源 HTML → 隐藏 iframe → 浏览器打印。
 *
 * 为什么不再截图：html2canvas + jsPDF 只能产出「整页图片」，文字不可选中/搜索、
 * 图表放大模糊、长文档还会撞 canvas 尺寸上限。交给浏览器排版引擎后：
 * - 文字是矢量字体（系统 CJK 字体直接可用，无需内嵌字体）；
 * - Mermaid 是内联 SVG，公式是原生 MathML；
 * - `@page` 与 `break-*` 规则生效，分页不会从段落中间切断。
 *
 * 代价是浏览器会弹出系统打印对话框，由用户选择「另存为 PDF」。
 */
import { buildHtmlDocument } from "./html";
import { prepareExportHtml } from "./prepare";

/** 构建完全自包含的打印文档（图片 data URL、Mermaid 内联 SVG、公式 MathML）。 */
export async function buildPrintDocument(
  title: string,
  bodyHtml: string,
  previewCss: string,
): Promise<string> {
  const body = await prepareExportHtml(bodyHtml, { mermaid: "svg" });
  return buildHtmlDocument(title, body, previewCss, { print: true });
}

/**
 * 把打印文档写进离屏 iframe 并调用 `print()`。
 *
 * 打印前派发顶层 `clawclip:pdf-print` 事件：E2E 用它确认打印被触发
 * （跨 realm 覆写 iframe 内的 `print` 不可靠）。
 */
export async function printHtmlDocument(html: string): Promise<void> {
  if (typeof document === "undefined") throw new Error("打印需要浏览器环境");

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  // 保持桌面宽度，避免 0 宽触发移动端断点；放到视口外不影响当前页面
  iframe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;";
  document.body.appendChild(iframe);

  const cleanup = () => {
    if (iframe.isConnected) iframe.remove();
  };

  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) throw new Error("无法创建打印文档");

    doc.open();
    doc.write(html);
    doc.close();

    // 字体与图片就绪后再打印，避免首屏空白/图表缺失
    if (doc.fonts?.ready) await doc.fonts.ready.catch(() => undefined);
    await Promise.all(
      Array.from(doc.images).map((img) => img.decode().catch(() => undefined)),
    );

    window.dispatchEvent(new CustomEvent("clawclip:pdf-print"));
    win.focus();

    // afterprint 后立即清理；不派发该事件的浏览器兜底 60s
    let timer = 0;
    win.addEventListener(
      "afterprint",
      () => {
        window.clearTimeout(timer);
        cleanup();
      },
      { once: true },
    );
    timer = window.setTimeout(cleanup, 60_000);
    win.print();
  } catch (err) {
    cleanup();
    throw err;
  }
}
