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
  await expect(page.getByTestId("md-toolbar")).toBeVisible();

  // 仅预览：格式工具栏收起（无源码可格式化），保留在 DOM 里做高度过渡
  await page.getByTestId("btn-view-preview").click();
  await expect(page.getByTestId("source-pane")).toBeHidden();
  await expect(page.getByTestId("preview-pane")).toBeVisible();
  await expect(page.getByTestId("md-toolbar-slot")).toHaveAttribute("data-hidden", "true");
  await expect(page.getByTestId("md-toolbar")).toBeHidden();

  await page.getByTestId("btn-view-edit").click();
  await expect(page.getByTestId("source-pane")).toBeVisible();
  await expect(page.getByTestId("preview-pane")).toHaveCount(0);
  await expect(page.getByTestId("md-toolbar-slot")).toHaveAttribute("data-hidden", "false");
  await expect(page.getByTestId("md-toolbar")).toBeVisible();

  await page.getByTestId("btn-view-split").click();
  await expect(page.getByTestId("preview-pane")).toBeVisible();
});

test("视图默认值：桌面分屏，刷新后重置（不持久化）", async ({ page }) => {
  await newNote(page);
  await expect(page.getByTestId("preview-pane")).toBeVisible();

  await page.getByTestId("btn-view-edit").click();
  await expect(page.getByTestId("preview-pane")).toHaveCount(0);

  // 刷新页面：会话内的选择不保留，回到桌面默认「编辑 + 实时预览」
  await page.reload();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await expect(page.getByTestId("preview-pane")).toBeVisible();
  await expect(page.getByTestId("source-pane")).toBeVisible();
});

test("视图默认值：移动端仅编辑", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newNote(page);

  await expect(page.getByTestId("source-pane")).toBeVisible();
  await expect(page.getByTestId("preview-pane")).toHaveCount(0);
  // 窄屏不提供分屏入口，仍可手动切到预览
  await expect(page.getByTestId("btn-view-split")).toHaveCount(0);
  await expect(page.getByTestId("btn-view-preview")).toBeVisible();
});

test("选中文字直接敲 Markdown 标记：包裹选区而不是替换", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("hello");
  const editor = page.locator(EDITOR).first();
  await page.keyboard.press("ControlOrMeta+A");

  // 敲 * → `*hello*`，且内文仍处于选中态
  await page.keyboard.press("*");
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("*hello*");
  await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString())).toBe("hello");

  // 再敲一次 * → 自然升级为加粗
  await page.keyboard.press("*");
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("**hello**");

  // $ 继续包裹在内侧，形成行内公式
  await page.keyboard.press("$");
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("**$hello$**");

  // 非标记字符仍然正常替换选区
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("world");
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toBe("world");
});

test("选中文字连敲 *：一次只加一层（斜体 → 粗体 → 粗斜体）", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("hello");
  const editor = page.locator(EDITOR).first();
  const preview = page.getByTestId("md-preview");
  await page.keyboard.press("ControlOrMeta+A");

  // 第一次：每侧只有一个 *，渲染斜体
  await page.keyboard.press("*");
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toBe("*hello*");
  await expect
    .poll(async () => preview.locator("em").first().innerText(), { timeout: 10_000 })
    .toBe("hello");
  await expect(preview.locator("strong")).toHaveCount(0);

  // 第二次：每侧两个 *，渲染粗体
  await page.keyboard.press("*");
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toBe("**hello**");
  await expect
    .poll(async () => preview.locator("strong").first().innerText(), { timeout: 10_000 })
    .toBe("hello");

  // 第三次：每侧三个 *，渲染粗斜体
  await page.keyboard.press("*");
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toBe("***hello***");
  await expect
    .poll(async () => preview.locator("em strong").first().innerText(), { timeout: 10_000 })
    .toBe("hello");
});

