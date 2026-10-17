import { test, expect } from "@playwright/test";

/**
 * S5 响应式双形态 E2E：
 * - 桌面（≥900px）：左 NavRail + 列表/编辑器分栏；新建→编辑器；收藏页筛选
 * - 移动（<900px）：卡片流 + 底部 NavBar；点卡片进全屏编辑器，返回回列表
 * - 搜索页：关键词过滤标题/正文/标签
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';

test("S5 桌面：导航栏 + 分栏 + 新建/收藏筛选", async ({ page }) => {
  await page.goto("");

  await expect(page.getByTestId("nav-rail")).toBeVisible();
  await expect(page.getByTestId("nav-bar")).toHaveCount(0);
  await expect(page.getByTestId("note-list-pane")).toBeVisible();
  await expect(page.getByTestId("empty-state")).toBeVisible();

  await page.getByTestId("btn-new").click();
  await expect(page.getByTestId("editor-pane")).toBeVisible();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);

  // 收藏当前笔记 → 收藏页应保留一条
  await page.getByTestId("btn-star").click();
  await page.getByTestId("nav-starred").click();
  await expect(page.getByTestId("note-list-title")).toHaveText("收藏");
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);

  // 切回全部笔记仍可见
  await page.getByTestId("nav-notes").click();
  await expect(page.getByTestId("note-list-title")).toHaveText("笔记");
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);
});

test("S5 移动：卡片流 → 全屏编辑器 → 返回列表", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("");

  await expect(page.getByTestId("nav-bar")).toBeVisible();
  await expect(page.getByTestId("nav-rail")).toHaveCount(0);
  await expect(page.getByTestId("note-list-empty")).toBeVisible();

  await page.getByTestId("btn-new").click();
  await expect(page.getByTestId("editor-pane")).toBeVisible();
  // 全屏编辑时隐藏底部导航
  await expect(page.getByTestId("nav-bar")).toHaveCount(0);

  await page.getByTestId("btn-back").click();
  await expect(page.getByTestId("nav-bar")).toBeVisible();
  await expect(page.locator("[data-testid^='note-link-']")).toHaveCount(1);
});

test("S5 搜索：关键词匹配正文", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("独一无二的检索词XZQ");
  await page.waitForTimeout(1200); // 等节流自动保存落库

  await page.getByTestId("nav-search").click();
  await expect(page.getByTestId("search-input")).toBeVisible();
  await page.getByTestId("search-input").fill("XZQ");
  await expect
    .poll(async () => page.locator("[data-testid^='note-link-']").count(), { timeout: 5_000 })
    .toBe(1);

  await page.getByTestId("search-input").fill("不存在的关键词ZZZ");
  await expect(page.getByTestId("note-list-empty")).toBeVisible();
});

test("S5 断点切换：desktop → mobile 不丢未落库输入", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
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
