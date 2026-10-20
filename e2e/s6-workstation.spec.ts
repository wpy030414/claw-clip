import { readFileSync } from "node:fs";
import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * 工作站能力 E2E：文件夹树、导入、导出（MD/DOCX/PDF）、菜单精简与删除确认。
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';
// 1x1 透明 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};

async function dropPng(page: Page): Promise<void> {
  const dataTransfer = await page.evaluateHandle((base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "dot.png", { type: "image/png" }));
    return dt;
  }, PNG.toString("base64"));
  await page.dispatchEvent(EDITOR, "drop", { dataTransfer });
}

async function blobCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("claw-clip-v2");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction("blobs", "readonly");
      const req = tx.objectStore("blobs").count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function mockImageHost(route: Route, url: string): Promise<void> {
  return route.fulfill({
    status: 200,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ success: true, data: { url } }),
  });
}

async function makeDocxWithImage(): Promise<Buffer> {
  const { Document, ImageRun, Packer, Paragraph } = await import("docx");
  const source = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new ImageRun({
                data: Uint8Array.from(PNG),
                type: "png",
                transformation: { width: 8, height: 8 },
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(source));
}

test("笔记树：新建文件夹 → 点击行开合 → 文件夹内/根级新建笔记", async ({ page }) => {
  await page.goto("");

  // 「+」→ 新建文件夹
  await page.getByTestId("btn-new").click();
  await expect(page.getByTestId("create-dialog-content")).toBeVisible();
  await page.getByTestId("create-folder").click();

  const input = page.getByTestId("folder-edit-input").first();
  await expect(input).toBeVisible();
  await input.fill("工作");
  await input.press("Enter");

  const folderRow = page.locator('[data-testid^="folder-row-"]').filter({ hasText: "工作" });
  await expect(folderRow).toBeVisible();

  // 新建文件夹后自动选中并展开；直接新建笔记归入该文件夹
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await expect(page.getByTestId("editor-pane")).toBeVisible();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);

  // 点击文件夹行：收起并取消选中 → 新建根级笔记
  await folderRow.click();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(0);
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);

  // 再次点击：展开并选中 → 两条笔记都可见
  await folderRow.click();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(2);

  // 继续验证开合
  await folderRow.click();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);
  await folderRow.click();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(2);
});