test("上标 / 高亮 / 斜体：包裹后是合法语法并在预览渲染", async ({ page }) => {
  await newNote(page);
  const editor = page.locator(EDITOR).first();
  const preview = page.getByTestId("md-preview");

  // 斜体：三击/整行选择常把行尾换行一起选进来，标记必须贴住文字才渲染
  await page.keyboard.insertText("斜体文字\n第二行");
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Shift+ArrowRight"); // 把行尾换行一起选进来
  await page.keyboard.type("*");
  await expect
    .poll(async () => editor.innerText(), { timeout: 5_000 })
    .toContain("*斜体文字*\n第二行");
  await expect
    .poll(async () => preview.locator("em").first().innerText(), { timeout: 10_000 })
    .toBe("斜体文字");

  // 中文 CJK 字体没有 italic 面：必须显式 font-synthesis: style，斜体才会真的倾斜
  const synthesis = await page.evaluate(() => {
    const em = document.querySelector(".md-preview-content em") as HTMLElement;
    const content = document.querySelector(".md-editor-host .cm-content") as HTMLElement;
    return {
      preview: getComputedStyle(em).fontSynthesis,
      editor: getComputedStyle(content).fontSynthesis,
    };
  });
  expect(synthesis.preview).toBe("style");
  expect(synthesis.editor).toBe("style");

  // 上标：^文字^
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n\n上标文字");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.type("^");
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("^上标文字^");
  await expect
    .poll(async () => preview.locator("sup").first().innerText(), { timeout: 10_000 })
    .toBe("上标文字");

  // 高亮：连敲两次 = → ==文字==
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n\n 高亮文字");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.type("==");
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("==高亮文字==");
  await expect
    .poll(async () => preview.locator("mark").first().innerText(), { timeout: 10_000 })
    .toBe("高亮文字");
});

test("中文输入法插入标记：全角字符也按 Markdown 语法包裹选区", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("hello");
  const editor = page.locator(EDITOR).first();
  await page.keyboard.press("ControlOrMeta+A");

  // 模拟中文标点模式的输入法：直接把全角「＊」插进文档（keydown 被 IME 吃掉）
  const inserted = await page.evaluate(() =>
    document.execCommand("insertText", false, "＊"),
  );
  expect(inserted).toBe(true);

  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("*hello*");
  await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString())).toBe("hello");
  // 落进文档的是半角标记，不是全角字符
  expect(await editor.innerText()).not.toContain("＊");

  // 再插一次全角「＊」→ 升级为加粗
  await page.evaluate(() => document.execCommand("insertText", false, "＊"));
  await expect.poll(async () => editor.innerText(), { timeout: 5_000 }).toContain("**hello**");
});

