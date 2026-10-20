import { test, expect, type Page } from "@playwright/test";

/**
 * S9 全库搜索 E2E：Spotlight 式面板、树形结果、当前文章置顶、精确滚动。
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';
const PALETTE = ".search-palette";

/**
 * 新建一条笔记并写入内容，等待自动保存完成。
 *
 * 创建笔记是异步的（先写 IndexedDB 再 navigate），必须等 URL 切换、
 * 新笔记编辑器挂载（字数为 0）后再输入，否则内容可能写进上一条笔记。
 */
async function createNote(page: Page, content: string) {
  const beforePath = new URL(page.url()).pathname;
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForURL((url) => url.pathname !== beforePath, { timeout: 10_000 });

  await expect(page.locator(EDITOR)).toBeVisible();
  await expect(page.getByTestId("word-count")).toHaveText("0 字");

  await page.locator(EDITOR).fill(content);
  // saveState 在输入后 800ms 变为「已保存」；此时 IndexedDB 写入早已完成。
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 10_000 });
}

/** 打开搜索并输入关键词，等待文章根出现。 */
async function search(page: Page, keyword: string) {
  await page.keyboard.press("Control+f");
  const palette = page.locator(PALETTE);
  await expect(palette).toBeVisible();
  await palette.locator("input").fill(keyword);
  await expect(page.locator(".search-palette__article").first()).toBeVisible({ timeout: 5000 });
}

test("Ctrl+F 打开胶囊输入框，未输入时不显示结果卡", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  await page.keyboard.press("Control+f");
  const palette = page.locator(PALETTE);
  await expect(palette).toBeVisible();
  await expect(palette.locator("input")).toBeFocused();
  await expect(palette.locator(".search-palette__field")).toHaveCSS("border-radius", "999px");
  await expect(page.locator(".search-palette__results")).toHaveCount(0);

  // 输入后拉出结果卡，清空后收回
  await palette.locator("input").fill("任意内容");
  await expect(page.locator(".search-palette__results")).toBeVisible();
  await palette.locator("input").fill("");
  await expect(page.locator(".search-palette__results")).toHaveCount(0);
});

test("输入关键词显示树形结果", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  await createNote(page, "# 测试笔记\n\n这是搜索测试的独特内容 abc123");
  await search(page, "abc123");

  const article = page.locator(".search-palette__article").first();
  await expect(article).toContainText("测试笔记");
  await expect(article).toHaveAttribute("aria-expanded", "true");

  const match = page.locator(".search-palette__match").first();
  await expect(match).toContainText("abc123");
  await expect(page.locator(".search-palette__current")).toHaveText("当前");
});

test("键盘导航：上下键移动、回车展开与跳转", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  for (let i = 1; i <= 3; i++) {
    await createNote(page, `# 笔记${i}\n\n搜索关键词${i}`);
  }

  await search(page, "搜索关键词");
  const articles = page.locator(".search-palette__article");
  const matches = page.locator(".search-palette__match");
  await expect(articles).toHaveCount(3);
  // 当前文章置顶并默认展开，其余文章收起
  await expect(articles.first()).toHaveAttribute("aria-expanded", "true");
  await expect(articles.nth(1)).toHaveAttribute("aria-expanded", "false");
  await expect(matches).toHaveCount(1);

  // 根 → 叶
  await page.keyboard.press("ArrowDown");
  await expect(articles.first()).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(matches.first()).toHaveAttribute("data-selected", "true");

  // ↑ 回到父文章（切换目标只走上下键）
  await page.keyboard.press("ArrowUp");
  await expect(articles.first()).toHaveAttribute("data-selected", "true");

  // ↓ 到第二篇文章，回车展开，再 ↓ 进入它的叶子
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(articles.nth(1)).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("Enter");
  await expect(articles.nth(1)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(matches.nth(1)).toHaveAttribute("data-selected", "true");

  // 回车打开该叶子
  await page.keyboard.press("Enter");
  await expect(page.locator(PALETTE)).toBeHidden();
  await expect(page).toHaveURL(/\/n\//);
  await expect(page.locator(EDITOR)).toContainText("搜索关键词");
});

test("左右键只移动输入光标，不切换或收起结果行", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  await createNote(page, "# 光标测试\n\nabcdef 是搜索词");
  await search(page, "abcdef");

  const input = page.locator(PALETTE).locator("input");
  const article = page.locator(".search-palette__article").first();
  await expect(article).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(article).toHaveAttribute("data-selected", "true");

  const caretOf = () => input.evaluate((el) => (el as HTMLInputElement).selectionStart ?? -1);
  const before = await caretOf();

  // ← 只把插入符左移，选中行与展开态都不变
  await page.keyboard.press("ArrowLeft");
  await expect(article).toHaveAttribute("data-selected", "true");
  await expect(article).toHaveAttribute("aria-expanded", "true");
  expect(await caretOf()).toBe(before - 1);

  // → 把插入符移回末尾
  await page.keyboard.press("ArrowRight");
  await expect(article).toHaveAttribute("data-selected", "true");
  expect(await caretOf()).toBe(before);
});

