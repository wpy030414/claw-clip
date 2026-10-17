import { test, expect } from "@playwright/test";

/**
 * 工作站能力 E2E：文件夹树、导入、导出（MD/DOCX/PDF）、菜单精简与删除确认。
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';

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

test("文件夹：双击不重命名、显式按钮重命名、不可嵌套、dialog 无关闭按钮", async ({ page }) => {
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
  const [workBox, personalBox] = await Promise.all([
    working.boundingBox(),
    personal.boundingBox(),
  ]);
  expect(workBox && personalBox).toBeTruthy();
  expect(Math.abs(workBox!.x - personalBox!.x)).toBeLessThan(1);

  // 双击名称不触发重命名
  await working.locator(".tree-name").dblclick();
  await expect(page.getByTestId("folder-edit-input")).toHaveCount(0);

  // 显式点击重命名按钮才可以改名
  await working.hover();
  await working.locator('[data-testid^="folder-rename-"]').click();
  const renameInput = page.getByTestId("folder-edit-input");
  await expect(renameInput).toBeVisible();
  await renameInput.fill("工作二");
  await renameInput.press("Enter");
  await expect(working).toContainText("工作二");

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

  // 删除按钮打开 M3E dialog（不再走 window.confirm）
  await folderRow.hover();
  await folderRow.locator('[data-testid^="folder-delete-"]').click();
  await expect(page.getByTestId("delete-folder-dialog")).toBeVisible();
  await expect(page.getByTestId("delete-folder-content")).toContainText("待删");

  // 取消后文件夹仍在
  await page.getByTestId("delete-folder-cancel").click();
  await expect(folderRow).toBeVisible();

  // 再次确认删除后消失
  await folderRow.hover();
  await folderRow.locator('[data-testid^="folder-delete-"]').click();
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
});

test("导出 Markdown 与 DOCX", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("# 导出标题\n\n正文段落。");
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

test("导出 PDF 直接下载文件（不走系统打印）", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("# PDF 标题\n\n正文段落。");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await page.getByTestId("btn-menu").click();
  const [pdf] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByTestId("menu-export-pdf").click(),
  ]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  expect(await pdf.path()).toBeTruthy();
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
  await page.keyboard.insertText("# 导出标题\n\n正文段落。");
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
});
