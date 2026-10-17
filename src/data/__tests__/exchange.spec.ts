import { describe, expect, it } from "vitest";
import { downloadText, htmlToDocx, importDocument, safeFilename } from "@/data/exchange";

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

  it("不支持的扩展名抛错", async () => {
    const file = new File(["x"], "a.xyz", { type: "text/plain" });
    await expect(importDocument(file)).rejects.toThrow(/不支持/);
  });
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