test("文件夹：双击不重命名、三点菜单重命名、不可嵌套、dialog 无关闭按钮", async ({ page }) => {
  await page.goto("");

  // 建两个文件夹：第二个在第一个被选中时创建，仍必须落在根部
  for (const name of ["工作", "个人"]) {
    await page.getByTestId("btn-new").click();
    await page.getByTestId("create-folder").click();
    const input = page.getByTestId("folder-edit-input").first();
    await input.fill(name);
    await input.press("Enter");
  }

  const working = page.locator('[data-testid^="folder-row-"]').filter({ hasText: "工作" });
  const personal = page.locator('[data-testid^="folder-row-"]').filter({ hasText: "个人" });
  await expect(working).toBeVisible();
  await expect(personal).toBeVisible();

  // 不可嵌套：两个文件夹左边界相同（同一层）
  const [workBox, personalBox] = await Promise.all([working.boundingBox(), personal.boundingBox()]);
  expect(workBox && personalBox).toBeTruthy();
  expect(Math.abs(workBox!.x - personalBox!.x)).toBeLessThan(1);

  // 双击名称不触发重命名
  await working.locator(".tree-name").dblclick();
  await expect(page.getByTestId("folder-edit-input")).toHaveCount(0);

  // 三点菜单 → 重命名：输入框右侧出现确认/取消，三点按钮隐藏
  await working.hover();
  await working.locator('[data-testid^="folder-menu-"]').click();
  await expect(page.getByTestId("folder-menu")).toBeVisible();
  await expect(page.getByTestId("folder-menu-rename")).toBeVisible();
  await expect(page.getByTestId("folder-menu-delete")).toBeVisible();
  await page.getByTestId("folder-menu-rename").click();

  const renameInput = page.getByTestId("folder-edit-input");
  await expect(renameInput).toBeVisible();
  await expect(page.getByTestId("folder-rename-confirm")).toBeVisible();
  await expect(page.getByTestId("folder-rename-cancel")).toBeVisible();
  await expect(working.locator('[data-testid^="folder-menu-"]')).toHaveCount(0);

  await renameInput.fill("工作二");
  await page.getByTestId("folder-rename-confirm").click();
  await expect(working).toContainText("工作二");
  await working.hover();
  await expect(working.locator('[data-testid^="folder-menu-"]')).toBeVisible();

  // 取消（✕）不落库：名称保持，编辑态退出后三点按钮回归
  await working.locator('[data-testid^="folder-menu-"]').click();
  await page.getByTestId("folder-menu-rename").click();
  const cancelInput = page.getByTestId("folder-edit-input");
  await cancelInput.fill("不应保存");
  await page.getByTestId("folder-rename-cancel").click();
  await expect(page.getByTestId("folder-edit-input")).toHaveCount(0);
  await expect(working).toContainText("工作二");
  await expect(working).not.toContainText("不应保存");
  await working.hover();
  await expect(working.locator('[data-testid^="folder-menu-"]')).toBeVisible();

  // dialog：没有右上角关闭按钮，也没有底部操作区；文件夹选项说明不可嵌套
  await page.getByTestId("btn-new").click();
  const dialog = page.getByTestId("create-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("create-folder")).toContainText("不支持嵌套");
  await expect(dialog.locator('[slot="actions"]')).toHaveCount(0);
  const hasClose = await dialog.evaluate(
    (el) => !!el.shadowRoot?.querySelector("m3e-icon-button.close"),
  );
  expect(hasClose).toBe(false);

  // 仍可用 Esc 关闭
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("create-dialog-content")).toBeHidden();
});

test("文件夹：删除走 M3E dialog 二次确认", async ({ page }) => {
  await page.goto("");

  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-folder").click();
  const input = page.getByTestId("folder-edit-input").first();
  await input.fill("待删");
  await input.press("Enter");

  const folderRow = page.locator('[data-testid^="folder-row-"]').filter({ hasText: "待删" });
  await expect(folderRow).toBeVisible();

  // 三点菜单 → 删除，打开 M3E dialog（不再走 window.confirm）
  await folderRow.hover();
  await folderRow.locator('[data-testid^="folder-menu-"]').click();
  await page.getByTestId("folder-menu-delete").click();
  await expect(page.getByTestId("delete-folder-dialog")).toBeVisible();
  await expect(page.getByTestId("delete-folder-content")).toContainText("待删");

  // 取消后文件夹仍在
  await page.getByTestId("delete-folder-cancel").click();
  await expect(folderRow).toBeVisible();

  // 再次确认删除后消失
  await folderRow.hover();
  await folderRow.locator('[data-testid^="folder-menu-"]').click();
  await page.getByTestId("folder-menu-delete").click();
  await page.getByTestId("delete-folder-confirm").click();
  await expect(
    page.locator('[data-testid^="folder-row-"]').filter({ hasText: "待删" }),
  ).toHaveCount(0);
});

test("文件夹：拖拽手动排序并持久化", async ({ page }) => {
  await page.goto("");

  for (const name of ["甲", "乙", "丙"]) {
    await page.getByTestId("btn-new").click();
    await page.getByTestId("create-folder").click();
    const input = page.getByTestId("folder-edit-input").first();
    await input.fill(name);
    await input.press("Enter");
  }

  const folderNames = () =>
    page.locator('[data-testid^="folder-row-"] .tree-name').allTextContents();
  await expect.poll(folderNames).toEqual(["甲", "乙", "丙"]);

  // 把「丙」拖到「甲」的上半部分 → 插到最前
  const a = page.locator('[data-testid^="folder-row-"]').filter({ hasText: "甲" });
  const c = page.locator('[data-testid^="folder-row-"]').filter({ hasText: "丙" });
  await c.dragTo(a, { targetPosition: { x: 40, y: 2 } });
  await expect.poll(folderNames, { timeout: 5_000 }).toEqual(["丙", "甲", "乙"]);

  // 刷新后顺序保持（IndexedDB 持久化）
  await page.waitForTimeout(300);
  await page.reload();
  await expect.poll(folderNames, { timeout: 5_000 }).toEqual(["丙", "甲", "乙"]);
});