test("选中态高于行高亮：选择层压在行底色之上", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("第一行要被选中的文字");
  await page.keyboard.press("ControlOrMeta+A");

  await expect(page.locator(".cm-selectionBackground").first()).toBeVisible();

  const styles = await page.evaluate(() => {
    const selection = document.querySelector(".cm-selectionBackground") as HTMLElement;
    const line = document.querySelector(".cm-activeLine") as HTMLElement;
    const layer = document.querySelector(".cm-selectionLayer") as HTMLElement;
    const before = getComputedStyle(line, "::before");
    const lineBg = before.backgroundColor;
    const selBg = getComputedStyle(selection).backgroundColor;
    return {
      // 活动行不创建层叠上下文：否则行底色会被锁在更高的一层
      lineZIndex: getComputedStyle(line).zIndex,
      // 行底色必须排在选择层之下（CodeMirror 会内联写负的 z-index）
      lineBgZ: Number(before.zIndex),
      selectionLayerZ: Number(getComputedStyle(layer).zIndex),
      lineBg,
      selBg,
    };
  });

  expect(styles.lineZIndex).toBe("auto");
  expect(styles.lineBgZ).toBeLessThan(styles.selectionLayerZ);
  expect(styles.selBg).not.toBe(styles.lineBg);
  // 选中色是青色（蓝/绿通道明显高于红通道），不是与活动行同款的暖色；
  // Chromium 计算为 color(srgb r g b / α)，旧内核为 rgba(r, g, b, α)
  const rgb = styles.selBg.match(/([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  expect(rgb).toBeTruthy();
  const [r, g, b] = rgb!.slice(1).map(Number);
  expect(g).toBeGreaterThan(r);
  expect(b).toBeGreaterThan(r);
  expect(styles.selBg).toMatch(/rgba?\(|color\(srgb .*\//);
});

test("警报框：> [!WARNING] 渲染为带标题的提示块", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("> [!WARNING]\n> 保存前请检查附件");

  const preview = page.getByTestId("md-preview");
  const alert = preview.locator(".md-alert-warning");
  await expect(alert).toBeVisible({ timeout: 10_000 });
  await expect(alert.locator(".md-alert-title")).toHaveText("Warning");
  await expect(alert).toContainText("保存前请检查附件");
  await expect(preview).not.toContainText("[!WARNING]");

  // 类型色条（预览/HTML/PDF 共用同一份 CSS）
  const border = await alert.evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(border).toBe("rgb(154, 103, 0)");
});

test("导出 HTML：编辑模式下按需渲染并生成独立文档", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText(
    "# 导出的标题\n\n正文段落\n\n```mermaid\ngraph TD;\nA-->B;\n```",
  );

  // 切到仅编辑：此时没有可见预览，导出仍必须拿到渲染结果
  await page.getByTestId("btn-view-edit").click();
  await page.getByTestId("btn-menu").click();

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByTestId("menu-export-html").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.html$/);

  const path = await download.path();
  expect(path).toBeTruthy();
  const html = readFileSync(path!, "utf-8");
  expect(html).toContain("导出的标题");
  expect(html).toContain("<h1>");
  expect(html).toContain("md-preview-content");
  // 单文件自包含：Mermaid 渲染为内联 SVG，不再残留代码块
  expect(html).toContain("<svg");
  expect(html).not.toContain("language-mermaid");
  expect(html).not.toContain("blob:");
  // 导出产物强制浅色主题，不跟随系统深色偏好
  expect(html).toContain("color-scheme: light");
  expect(html).not.toContain("prefers-color-scheme: dark");
});

test("活动行：光标所在行有可感知的浅色底（含行号列）", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("第一行\n第二行\n第三行");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");

  const info = await page.evaluate(() => {
    const line = document.querySelector(".cm-activeLine");
    const gutter = document.querySelector(".cm-activeLineGutter");
    const scroller = document.querySelector(".cm-scroller");
    const before = line ? getComputedStyle(line, "::before") : null;
    return {
      lineBg: before ? before.backgroundColor : null,
      beforeLeft: before ? before.left : null,
      beforeRight: before ? before.right : null,
      gutterBg: gutter ? getComputedStyle(gutter).backgroundColor : null,
      overflowX: scroller ? getComputedStyle(scroller).overflowX : null,
    };
  });

  expect(info.lineBg).not.toBeNull();
  expect(info.lineBg).not.toBe("rgba(0, 0, 0, 0)");
  expect(info.gutterBg).not.toBe("rgba(0, 0, 0, 0)");
  // 底色向左右各延伸出内容列（贯穿整行），由 scroller 水平裁剪
  expect(Number.parseFloat(info.beforeLeft!)).toBeLessThan(0);
  expect(Number.parseFloat(info.beforeRight!)).toBeLessThan(0);
  expect(info.overflowX).toBe("clip");
});

test("行号：折行时与首行对齐，而不是整块居中", async ({ page }) => {
  await newNote(page);
  await page.keyboard.insertText("这是一行很长很长的文字，用来测试折行时行号的位置。".repeat(6));
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const nums = Array.from(
      document.querySelectorAll(".cm-lineNumbers .cm-gutterElement"),
    ).filter((el) => getComputedStyle(el).visibility !== "hidden");
    const gutter = nums[0];
    const gutterRange = document.createRange();
    gutterRange.selectNodeContents(gutter);
    const gb = gutterRange.getBoundingClientRect();

    const line = document.querySelector(".cm-line")!;
    const textNode = line.firstChild!;
    const charRange = document.createRange();
    charRange.setStart(textNode, 0);
    charRange.setEnd(textNode, 1);
    const cb = charRange.getBoundingClientRect();

    return {
      wrapped: line.getBoundingClientRect().height > 40,
      // 行号中心与首行首字中心的垂直偏差
      delta: Math.abs((gb.top + gb.bottom) / 2 - (cb.top + cb.bottom) / 2),
    };
  });

  expect(result.wrapped).toBe(true);
  expect(result.delta).toBeLessThan(2);
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
