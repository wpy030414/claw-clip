/**
 * KaTeX → Word 原生公式（OMML）。
 *
 * KaTeX 在 `.katex-mathml` 里保留了原始 TeX（`annotation[encoding="application/x-tex"]`）。
 * `docx@9.11.0` 提供 `docx/math` 子路径的 `latexToMath()`，可把 TeX 直接转成 docx 的
 * 数学组件，由 docx 序列化为 `<m:oMath>`——Word 里是可点击、可编辑的原生公式，
 * 而不是图片或一串乱码文本。
 *
 * `latexToMath()` 对不认识的命令会抛错；调用方据此回退为等宽 TeX 文本。
 * 该模块随 `docx` 一起动态加载，不进入首屏包体。
 */
import type { Math as DocxMath } from "docx/math";

type MathApi = typeof import("docx/math");

let mathApi: MathApi | null = null;

/** 动态加载 `docx/math`（幂等）。在解析 DOM 前调用一次即可。 */
export async function loadMathApi(): Promise<MathApi> {
  mathApi ??= await import("docx/math");
  return mathApi;
}

/** 取 KaTeX 节点里的原始 TeX（错误节点可能没有）。 */
export function katexTex(el: Element): string | null {
  const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
  return tex || null;
}

/** 把一个 `.katex` 节点转为 docx 原生公式；失败返回 null（调用方回退文本）。 */
export function katexToMath(el: Element): DocxMath | null {
  if (!mathApi) return null;
  const tex = katexTex(el);
  if (!tex) return null;
  try {
    const children = mathApi.latexToMath(tex);
    if (children.length === 0) return null;
    return new mathApi.Math({ children });
  } catch {
    return null;
  }
}

/** 测试用：注入已加载的 API，避免动态 import。 */
export function __setMathApiForTest(api: MathApi | null): void {
  mathApi = api;
}
