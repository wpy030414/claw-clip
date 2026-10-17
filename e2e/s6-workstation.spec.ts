import { test, expect } from "@playwright/test";

/**
 * 工作站能力 E2E：文件夹树、导入、导出（MD/DOCX/PDF）、可配置预览主题。
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';

test("文件夹：新建 → 在其中新建笔记 → 按文件夹过滤", async ({ page }) => {
  await page.goto("");

  await page.getByTestId("btn-new-folder").click();
  const input = page.getByTestId("folder-edit-input").first();
  await expect(input).toBeVisible();
  await input.fill("工作");
  await input.press("Enter");

  const folderRow = page.locator('[data-testid^="folder-row-"]').filter({ hasText: "工作" });
  await expect(folderRow).toBeVisible();

  // 选中文件夹 → 在其中新建笔记
  await folderRow.locator(".folder-main").click();
  await folderRow.locator('[data-testid^="folder-note-"]').click();
  await expect(page.getByTestId("editor-pane")).toBeVisible();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);

  // 全部笔记里新建一条根级笔记
  await page.getByTestId("folder-all").click();
  await page.getByTestId("btn-new").click();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(2);

  // 只选中「工作」→ 只剩文件夹里的那条
  await folderRow.locator(".folder-main").click();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);
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
  // 默认浏览模式且未聚焦：标题标记隐藏，渲染为标题行
  await expect(page.locator(".cm-line.cm-ir-h1").first()).toContainText("导入标题", {
    timeout: 10_000,
  });
});

test("导出 Markdown 与 DOCX", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("# 导出标题\n\n正文段落。");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await page.getByTestId("btn-export").click();
  const [md] = await Promise.all([
    page.waitForEvent("download", { timeout: 10_000 }),
    page.getByTestId("export-md").click(),
  ]);
  expect(md.suggestedFilename()).toMatch(/\.md$/);

  await page.getByTestId("btn-export").click();
  const [docx] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByTestId("export-docx").click(),
  ]);
  expect(docx.suggestedFilename()).toMatch(/\.docx$/);
  const path = await docx.path();
  expect(path).toBeTruthy();
});

test("导出 PDF 走系统打印（stub window.print）", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => {
      (window as unknown as { __printed: number }).__printed += 1;
    };
  });
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });

  await page.getByTestId("btn-export").click();
  await page.getByTestId("export-pdf").click();

  await expect
    .poll(
      async () =>
        page.evaluate(() => (window as unknown as { __printed: number }).__printed),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
});

test("预览主题 CSS 可配置并即时生效", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("主题测试");

  // 打印主题入口在导出菜单里（不设独立设置页）
  await page.getByTestId("btn-export").click();
  await page.getByTestId("export-theme").click();
  await page.getByTestId("preview-css-input").fill(
    ".md-preview-content { color: rgb(1, 2, 3); }",
  );

  const color = await page
    .locator('#print-root [data-testid="md-preview-print"]')
    .evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe("rgb(1, 2, 3)");
});

test("DOCX 导出后可以再导入（闭环）", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("# 导出标题\n\n正文段落。");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await page.getByTestId("btn-export").click();
  const [docx] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByTestId("export-docx").click(),
  ]);
  const path = await docx.path();
  expect(path).toBeTruthy();

  // 用导出的 DOCX 反向导入
  await page.getByTestId("import-input").setInputFiles(path!);
  await expect(page.getByTestId("editor-title")).toHaveText("导出标题", { timeout: 15_000 });
  await expect(page.locator(".cm-line.cm-ir-h1").first()).toContainText("导出标题", {
    timeout: 10_000,
  });
});