test("正则搜索：斜杠包裹时按正则匹配", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  await createNote(page, "# 正则测试\n\n12 第一行\n345 第二行\nxx 不是数字开头");

  await search(page, "/^\\d\\d/");
  const article = page.locator(".search-palette__article").first();
  await expect(article).toContainText("2 处匹配");

  const matches = page.locator(".search-palette__match");
  await expect(matches).toHaveCount(2);
  await expect(matches.nth(0)).toContainText("12 第一行");
  await expect(matches.nth(1)).toContainText("345 第二行");

  // 输入框里显示的是原始正则，而不是命中子串
  await expect(page.locator(PALETTE).locator("input")).toHaveValue("/^\\d\\d/");
});

test("非法正则：结果卡内提示错误而不是空态", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  await page.keyboard.press("Control+f");
  await page.locator(PALETTE).locator("input").fill("/(/");

  const error = page.locator(".search-palette__message--error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("正则表达式无效");
  await expect(page.locator(".search-palette__article")).toHaveCount(0);
});

test("关闭搜索面板时播放退场动画", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  await page.keyboard.press("Control+f");
  const overlay = page.locator(".search-palette-overlay");
  await expect(overlay).toBeVisible();

  // 监听 data-state 变为 closing：证明元素在关闭后仍被保留用于播放动画
  await page.evaluate(() => {
    const state = window as unknown as { __searchClosingSeen?: boolean };
    state.__searchClosingSeen = false;
    const el = document.querySelector(".search-palette-overlay");
    if (!el) return;
    const observer = new MutationObserver(() => {
      if (el.getAttribute("data-state") === "closing") {
        state.__searchClosingSeen = true;
        observer.disconnect();
      }
    });
    observer.observe(el, { attributes: true, attributeFilter: ["data-state"] });
  });

  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => (window as unknown as { __searchClosingSeen?: boolean }).__searchClosingSeen === true,
    null,
    { timeout: 2000 },
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __searchClosingSeen?: boolean }).__searchClosingSeen,
    ),
  ).toBe(true);
  await expect(overlay).toBeHidden();
});

test("Esc 关闭搜索面板并清理输入", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  await createNote(page, "# 清理测试\n\n待清理的关键词");
  await search(page, "待清理");

  await page.keyboard.press("Escape");
  const palette = page.locator(PALETTE);
  await expect(palette).toBeHidden();

  // 再次打开，输入框应为空，且不显示结果卡
  await page.keyboard.press("Control+f");
  await expect(palette).toBeVisible();
  await expect(palette.locator("input")).toHaveValue("");
  await expect(page.locator(".search-palette__results")).toHaveCount(0);
});

