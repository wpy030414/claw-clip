import { test, expect } from "@playwright/test";

/**
 * 编辑与数据闭环 E2E（CodeMirror 6 版）：
 * 新建 → 输入 Markdown → 预览渲染 → 自动保存 → 刷新持久化 → 原地编辑 id 不变。
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';

async function newNote(page: any) {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
}

test("S4: 新建笔记 → 编辑器挂载（React19 StrictMode 幂等）", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("");
  await expect(page.getByTestId("empty-state")).toBeVisible();

  await page.getByTestId("btn-new").click();
  await expect(page.getByTestId("editor-pane")).toBeVisible();
  await expect(page.locator(EDITOR)).toHaveCount(1, { timeout: 15_000 });

  expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
});

test("S4: 输入 Markdown → 浏览模式渲染（# 标题隐藏标记）", async ({ page }) => {
  await newNote(page);

  await page.keyboard.insertText("# 我的第一篇笔记\n\n正文段落");
  // 默认即浏览模式；光标移到末行，让标题行进入「非当前行」→ 显示渲染态
  await page.keyboard.press("End");

  const h1 = page.locator(".cm-line.cm-ir-h1").first();
  await expect(h1).toContainText("我的第一篇笔记", { timeout: 10_000 });
  await expect(h1).not.toContainText("#");
});

test("S4: 自动保存 → 刷新页面内容仍在（IndexedDB 持久化）", async ({ page }) => {
  await newNote(page);

  const content = "持久化测试内容 ABC123";
  await page.keyboard.insertText(content);

  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await page.reload();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });

  const restored = await page.locator(EDITOR).first().innerText();
  expect(restored).toContain(content);
});

test("S4: 原地编辑 id 不变（回归旧「编辑=删旧建新」bug）", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("第一版内容");
  await page.waitForTimeout(1200);

  const linksBefore = await page.locator("[data-testid^='note-link-']").all();
  expect(linksBefore.length).toBe(1);
  const idBefore = await linksBefore[0].getAttribute("data-testid");

  await page.locator(EDITOR).first().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" + 第二版追加");
  await page.waitForTimeout(1200);

  const linksAfter = await page.locator("[data-testid^='note-link-']").all();
  expect(linksAfter.length).toBe(1);
  expect(await linksAfter[0].getAttribute("data-testid")).toBe(idBefore);
});

test("S4: 字数统计随输入更新", async ({ page }) => {
  await newNote(page);

  await page.keyboard.insertText("你好世界测试");
  await expect
    .poll(async () => parseInt(await page.getByTestId("word-count").innerText()) || 0, {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);
});
