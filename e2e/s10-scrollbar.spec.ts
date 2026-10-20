import { test, expect, type Page } from "@playwright/test";

/**
 * 滚动条统一为 M3E overlay 形态的 E2E：
 * - 原生滚动条不再挤占内容宽度（scrollbar-width: none，clientWidth == offsetWidth）；
 * - 缩略条由 useOverlayScrollbar 画在定位父级上，悬停/滚动时浮现；
 * - 缩略条可拖拽，带动容器滚动。
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';

/** 新建一条长笔记并等待自动保存，制造足够的滚动距离。 */
async function createLongNote(page: Page): Promise<void> {
  const beforePath = new URL(page.url()).pathname;
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForURL((url) => url.pathname !== beforePath, { timeout: 10_000 });

  await expect(page.locator(EDITOR)).toBeVisible();
  await expect(page.getByTestId("word-count")).toHaveText("0 字");

  const body = Array.from(
    { length: 120 },
    (_, i) => `## 第 ${i + 1} 节\n\n这是第 ${i + 1} 段填充内容，用于把编辑器与预览都撑出滚动。`,
  ).join("\n\n");
  await page.locator(EDITOR).fill(`# 滚动条测试\n\n${body}`);
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 10_000 });
}

test("源码滚动条不占内容宽度，缩略条滚动时浮现", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });
  await createLongNote(page);

  const scroller = page.locator(".md-editor-host .cm-scroller");
  await expect(scroller).toBeVisible();

  // 原生滚动条被隐藏：不占宽度，且 scrollbar-width 为 none
  const metrics = await scroller.evaluate((el) => {
    const node = el as HTMLElement;
    return {
      scrollbarWidth: getComputedStyle(node).scrollbarWidth,
      clientWidth: node.clientWidth,
      offsetWidth: node.offsetWidth,
      canScroll: node.scrollHeight > node.clientHeight,
    };
  });
  expect(metrics.scrollbarWidth).toBe("none");
  expect(metrics.clientWidth).toBe(metrics.offsetWidth);
  expect(metrics.canScroll).toBe(true);

  // overlay 缩略条挂在 .md-editor-host（定位父级）上，圆角、绝对定位
  const rail = page.locator(".md-editor-host > .m3e-overlay-scrollbar");
  await expect(rail).toHaveCount(1);
  const thumb = rail.locator(".m3e-overlay-scrollbar__thumb");
  await expect(thumb).toHaveCSS("border-radius", "999px");

  // 滚动后缩略条浮现（data-visible=true，透明度 1）
  await scroller.evaluate((el) => {
    el.scrollTop = 400;
  });
  await expect(rail).toHaveAttribute("data-visible", "true");
  await expect(rail).toHaveCSS("opacity", "1");
});

test("拖拽缩略条带动源码滚动", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });
  await createLongNote(page);

  const scroller = page.locator(".md-editor-host .cm-scroller");
  const thumb = page.locator(
    ".md-editor-host > .m3e-overlay-scrollbar .m3e-overlay-scrollbar__thumb",
  );

  // 先滚一点让缩略条浮现并可命中
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await expect(thumb).toBeVisible();

  const box = await thumb.boundingBox();
  expect(box).not.toBeNull();

  const before = await scroller.evaluate((el) => el.scrollTop);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 120, { steps: 8 });
  await page.mouse.up();

  const after = await scroller.evaluate((el) => el.scrollTop);
  expect(after).toBeGreaterThan(before);
});

test("预览面板与笔记树同样隐藏原生滚动条", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });
  await createLongNote(page);

  const preview = page.locator(".editor-preview-pane");
  await expect(preview).toBeVisible();
  const previewMetrics = await preview.evaluate((el) => {
    const node = el as HTMLElement;
    return {
      scrollbarWidth: getComputedStyle(node).scrollbarWidth,
      // offsetWidth 含边框、clientWidth 不含；split 视图下预览面板有 1px 左边框。
      // 原生滚动条若未隐藏会再吃掉约 15px，故差值容差取 2px 足以证明「滚动条不占宽度」。
      chrome: node.offsetWidth - node.clientWidth,
    };
  });
  expect(previewMetrics.scrollbarWidth).toBe("none");
  expect(previewMetrics.chrome).toBeLessThanOrEqual(2);

  const tree = page.getByTestId("note-tree-body");
  await expect(tree).toBeVisible();
  const treeMetrics = await tree.evaluate((el) => {
    const node = el as HTMLElement;
    return {
      scrollbarWidth: getComputedStyle(node).scrollbarWidth,
      clientWidth: node.clientWidth,
      offsetWidth: node.offsetWidth,
    };
  });
  expect(treeMetrics.scrollbarWidth).toBe("none");
  expect(treeMetrics.clientWidth).toBe(treeMetrics.offsetWidth);
});