test("拖拽笔记：拖入文件夹 / 拖到空白处移出", async ({ page }) => {
  await page.goto("");

  // 建文件夹「工作」，创建后自动选中且展开；先收起并取消选中
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-folder").click();
  const input = page.getByTestId("folder-edit-input").first();
  await input.fill("工作");
  await input.press("Enter");
  const folderRow = page.locator('[data-testid^="folder-row-"]').filter({ hasText: "工作" });
  await folderRow.click();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(0);

  // 新建一条根级笔记
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("# 待移动\n\n拖拽测试内容");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  const noteRow = page.locator("[data-testid^='note-link-']").filter({ hasText: "待移动" });
  const indentOf = () => noteRow.evaluate((el) => getComputedStyle(el).paddingLeft);
  await expect.poll(indentOf).toBe("8px");

  // 拖进文件夹 → 缩进变为子级
  await noteRow.dragTo(folderRow);
  await expect.poll(indentOf, { timeout: 5_000 }).toBe("24px");

  // 拖到树空白处 → 回到顶层
  const body = page.getByTestId("note-tree-body");
  await noteRow.dragTo(body, { targetPosition: { x: 40, y: 260 } });
  await expect.poll(indentOf, { timeout: 5_000 }).toBe("8px");

  // 收起文件夹后笔记仍可见（已经在根级）
  await folderRow.click();
  await expect(noteRow).toHaveCount(1);
});

test("上传笔记：从「+」对话框选择文件导入", async ({ page }) => {
  await page.goto("");

  await page.getByTestId("btn-new").click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-note").click(),
  ]);
  await chooser.setFiles({
    name: "对话框导入.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 对话框导入\n\n正文内容", "utf-8"),
  });

  await expect(page.getByTestId("editor-title")).toHaveText("对话框导入", { timeout: 10_000 });
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);
});

test("拖文件到侧栏文档区：直接导入并打开", async ({ page }) => {
  await page.goto("");

  const body = page.getByTestId("note-tree-body");
  const transfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(
      new File(["# 拖入标题\n\n拖入正文内容"], "拖入导入.md", { type: "text/markdown" }),
    );
    return dt;
  });

  // 文件悬停：整块树区域给出「松开以导入」提示
  await body.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(page.getByTestId("file-drop-overlay")).toBeVisible();

  await body.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByTestId("file-drop-overlay")).toHaveCount(0);
  await expect(page.getByTestId("editor-title")).toHaveText("拖入导入", { timeout: 10_000 });
  await expect(page.getByTestId("md-preview").locator("h1").first()).toContainText("拖入标题");
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);

  // 拖到已有笔记行上也成立：行内不拦截文件拖拽，冒泡到树容器统一导入
  const second = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["# 第二份"], "第二份.md", { type: "text/markdown" }));
    return dt;
  });
  const row = page.locator("[data-testid^='note-link-']").first();
  await row.dispatchEvent("dragover", { dataTransfer: second });
  await expect(page.getByTestId("file-drop-overlay")).toBeVisible();
  await row.dispatchEvent("drop", { dataTransfer: second });
  await expect.poll(async () => page.locator("[data-testid^='note-link-']").count()).toBe(2);
});

