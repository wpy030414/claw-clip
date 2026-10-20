import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import katex from "katex";
import JSZip from "jszip";
import {
  buildHtmlDocument,
  buildPrintDocument,
  downloadText,
  htmlToDocx,
  importDocument,
  prepareExportHtml,
  printHtmlDocument,
  safeFilename,
} from "@/data/exchange";
import { katexToMath, loadMathApi } from "@/data/export/math";

// jsdom 下 mammoth 默认解析到 Node 入口（只认 path/buffer），生产构建走 browser
// 入口（认 arrayBuffer）。单测改用浏览器构建，避免测到与线上不同的输入分支。
vi.mock("mammoth", async () => {
  const mammoth = await import("mammoth/mammoth.browser.js");
  return { ...mammoth, default: mammoth };
});

// 单测环境没有 Mermaid 运行时；只验证「代码块被替换」这一契约。
vi.mock("@/utils/mermaid", () => ({
  renderMermaidBlocks: vi.fn(async (root: ParentNode) => {
    const code = root.querySelector("code.language-mermaid");
    if (!code) return 0;
    const holder = document.createElement("div");
    holder.className = "mermaid-rendered";
    holder.innerHTML = '<svg viewBox="0 0 10 10"></svg>';
    (code.closest("pre") ?? code).replaceWith(holder);
    return 1;
  }),
}));

describe("safeFilename", () => {
  it("去掉路径分隔符与保留字符", () => {
    expect(safeFilename('a/b:c*?"<>|', "md")).toBe("a_b_c_.md");
  });

  it("空标题回退为「未命名」", () => {
    expect(safeFilename("   ", "md")).toBe("未命名.md");
  });
});

describe("importDocument", () => {
  it("导入 Markdown 保留原文，标题取文件名", async () => {
    const file = new File(["# 标题\n\n正文"], "我的笔记.md", { type: "text/markdown" });
    const doc = await importDocument(file);
    expect(doc.title).toBe("我的笔记");
    expect(doc.content).toBe("# 标题\n\n正文");
  });

  it("front matter 的 title 优先于文件名，正文逐字节保留", async () => {
    const content = "---\ntitle: 属性标题\ntags: [工作]\n---\n\n# 正文标题\n";
    const file = new File([content], "文件名.md", { type: "text/markdown" });
    const doc = await importDocument(file);
    expect(doc.title).toBe("属性标题");
    expect(doc.content).toBe(content);
  });

  it("不支持的扩展名抛错", async () => {
    const file = new File(["x"], "a.xyz", { type: "text/plain" });
    await expect(importDocument(file)).rejects.toThrow(/不支持/);
  });

  it("DOCX 内嵌图片交给 onImage，正文不再内联 base64", async () => {
    const { Document, ImageRun, Packer, Paragraph } = await import("docx");
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (char) => char.charCodeAt(0),
    );
    const source = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new ImageRun({
                  data: png,
                  type: "png",
                  transformation: { width: 8, height: 8 },
                }),
              ],
            }),
          ],
        },
      ],
    });
    const blob = await Packer.toBlob(source);
    const file = new File([blob], "带图文档.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    // Node Blob 的 arrayBuffer() 与 jsdom 不同 realm，mammoth 浏览器包用 instanceof
    // 判定类型会失败；改传当前 realm 的 Uint8Array（JSZip 同样接受）。
    const original = file.arrayBuffer.bind(file);
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array(await original()) as unknown as ArrayBuffer,
    });

    const images: Blob[] = [];
    const doc = await importDocument(file, {
      onImage: async (image) => {
        images.push(image);
        return `clawclip-import://image/${images.length - 1}`;
      },
    });

    expect(images).toHaveLength(1);
    expect(images[0].type).toBe("image/png");
    expect(doc.content).toContain("clawclip-import://image/0");
    expect(doc.content).not.toContain("data:image");
  }, 20_000);
});

describe("htmlToDocx", () => {
  it("把标题/段落/表格/列表转成 docx Blob", async () => {
    const html =
      "<h1>标题</h1><p>正文 <strong>加粗</strong></p><ul><li>一</li><li>二</li></ul>" +
      "<table><tr><th>A</th></tr><tr><td>1</td></tr></table><pre>code</pre>";
    const blob = await htmlToDocx(html, "测试");
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toContain("wordprocessingml");
  }, 20_000);

  it("公式导出为 Word 原生 OMML（m:oMath），不再混入 KaTeX 文本", async () => {
    const tex = katex.renderToString("\\frac{a}{b}", { throwOnError: false });
    const blob = await htmlToDocx(`<p>公式：${tex}</p>`, "公式测试");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toContain("<m:oMath>");
    expect(xml).toContain("<m:f>");
    // KaTeX 的 MathML annotation 不应作为普通文本进入正文
    expect(xml).not.toContain("application/x-tex");
  }, 20_000);
});

