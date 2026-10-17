import { test, expect } from "@playwright/test";

/**
 * 编辑与数据闭环 E2E（CodeMirror 6 版）：
 * 新建 → 输入 Markdown → 预览渲染 → 自动保存 → 刷新持久化 → 原地编辑 id 不变。
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';

async function newNote(page: any) {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
}

test("S4: 新建笔记 → 编辑器挂载（React19 StrictMode 幂等）", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("");
  await expect(page.getByTestId("empty-state")).toBeVisible();

  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await expect(page.getByTestId("editor-pane")).toBeVisible();
  await expect(page.locator(EDITOR)).toHaveCount(1, { timeout: 15_000 });

  expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
});

test("S4: 输入 Markdown → 右侧实时预览渲染", async ({ page }) => {
  await newNote(page);

  await page.keyboard.insertText("# 我的第一篇笔记\n\n正文段落");

  // 默认分屏：左侧保留 Markdown 源码，右侧实时渲染
  const h1 = page.getByTestId("md-preview").locator("h1").first();
  await expect(h1).toContainText("我的第一篇笔记", { timeout: 10_000 });
  await expect(page.locator(EDITOR).first()).toContainText("# 我的第一篇笔记");
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

test("S4: 切到新笔记不串写前一条内容", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("# 第一篇\n\nAAA-内容");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  // 正在编辑时直接「+」新建第二条
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await expect(page.getByTestId("editor-title")).toHaveText("无标题", { timeout: 5_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("# 第二篇\n\nBBB-内容");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  // 回到第一篇：不应携带第二篇的正文
  const first = page.locator("[data-testid^='note-link-']").filter({ hasText: "第一篇" });
  await expect(first).toHaveCount(1);
  await first.click();
  await expect(page.getByTestId("editor-title")).toHaveText("第一篇", { timeout: 5_000 });
  const text = await page.locator(EDITOR).first().innerText();
  expect(text).toContain("AAA-内容");
  expect(text).not.toContain("BBB-内容");
});

test("S4: 按最后修改时间倒序；仅打开笔记不打乱顺序", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("# 较早笔记\n\n较早内容");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await expect(page.getByTestId("editor-title")).toHaveText("无标题", { timeout: 5_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.insertText("# 较新笔记\n\n较新内容");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  const titles = page.locator("[data-testid^='note-link-'] .tree-note-title");
  await expect(titles).toHaveCount(2);
  await expect(titles.nth(0)).toHaveText("较新笔记");
  await expect(titles.nth(1)).toHaveText("较早笔记");

  // 只打开两篇笔记、不做任何编辑：顺序必须保持不变
  await page.locator("[data-testid^='note-link-']").filter({ hasText: "较早笔记" }).click();
  await expect(page.getByTestId("editor-title")).toHaveText("较早笔记", { timeout: 5_000 });
  await page.locator("[data-testid^='note-link-']").filter({ hasText: "较新笔记" }).click();
  await expect(page.getByTestId("editor-title")).toHaveText("较新笔记", { timeout: 5_000 });
  await page.waitForTimeout(300);

  await expect(titles.nth(0)).toHaveText("较新笔记");
  await expect(titles.nth(1)).toHaveText("较早笔记");
});

test("S4: 侧栏笔记行显示标题、首行预览与最后编辑时间", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("# 行信息标题\n\n预览第一行内容");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  const row = page.locator("[data-testid^='note-link-']").filter({ hasText: "行信息标题" });
  await expect(row).toHaveCount(1);
  await expect(row.locator(".tree-note-title")).toHaveText("行信息标题");
  await expect(row.locator(".tree-note-excerpt")).toHaveText("预览第一行内容");
  await expect(row.locator(".tree-note-time")).toContainText(/刚刚|分钟前/);
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