test("导入 Markdown → 新建笔记并进入编辑器", async ({ page }) => {
  await page.goto("");

  await page.getByTestId("import-input").setInputFiles({
    name: "导入的文档.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 导入标题\n\n这里是正文内容。", "utf-8"),
  });

  // 标题取自文件名；正文里的 H1 仍在预览中呈现
  await expect(page.getByTestId("editor-title")).toHaveText("导入的文档", { timeout: 10_000 });
  // 右侧实时预览渲染导入的 H1
  await expect(page.getByTestId("md-preview").locator("h1").first()).toContainText("导入标题", {
    timeout: 10_000,
  });
  // 没有 tags 时不渲染空 chip 行
  await expect(page.getByTestId("note-tags")).toHaveCount(0);
});

test("导入 Markdown：内联 base64 存进 IDB，其它图床外链保持原样", async ({ page }) => {
  await page.goto("");

  const dataUrl = `data:image/png;base64,${PNG.toString("base64")}`;
  await page.getByTestId("import-input").setInputFiles({
    name: "带图笔记.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      `# 内联图片\n\n![内联](${dataUrl})\n\n![外链](https://other.example/x.png)`,
      "utf8",
    ),
  });

  await expect(page.getByTestId("editor-title")).toHaveText("带图笔记", { timeout: 10_000 });
  const source = page.locator(EDITOR).first();
  await expect
    .poll(async () => source.innerText(), { timeout: 10_000 })
    .toContain("clawclip://blob/");
  const text = await source.innerText();
  expect(text).toContain("https://other.example/x.png");
  expect(text).not.toContain("data:image");
  expect(await blobCount(page)).toBe(1);
});

test("导入 DOCX：内嵌图片存进 IDB，不再内联 base64", async ({ page }) => {
  await page.goto("");

  const buffer = await makeDocxWithImage();
  await page.getByTestId("import-input").setInputFiles({
    name: "带图文档.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
  });

  await expect(page.getByTestId("editor-title")).toHaveText("带图文档", { timeout: 15_000 });
  const source = page.locator(EDITOR).first();
  await expect
    .poll(async () => source.innerText(), { timeout: 10_000 })
    .toContain("clawclip://blob/");
  expect(await source.innerText()).not.toContain("data:image");
  expect(await blobCount(page)).toBe(1);
});

test("front matter：导入取 title、预览隐藏、MD 导出保留原文", async ({ page }) => {
  await page.goto("");

  const content = [
    "---",
    "title: 属性标题",
    "tags: [工作, 笔记]",
    "---",
    "",
    "# 正文标题",
    "",
    "正文内容。",
  ].join("\n");

  await page.getByTestId("import-input").setInputFiles({
    name: "带属性.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(content, "utf-8"),
  });

  // front matter 的 title 优先于文件名
  await expect(page.getByTestId("editor-title")).toHaveText("属性标题", { timeout: 10_000 });

  // 侧栏笔记行：正文预览下方以 chip 展示 front matter 的 tags
  const row = page.locator("[data-testid^='note-link-']").first();
  await expect(row.getByTestId("note-tags")).toBeVisible();
  await expect(row.getByTestId("note-tags")).toContainText("#工作");
  await expect(row.getByTestId("note-tags")).toContainText("#笔记");

  // 预览只渲染正文；元数据与分隔线不出现
  const preview = page.getByTestId("md-preview");
  await expect(preview.locator("h1").first()).toContainText("正文标题");
  await expect(preview).not.toContainText("tags:");
  await expect(preview).not.toContainText("属性标题");

  // 源码编辑区保留原文，可继续编辑
  await expect(page.locator(EDITOR)).toContainText("tags: [工作, 笔记]");

  // MD 导出逐字节保留 front matter（导入导出闭环）
  await page.getByTestId("btn-menu").click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10_000 }),
    page.getByTestId("menu-export-md").click(),
  ]);
  const exported = readFileSync((await download.path())!, "utf-8");
  expect(exported).toContain("---\ntitle: 属性标题");
  expect(exported).toContain("tags: [工作, 笔记]");
});