describe("downloadText", () => {
  it("创建并点击下载链接后清理 DOM", () => {
    let clicked = 0;
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (() => "blob:mock") as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    const spy = document.createElement("a");
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicked += 1;
    };

    downloadText("a.md", "# hi");
    expect(clicked).toBe(1);
    expect(document.querySelectorAll('a[download="a.md"]')).toHaveLength(0);

    HTMLAnchorElement.prototype.click = origClick;
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    void spy;
  });
});

describe("prepareExportHtml（自包含导出）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("把 blob: 图片内联为 data URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      })),
    );
    const html = await prepareExportHtml('<p><img src="blob:mock/1" /></p>', {
      mermaid: "none",
    });
    expect(html).toContain('src="data:image/png;base64,');
  });

  it("data URL 原样保留，不重复请求", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const html = await prepareExportHtml('<img src="data:image/png;base64,AAAA" />', {
      mermaid: "none",
    });
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("资源取不到时保留原 URL，不阻断导出", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const html = await prepareExportHtml('<img src="blob:mock/fail" />', { mermaid: "none" });
    expect(html).toContain('src="blob:mock/fail"');
  });

  it("Mermaid 代码块被替换为内联图表", async () => {
    const html = await prepareExportHtml(
      '<pre><code class="language-mermaid">graph TD; A-->B</code></pre>',
      { mermaid: "svg" },
    );
    expect(html).toContain('class="mermaid-rendered"');
    expect(html).toContain("<svg");
    expect(html).not.toContain("language-mermaid");
  });
});

describe("buildPrintDocument", () => {
  it("HTML 导出强制浅色主题，不跟随系统深色偏好", async () => {
    const doc = await buildHtmlDocument("浅色测试", "<h1>标题</h1>", ".x{}");
    expect(doc).toContain("color-scheme: light;");
    expect(doc).not.toContain("prefers-color-scheme: dark");
  });

  it("强制浅色纸面并带 A4 分页规则", async () => {
    const doc = await buildPrintDocument(
      "打印测试",
      '<h1>标题</h1><pre><code class="language-mermaid">graph TD; A-->B</code></pre>',
      ".md-preview-content { color: red; }",
    );
    expect(doc).toContain("@page");
    expect(doc).toContain("color-scheme: light;");
    expect(doc).not.toContain("prefers-color-scheme: dark");
    expect(doc).toContain("<svg");
    expect(doc).toContain("打印测试");
  });
});

describe("katexToMath（Word 原生公式）", () => {
  it("latexToMath 覆盖常见结构", async () => {
    const api = await loadMathApi();
    expect(api.latexToMath("\\frac{a}{b}")[0].constructor.name).toBe("MathFraction");
    expect(api.latexToMath("\\sqrt[3]{x}")[0].constructor.name).toBe("MathRadical");
    expect(api.latexToMath("\\hat{x}")[0].constructor.name).toBe("MathAccent");
    expect(api.latexToMath("\\begin{matrix}a&b\\\\c&d\\end{matrix}")[0].constructor.name).toBe(
      "MathMatrix",
    );
  });

  it("把 KaTeX 节点转成 docx Math；未知命令返回 null", async () => {
    await loadMathApi();
    const host = document.createElement("div");
    host.innerHTML = katex.renderToString("a^2+b^2=c^2", { throwOnError: false });
    const math = katexToMath(host.querySelector(".katex")!);
    expect(math).not.toBeNull();
    const api = await import("docx/math");
    expect(math).toBeInstanceOf(api.Math);

    const bad = document.createElement("span");
    bad.innerHTML =
      '<span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">\\definitelyUnknown{x}</annotation></semantics></math></span>';
    expect(katexToMath(bad)).toBeNull();
  });
});

describe("printHtmlDocument", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("写入打印机文档并触发打印与事件", async () => {
    const listeners = new Map<string, () => void>();
    const win = {
      focus: vi.fn(),
      print: vi.fn(),
      addEventListener: vi.fn((type: string, cb: () => void, _opts?: unknown) => {
        listeners.set(type, cb);
      }),
    };
    const doc = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
      fonts: { ready: Promise.resolve() },
      images: [],
    };
    const realIframe = document.createElement("iframe");
    Object.defineProperty(realIframe, "contentDocument", { value: doc });
    Object.defineProperty(realIframe, "contentWindow", { value: win });

    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag.toLowerCase() === "iframe" ? realIframe : origCreate(tag),
    );

    const onPrint = vi.fn();
    window.addEventListener("clawclip:pdf-print", onPrint);
    // 模拟浏览器在 print 后派发 afterprint
    win.print.mockImplementation(() => listeners.get("afterprint")?.());

    await printHtmlDocument("<!doctype html><html><body>hi</body></html>");

    expect(doc.write).toHaveBeenCalledWith("<!doctype html><html><body>hi</body></html>");
    expect(win.print).toHaveBeenCalledTimes(1);
    expect(onPrint).toHaveBeenCalledTimes(1);
    window.removeEventListener("clawclip:pdf-print", onPrint);
  });
});
