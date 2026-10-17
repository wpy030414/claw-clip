import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

/**
 * 编辑工作区 E2E：格式工具栏、视图切换、HTML 导出。
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';

async function newNote(page: any) {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
}

test("工具栏：加粗 → 标题 → 右侧预览同步", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("hello");
  await page.keyboard.press("ControlOrMeta+A");
  await page.getByTestId("cmd-bold").click();

  const editor = page.locator(EDITOR).first();
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("**hello**");

  await page.getByTestId("cmd-h2").click();
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("## **hello**");

  await expect
    .poll(async () => page.getByTestId("md-preview").locator("h2").first().innerText(), {
      timeout: 10_000,
    })
    .toContain("hello");
});

test("快捷键：Cmd/Ctrl+B 加粗、Cmd/Ctrl+K 链接", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("hello");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ControlOrMeta+B");

  const editor = page.locator(EDITOR).first();
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("**hello**");

  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ControlOrMeta+K");
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("](https://)");
});

test("视图切换：编辑 / 分屏 / 预览", async ({ page }) => {
  await newNote(page);

  await expect(page.getByTestId("source-pane")).toBeVisible();
  await expect(page.getByTestId("preview-pane")).toBeVisible();

  await page.getByTestId("btn-view-preview").click();
  await expect(page.getByTestId("source-pane")).toBeHidden();
  await expect(page.getByTestId("preview-pane")).toBeVisible();

  await page.getByTestId("btn-view-edit").click();
  await expect(page.getByTestId("source-pane")).toBeVisible();
  await expect(page.getByTestId("preview-pane")).toHaveCount(0);

  await page.getByTestId("btn-view-split").click();
  await expect(page.getByTestId("preview-pane")).toBeVisible();
});

test("导出 HTML：编辑模式下按需渲染并生成独立文档", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("# 导出的标题\n\n正文段落");

  // 切到仅编辑：此时没有可见预览，导出仍必须拿到渲染结果
  await page.getByTestId("btn-view-edit").click();
  await page.getByTestId("btn-menu").click();

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByTestId("menu-export-html").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.html$/);

  const path = await download.path();
  expect(path).toBeTruthy();
  const html = readFileSync(path!, "utf-8");
  expect(html).toContain("导出的标题");
  expect(html).toContain("<h1>");
  expect(html).toContain("md-preview-content");
});
