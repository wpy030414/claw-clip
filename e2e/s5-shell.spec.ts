import { test, expect } from "@playwright/test";

/**
 * S5 响应式双形态 E2E：
 * - 桌面（≥900px）：可收侧栏（文档/大纲页签 + 行级新建 + 文件夹/笔记树）+ 编辑器分栏
 * - 移动（<900px）：笔记树；点笔记进全屏编辑器，返回回树
 * - 侧栏开关位于主内容顶栏左侧
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';

test("S5 桌面：页签 + 行级新建 + 笔记树", async ({ page }) => {
  await page.goto("");

  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("nav-bar")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-brand")).toContainText("ClawClip");
  const logo = page.getByTestId("sidebar-logo");
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", /favicon\.ico$/);
  const github = page.getByTestId("link-github");
  await expect(github).toHaveAttribute("href", "https://github.com/wpy030414/claw-clip");
  await expect(github).toHaveAttribute("target", "_blank");
  await expect(page.getByTestId("tab-docs")).toBeVisible();

  const stats = page.getByTestId("sidebar-stats");
  await expect(stats).toContainText("共 0 个笔记", { timeout: 5_000 });

  // 底部 bar：统计 + 方形明暗切换
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();
  const themeToggle = page.getByTestId("btn-theme-toggle");
  await expect(themeToggle).toBeVisible();
  const themeIcon = themeToggle.locator(".material-symbols-outlined");
  const beforeIcon = await themeIcon.innerText();
  const beforeDark = (await logo.getAttribute("data-dark")) === "true";
  await themeToggle.click();
  await expect(themeIcon).not.toHaveText(beforeIcon);
  await expect(logo).toHaveAttribute("data-dark", beforeDark ? "false" : "true");

  // 文档 / 大纲等宽铺满一行
  const [tabsBox, docsBox, outlineBox] = await Promise.all([
    page.locator(".sidebar-tabs").boundingBox(),
    page.getByTestId("tab-docs").boundingBox(),
    page.getByTestId("tab-outline").boundingBox(),
  ]);
  expect(tabsBox && docsBox && outlineBox).toBeTruthy();
  expect(Math.abs(docsBox!.width - outlineBox!.width)).toBeLessThan(1);
  expect(docsBox!.width + outlineBox!.width).toBeGreaterThan(tabsBox!.width - 4);
  await expect(page.getByTestId("note-tree")).toBeVisible();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByTestId("btn-new")).toContainText("新建");

  // 行级「新建」打开创建菜单，三项创建入口都在这里
  await page.getByTestId("btn-new").click();
  const dialog = page.getByTestId("create-dialog-content");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("create-folder")).toBeVisible();
  await expect(page.getByTestId("create-note")).toBeVisible();
  await expect(page.getByTestId("upload-note")).toBeVisible();

  await page.getByTestId("create-note").click();
  await expect(page.getByTestId("editor-pane")).toBeVisible();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);
  await expect(stats).toContainText("共 1 个笔记", { timeout: 5_000 });
  await expect(stats).toContainText(/[\d.]+ (KB|MB|GB)/);
});

test("S5 移动：笔记树 → 全屏编辑器 → 返回树", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("");

  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("note-list-empty")).toBeVisible();

  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await expect(page.getByTestId("editor-pane")).toBeVisible();

  await page.getByTestId("btn-back").click();
  await expect(page.getByTestId("note-list-pane")).toBeVisible();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);
});

test("S5 断点切换：desktop → mobile 不丢未落库输入", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("断点切换保留内容ABC");

  // 不等自动保存（800ms），立刻切换断点，验证卸载 flush + 重挂载回灌
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForSelector(EDITOR, { timeout: 15_000 });

  await expect
    .poll(async () => page.locator(EDITOR).first().innerText(), { timeout: 10_000 })
    .toContain("断点切换保留内容ABC");
});

test("侧栏：大纲页签、收起与展开", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("# 一级标题\n\n## 二级标题\n\n正文");

  await page.getByTestId("tab-outline").click();
  const outline = page.getByTestId("outline-pane");
  await expect(outline).toBeVisible();
  await expect(outline.locator(".outline-item")).toHaveCount(2);
  await expect(outline.locator(".outline-item").first()).toHaveText("一级标题");

  // 点击大纲条目 → 光标跳到对应标题（顶栏字数不变，编辑器仍聚焦）
  await outline.locator(".outline-item").nth(1).click();
  await expect(page.locator(".cm-content")).toBeFocused();

  // 收起 / 展开
  await page.getByTestId("btn-sidebar-close").click();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await page.getByTestId("btn-sidebar-open").click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});
