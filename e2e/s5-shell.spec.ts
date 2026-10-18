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
  const title = page.getByTestId("sidebar-title");
  await expect(title).toBeVisible();
  await expect(title).toHaveText("ClawClip");
  await expect(page.getByTestId("sidebar-logo")).toHaveCount(0); // 标题不再携带图标
  const github = page.getByTestId("link-github");
  await expect(github).toHaveAttribute("href", "https://github.com/wpy030414/claw-clip");
  await expect(github).toHaveAttribute("target", "_blank");
  await expect(page.getByTestId("tab-docs")).toBeVisible();

  const stats = page.getByTestId("sidebar-stats");
  await expect(stats).toContainText("共 0 个笔记", { timeout: 5_000 });

  // 底部 bar：统计 + 方形明暗切换 + 主题设置
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();
  const themeToggle = page.getByTestId("btn-theme-toggle");
  await expect(themeToggle).toBeVisible();
  const themeIcon = themeToggle.locator(".material-symbols-outlined");
  const beforeIcon = await themeIcon.innerText();
  await themeToggle.click();
  await expect(themeIcon).not.toHaveText(beforeIcon);

  // 文档 / 大纲等宽铺满一行
  const [tabsBox, docsBox, outlineBox] = await Promise.all([
    page.locator(".sidebar-tabs").boundingBox(),
    page.getByTestId("tab-docs").boundingBox(),
    page.getByTestId("tab-outline").boundingBox(),
  ]);
  expect(tabsBox && docsBox && outlineBox).toBeTruthy();
  expect(Math.abs(docsBox!.width - outlineBox!.width)).toBeLessThan(1);
  // 分段控件：容器内边距 3px×2 + 按钮间距 2px，两个页签等分剩余宽度
  const tabsInner = tabsBox!.width - 6 - 2;
  expect(Math.abs(docsBox!.width + outlineBox!.width - tabsInner)).toBeLessThan(1);
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

test("S5 桌面：底部 bar 等高 + 主题设置自定义 CSS", async ({ page }) => {
  await page.goto("");

  const stats = page.getByTestId("sidebar-stats");
  const toggle = page.getByTestId("btn-theme-toggle");
  const settings = page.getByTestId("btn-theme-settings");
  await expect(stats).toBeVisible();
  await expect(settings).toBeVisible();

  // 统计胶囊与两枚方形按钮同高；统计图标与主题图标同尺寸
  const [statsBox, toggleBox, settingsBox] = await Promise.all([
    stats.boundingBox(),
    toggle.boundingBox(),
    settings.boundingBox(),
  ]);
  expect(statsBox && toggleBox && settingsBox).toBeTruthy();
  expect(Math.abs(statsBox!.height - toggleBox!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(settingsBox!.height - toggleBox!.height)).toBeLessThanOrEqual(1);
  await expect(stats.locator(".material-symbols-outlined")).toHaveCSS("font-size", "18px");
  await expect(toggle.locator(".material-symbols-outlined")).toHaveCSS("font-size", "18px");

  // 打开主题 dialog，写入的自定义 CSS 立即注入到页面
  await settings.click();
  const input = page.getByTestId("theme-css-input");
  await expect(input).toBeVisible();
  await input.fill("html { --clawclip-e2e: 42; }");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--clawclip-e2e").trim(),
      ),
    )
    .toBe("42");

  // 持久化：刷新后仍然生效
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--clawclip-e2e").trim(),
      ),
    )
    .toBe("42");

  // 恢复默认：自定义样式被移除
  await page.getByTestId("btn-theme-settings").click();
  await expect(input).toHaveValue("html { --clawclip-e2e: 42; }");
  await page.getByTestId("theme-css-reset").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--clawclip-e2e").trim(),
      ),
    )
    .toBe("");
});