test("点击命中叶子：跳转文章并精确滚动到匹配位置", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  const lines = Array.from(
    { length: 80 },
    (_, i) => `第 ${i + 1} 行填充内容，用于制造足够的滚动距离。`,
  ).join("\n");
  await createNote(
    page,
    `# 精确跳转测试\n\n${lines}\n\n这里是需要精确跳转的目标关键词，应该被选中。`,
  );

  await search(page, "目标关键词");
  const match = page.locator(".search-palette__match").first();
  await expect(match).toBeVisible();
  await match.click();

  await expect(page.locator(PALETTE)).toBeHidden();
  await expect(page).toHaveURL(/\/n\//);

  // 编辑器已离开顶部，目标行进入视口，且命中文本被选中
  const scroller = page.locator(".cm-scroller");
  await expect(page.locator(".cm-line").filter({ hasText: "目标关键词" })).toBeInViewport();
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("目标关键词");
});

test("跨文章跳转：先切换文章再精确定位命中", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  const lines = Array.from(
    { length: 80 },
    (_, i) => `第 ${i + 1} 行填充内容，用于制造足够的滚动距离。`,
  ).join("\n");
  await createNote(page, `# 跨文章目标\n\n${lines}\n\n这里是跨文章跳转的关键词，应该被选中。`);
  const targetPath = new URL(page.url()).pathname;

  // 切到另一篇文章后再发起搜索，确保命中目标不在当前文章
  await createNote(page, "# 当前文章\n\n这里没有目标词。");
  await search(page, "跨文章跳转的关键词");

  await expect(page.locator(".search-palette__article")).toHaveCount(1);
  const match = page.locator(".search-palette__match").first();
  await expect(match).toBeVisible();
  await match.click();

  await expect(page.locator(PALETTE)).toBeHidden();
  await expect.poll(() => new URL(page.url()).pathname).toBe(targetPath);
  await expect(page.locator(EDITOR)).toContainText("跨文章目标");

  // 切到目标文章后仍然精确滚动并选中命中文本
  const scroller = page.locator(".cm-scroller");
  await expect(page.locator(".cm-line").filter({ hasText: "跨文章跳转的关键词" })).toBeInViewport();
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("跨文章跳转的关键词");
});

test("当前文章永远置顶并默认展开", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  await createNote(page, "# 文章A\n\n共同关键词 A");
  await createNote(page, "# 文章B\n\n共同关键词 B");

  await search(page, "共同关键词");
  const articles = page.locator(".search-palette__article");
  await expect(articles).toHaveCount(2);

  // 当前文章（最后创建的 B）排第一，带「当前」徽标并已展开
  await expect(articles.first()).toContainText("文章B");
  await expect(articles.first().locator(".search-palette__current")).toHaveText("当前");
  await expect(articles.first()).toHaveAttribute("aria-expanded", "true");
  await expect(articles.nth(1)).toContainText("文章A");
  await expect(articles.nth(1)).toHaveAttribute("aria-expanded", "false");

  // 点击另一篇文章的根展开，叶子出现
  await articles.nth(1).click();
  await expect(articles.nth(1)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".search-palette__match")).toHaveCount(2);
});

test("同一文章的多处命中按相关度排序为叶子", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  await createNote(page, "# 关键词 标题\n\n正文关键词一。正文关键词二。");
  await search(page, "关键词");

  const article = page.locator(".search-palette__article").first();
  await expect(article).toContainText("4 处匹配");

  // 标题命中 → 正文标题行 → 两处正文
  const icons = await page.locator(".search-palette__match-icon").allInnerTexts();
  expect(icons).toEqual(["title", "segment", "subject", "subject"]);
});

test("搜索面板显示文章数与命中数", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  for (let i = 1; i <= 3; i++) {
    await createNote(page, `# 计数测试${i}\n\n共同关键词 count`);
  }

  await search(page, "共同关键词");
  const count = page.locator(".search-palette__count");
  await expect(count).toBeVisible();
  await expect(count).toContainText("找到");
  await expect(count).toContainText("篇");
  await expect(count).toContainText("处");
});

test("无匹配时显示空态", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  await createNote(page, "# 空搜索测试\n\n一些内容");
  await page.keyboard.press("Control+f");
  await page.locator(PALETTE).locator("input").fill("完全不存在的关键词xyz123456");

  const empty = page.locator(".search-palette__message");
  await expect(empty).toBeVisible({ timeout: 3000 });
  await expect(empty).toContainText("未找到");
});