test("导出 Markdown：本地图片转图床外链，笔记仍保留本地引用", async ({ page }) => {
  await page.route("https://img.scdn.io/**", (route) =>
    mockImageHost(route, "https://img.cdn1.vip/i/exported.webp"),
  );

  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  await dropPng(page);
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await page.getByTestId("btn-menu").click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByTestId("menu-export-md").click(),
  ]);
  const exported = readFileSync((await download.path())!, "utf-8");
  expect(exported).toContain("https://img.cdn1.vip/i/exported.webp");
  expect(exported).not.toContain("clawclip://");

  // 导出只改副本：笔记正文与本地附件都不动
  await expect
    .poll(async () => page.locator(EDITOR).first().innerText(), { timeout: 5_000 })
    .toContain("clawclip://blob/");
  expect(await blobCount(page)).toBe(1);
});

test("导出 Markdown 与 DOCX", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  // 覆盖公式（原生 OMML）与 Mermaid（PNG）两条 DOCX 高风险路径
  await page.keyboard.insertText(
    "# 导出标题\n\n行内公式 $a^2+b^2=c^2$ 与块级公式：\n\n$$\\frac{a}{b}$$\n\n```mermaid\ngraph TD;\nA-->B;\n```\n\n正文段落。",
  );
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await page.getByTestId("btn-menu").click();
  const [md] = await Promise.all([
    page.waitForEvent("download", { timeout: 10_000 }),
    page.getByTestId("menu-export-md").click(),
  ]);
  expect(md.suggestedFilename()).toMatch(/\.md$/);

  await page.getByTestId("btn-menu").click();
  const [docx] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByTestId("menu-export-docx").click(),
  ]);
  expect(docx.suggestedFilename()).toMatch(/\.docx$/);
  const path = await docx.path();
  expect(path).toBeTruthy();
});

test("导出 PDF：调用浏览器打印（矢量），不再生成图片 PDF", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("# PDF 标题\n\n正文段落。");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await page.evaluate(() => {
    (window as any).__pdfPrintEvents = 0;
    window.addEventListener("clawclip:pdf-print", () => {
      (window as any).__pdfPrintEvents += 1;
    });
  });

  let downloaded = false;
  page.once("download", () => {
    downloaded = true;
  });

  await page.getByTestId("btn-menu").click();
  await page.getByTestId("menu-export-pdf").click();

  // 打印替代了 30s 的位图渲染：事件应在几百毫秒内到达
  await expect
    .poll(async () => page.evaluate(() => (window as any).__pdfPrintEvents as number), {
      timeout: 30_000,
    })
    .toBe(1);
  expect(downloaded).toBe(false);
});

test("导出菜单不再包含重复入口", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });

  await page.getByTestId("btn-menu").click();
  await expect(page.getByTestId("editor-menu")).toBeVisible();
  await expect(page.getByTestId("menu-attach")).toHaveCount(0);
  await expect(page.getByTestId("menu-theme")).toHaveCount(0);
  await expect(page.getByTestId("menu-scheme")).toHaveCount(0);
  await expect(page.getByTestId("menu-export-pdf")).toContainText("PDF");
});

test("DOCX 导出后可以再导入（闭环）", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("# 导出标题\n\n正文段落。\n\n> [!TIP]\n> 导出提示。");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await page.getByTestId("btn-menu").click();
  const [docx] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByTestId("menu-export-docx").click(),
  ]);
  const path = await docx.path();
  expect(path).toBeTruthy();

  // 用导出的 DOCX 反向导入
  await page.getByTestId("import-input").setInputFiles(path!);
  await expect(page.getByTestId("editor-title")).toHaveText("导出标题", { timeout: 15_000 });
  await expect(page.getByTestId("md-preview").locator("h1").first()).toContainText("导出标题", {
    timeout: 10_000,
  });
  // 警报框走 DOCX 专用分支（标题 + 正文），往返后内容不丢
  await expect(page.getByTestId("md-preview")).toContainText("导出提示");
  await expect(page.getByTestId("md-preview")).toContainText("Tip");
});
