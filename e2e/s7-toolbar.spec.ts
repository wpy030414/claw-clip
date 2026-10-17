import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

/**
 * 编辑工作区 E2E：格式工具栏、视图切换、HTML 导出。
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';

async function newNote(page: any) {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
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

test("编辑器显示行号", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("第一行\n第二行\n第三行");

  // CodeMirror 的 gutter 里有一个隐藏的宽度占位元素；innerText 会忽略它
  const gutter = page.locator('[data-testid="md-editor"] .cm-lineNumbers');
  await expect.poll(async () => gutter.innerText()).toBe("1\n2\n3");

  // 行号必须与正文首行同高（不能再被额外的 gutter padding 顶下去）
  const offset = await page.evaluate(() => {
    const line = document.querySelector('[data-testid="md-editor"] .cm-line')!.getBoundingClientRect();
    const first = Array.from(
      document.querySelectorAll('[data-testid="md-editor"] .cm-lineNumbers .cm-gutterElement'),
    ).find((el) => getComputedStyle(el).visibility !== "hidden")!;
    return Math.abs(line.y - first.getBoundingClientRect().y);
  });
  expect(offset).toBeLessThan(1);

  // 光标所在行号加深加粗（第 3 行，光标停在文末）
  const active = page.locator('[data-testid="md-editor"] .cm-activeLineGutter');
  await expect(active).toHaveText("3");
  await expect(active).toHaveCSS("font-weight", "600");
  await expect(active).toHaveCSS("opacity", "1");
});

test("Mermaid 代码块渲染为 SVG", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```");

  await expect(page.getByTestId("md-preview").locator(".mermaid-rendered svg")).toBeVisible({
    timeout: 20_000,
  });
});

test("手写 HTML 在预览中原样渲染", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText(
    '<div class="raw-html" style="color: rgb(1, 2, 3)">手写 HTML</div>\n\n<details><summary>展开</summary>内容</details>',
  );

  const raw = page.getByTestId("md-preview").locator(".raw-html");
  await expect(raw).toHaveText("手写 HTML");
  await expect(raw).toHaveCSS("color", "rgb(1, 2, 3)");
  await expect(page.getByTestId("md-preview").locator("details summary")).toHaveText("展开");
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

test("更多菜单：格式化位于第一项并强制校准 Markdown 格式", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText(
    "#标题\n\n\n\n*   甲\n+ 乙\n- [X]   任务\n>>   引用\n\n正文   ",
  );

  await page.getByTestId("btn-menu").click();
  const menu = page.getByTestId("editor-menu");
  await expect(menu.getByRole("menuitem").first()).toHaveAttribute(
    "data-testid",
    "menu-format",
  );
  await page.getByTestId("menu-format").click();

  const editor = page.locator(EDITOR).first();
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("# 标题");
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("- 甲");
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("- 乙");
  await expect
    .poll(async () => editor.innerText(), { timeout: 5_000 })
    .toContain("- [x] 任务");
  await expect
    .poll(async () => editor.innerText(), { timeout: 5_000 })
    .toContain("> > 引用");

  // 预览与编辑器同源：格式化后的标题/列表立即生效
  await expect(page.getByTestId("md-preview").locator("h1").first()).toHaveText("标题");
  await expect(page.getByTestId("md-preview").locator("li").first()).toContainText("甲");
});