test("S5 移动：笔记树 → 全屏编辑器 → 返回树", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("");

  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("note-list-empty")).toBeVisible();

  // 移动端首页还原桌面侧栏：品牌行 + 笔记树 + 底部统计/明暗切换
  await expect(page.getByTestId("sidebar-brand")).toBeVisible();
  await expect(page.getByTestId("sidebar-title")).toHaveText("ClawClip");
  await expect(page.getByTestId("link-github")).toBeVisible();
  await expect(page.getByTestId("note-tree")).toBeVisible();
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();
  await expect(page.getByTestId("sidebar-stats")).toContainText(/共 \d+ 个笔记/);
  await expect(page.getByTestId("btn-theme-toggle")).toBeVisible();
  // 首页整体等比放大：zoom 同时放大字号/间距/图标，且不能撑出横向滚动
  await expect(page.getByTestId("note-list-pane")).toHaveCSS("zoom", "1.12");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  // 移动端没有常驻编辑器：不展示大纲页签
  await expect(page.getByTestId("tab-outline")).toHaveCount(0);
  await expect(page.getByTestId("tab-docs")).toHaveCount(0);

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
  await page.keyboard.insertText(
    "# 一级标题\n\n## 二级标题\n\n```md\n# 代码里的假标题\n```\n\n正文",
  );

  await page.getByTestId("tab-outline").click();
  const outline = page.getByTestId("outline-pane");
  await expect(outline).toBeVisible();
  // 代码块里的 # 不是标题：大纲只保留真正的两级标题
  await expect(outline.locator(".outline-item")).toHaveCount(2);
  await expect(outline.locator(".outline-item").first()).toHaveText("一级标题");
  await expect(outline).not.toContainText("代码里的假标题");

  // 点击大纲条目 → 光标跳到对应标题（顶栏字数不变，编辑器仍聚焦）
  await outline.locator(".outline-item").nth(1).click();
  await expect(page.locator(".cm-content")).toBeFocused();

  // 收起 / 展开
  await page.getByTestId("btn-sidebar-close").click();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await page.getByTestId("btn-sidebar-open").click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});

test("大纲跳转：编辑/分屏落编辑器，仅预览滚动预览面板", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();

  const filler = Array.from({ length: 30 }, (_, i) => `正文第 ${i + 1} 行`).join("\n\n");
  await page.keyboard.insertText(
    `# 一级标题\n\n${filler}\n\n## 二级标题\n\n${filler}\n\n## 三级标题\n\n${filler}`,
  );

  await page.getByTestId("tab-outline").click();
  const outline = page.getByTestId("outline-pane");
  const items = outline.locator(".outline-item");
  await expect(items).toHaveCount(3);

  // 采样 scrollTop：大纲跳转是「快速滚动」而不是瞬移（应出现多个中间位置）
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const sampleScrollTop = (selector: string) =>
    page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      const store = ((
        window as unknown as { __scrollSamples?: Record<string, number[]> }
      ).__scrollSamples ??= {});
      const samples: number[] = (store[sel] = []);
      if (!el) return;
      const started = performance.now();
      const tick = () => {
        samples.push(el.scrollTop);
        if (performance.now() - started < 1_200) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, selector);
  const distinctScrollPositions = async (selector: string) =>
    new Set(
      await page.evaluate(
        (sel) =>
          (
            (window as unknown as { __scrollSamples?: Record<string, number[]> }).__scrollSamples?.[
              sel
            ] ?? []
          ).map((v) => Math.round(v)),
        selector,
      ),
    ).size;

  // 分屏（桌面默认）：落点为编辑器，光标所在行就是目标标题
  await sampleScrollTop(".cm-scroller");
  await items.nth(2).click();
  // 瞬移只会有「起点 + 终点」两个值，滚动动画应有更多中间位置
  await expect
    .poll(() => distinctScrollPositions(".cm-scroller"), { timeout: 5_000 })
    .toBeGreaterThan(2);
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect
    .poll(async () => page.locator(".cm-activeLine").first().innerText(), { timeout: 5_000 })
    .toBe("## 三级标题");

  // 仅预览：落点改为预览面板，滚动到目标标题并尽量贴顶
  await page.getByTestId("btn-view-preview").click();
  const pane = page.getByTestId("preview-pane");
  await expect(pane).toBeVisible();
  await pane.evaluate((el) => {
    el.scrollTop = 0;
  });

  await sampleScrollTop(".editor-preview-pane");
  await items.nth(1).click();
  // 预览端同样走平滑滚动（且此处恰好落在列宽过渡中，验证落点会跟随布局重算）
  await expect
    .poll(() => distinctScrollPositions(".editor-preview-pane"), { timeout: 5_000 })
    .toBeGreaterThan(2);
  // 平滑滚动是动画：等 scrollTop 连续两次采样一致（动画结束）再看落点
  await expect
    .poll(
      async () => {
        const first = await pane.evaluate((el) => el.scrollTop);
        await page.waitForTimeout(80);
        const second = await pane.evaluate((el) => el.scrollTop);
        return first === second ? first : -1;
      },
      { timeout: 5_000 },
    )
    .toBeGreaterThan(100);

  const offset = await pane.evaluate((el) => {
    const heading = el.querySelector(".md-preview-content h2") as HTMLElement | null;
    if (!heading) return Number.POSITIVE_INFINITY;
    return heading.getBoundingClientRect().top - el.getBoundingClientRect().top;
  });
  expect(offset).toBeGreaterThanOrEqual(-2);
  expect(offset).toBeLessThan(80);

  // 仅预览时不把焦点塞进隐藏的源码编辑器
  await expect(page.locator(".cm-content")).not.toBeFocused();
});

test("大纲跳转：切换视图后立刻点击也落到正确位置", async ({ page }) => {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();

  // 长段落：不同列宽下换行差异很大，旧实现按窄列宽算出的位置会偏出很远
  const filler = Array.from(
    { length: 18 },
    (_, i) => `第 ${i + 1} 段：${"这段文字用来制造不同列宽下的换行差异。".repeat(4)}`,
  ).join("\n\n");
  await page.keyboard.insertText(
    `# 一级标题\n\n${filler}\n\n## 二级标题\n\n${filler}\n\n## 三级标题\n\n${filler}`,
  );

  await page.getByTestId("tab-outline").click();
  const items = page.getByTestId("outline-pane").locator(".outline-item");
  await expect(items).toHaveCount(3);

  // 同一帧内切换视图并点击大纲：此时列宽过渡刚开始，行高/换行还是「0 宽」时的旧值
  // （Playwright 的逐次点击会插入足够延迟，过渡可能已结束，必须用脚本同时触发）
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-testid="btn-view-split"]')?.click();
    document.querySelector<HTMLElement>('[data-testid="outline-item-2"]')?.click();
  });

  await expect
    .poll(async () => page.locator(".cm-activeLine").first().innerText(), { timeout: 5_000 })
    .toBe("## 三级标题");

  // 滚动结束后目标标题确实停在视口顶部附近（旧实现会差出几十上百像素）。
  // 轮询到落点进入 [-2, 80) 区间：动画中途也可能是负数，不能只断言上界。
  await expect
    .poll(
      async () => {
        const offset = await page.evaluate(() => {
          const line = document.querySelector<HTMLElement>(".cm-activeLine");
          const scroller = document.querySelector<HTMLElement>(".cm-scroller");
          if (!line || !scroller) return Number.NEGATIVE_INFINITY;
          return line.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        });
        return offset >= -2 && offset < 80;
      },
      { timeout: 5_000 },
    )
    .toBe(true);
});

test("侧栏标题：点击显示 commit hash 前七位，再点一次回到标题", async ({ page }) => {
  await page.goto("");
  const title = page.getByTestId("sidebar-title");

  await expect(title).toHaveText("ClawClip");
  await expect(title).toHaveAttribute("data-mode", "title");

  await title.click();
  await expect(title).toHaveAttribute("data-mode", "commit");
  await expect(title).toHaveText(/^([0-9a-f]{7}|unknown)$/);

  await title.click();
  await expect(title).toHaveText("ClawClip");
  await expect(title).toHaveAttribute("data-mode", "title");
});

test("S5 桌面：侧栏内容为空时底部 bar 仍贴底", async ({ page }) => {
  await page.goto("");
  const sidebar = page.getByTestId("app-sidebar");
  const footer = page.getByTestId("sidebar-footer");
  await expect(footer).toBeVisible();

  const assertBottom = async () => {
    const [f, s] = await Promise.all([footer.boundingBox(), sidebar.boundingBox()]);
    expect(f).toBeTruthy();
    expect(s).toBeTruthy();
    expect(Math.abs(f!.y + f!.height - (s!.y + s!.height))).toBeLessThanOrEqual(1);
  };

  // 文档页签：没有笔记
  await expect(page.getByTestId("note-list-empty")).toBeVisible();
  await assertBottom();

  // 大纲页签：当前没有可见文档 → 也没有标题
  await page.getByTestId("tab-outline").click();
  await expect(page.getByTestId("outline-empty")).toBeVisible();
  await assertBottom();
});
