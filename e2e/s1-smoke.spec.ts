import { test, expect } from "@playwright/test";

/**
 * S1 冒烟测试：验证 React19 + M3E + Vite 技术栈能真实渲染。
 * 这是整个重写方案的命门——M3E web component 能否在 React 19 下正常挂载并渲染 shadow DOM。
 *
 * 关键架构约束（实测得出，非文档）：
 * M3E 的 --md-sys-color-* token 设在 <m3e-theme> 元素上，靠 CSS 继承传给后代，
 * **不是**设在 :root/body。因此 light-DOM 内容（编辑器/预览）必须是 <m3e-theme>
 * 的后代才能消费 token —— 这是方案 B（主题同步）成立的前提。
 */

/** 读取某元素上生效的 M3E token（须在 m3e-theme 子树内）。 */
async function readToken(page: any, selector: string, token: string): Promise<string> {
  return page.evaluate(
    ([sel, tok]: [string, string]) =>
      getComputedStyle(document.querySelector(sel)!).getPropertyValue(tok).trim(),
    [selector, token] as [string, string],
  );
}

test("S1: M3E 主题挂载 + 按钮渲染 shadow DOM", async ({ page }) => {
  await page.goto("/");

  // m3e-theme 挂载（web component 异步定义）
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  // M3E 组件渲染出 shadow DOM（Lit 结果，非空标签）。
  // 侧栏 NotesTree 常驻渲染一个（关闭状态的）m3e-dialog。
  const dialog = page.locator("m3e-dialog").first();
  await expect(dialog).toBeAttached();
  const hasShadow = await dialog.evaluate(
    (el) => !!el.shadowRoot && el.shadowRoot.childElementCount > 0,
  );
  expect(hasShadow).toBe(true);

  // M3E 在 m3e-theme 上生成了 --md-sys-color-* token
  const primary = await readToken(page, "m3e-theme", "--md-sys-color-primary");
  expect(primary).toMatch(/^#[0-9a-fA-F]{6}$/);

  // 方案 B 命门：token 可被 m3e-theme 子树内的 light-DOM 元素继承消费
  const appDivBg = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="app-shell"]') as HTMLElement;
    return getComputedStyle(el).backgroundColor;
  });
  expect(appDivBg).toMatch(/^rgb\(/);
  expect(appDivBg).not.toBe("rgba(0, 0, 0, 0)"); // 非透明 = token 继承成功

  await page.screenshot({ path: "e2e/screenshots/s1-hello-world.png", fullPage: true });
});

test("S1: Snackbar 命令式 API 可用（Cmd+S 保存触发）", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });

  // 导入文件会触发 Snackbar（自动保存已无手动入口）
  await page.getByTestId("import-input").setInputFiles({
    name: "冒烟.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 冒烟\n\n内容", "utf-8"),
  });

  await expect(page.locator("m3e-snackbar").first()).toBeAttached({ timeout: 5_000 });
});

test("S1: 明暗模式跟随系统（scheme=auto）", async ({ page }) => {
  // dark：m3e-theme 上的 surface token 亮度应较低
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("m3e-theme")).toBeAttached({ timeout: 10_000 });
  await page.waitForTimeout(600);
  const surfaceDark = await readToken(page, "m3e-theme", "--md-sys-color-surface");

  // light：surface 亮度应较高
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(600);
  const surfaceLight = await readToken(page, "m3e-theme", "--md-sys-color-surface");

  const luminance = (hex: string) => {
    const m = hex.match(/^#([0-9a-f]{6})$/i);
    if (!m) return -1;
    const n = parseInt(m[1], 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255));
  };

  const ld = luminance(surfaceDark);
  const ll = luminance(surfaceLight);
  expect(ld).toBeGreaterThanOrEqual(0);
  expect(ll).toBeGreaterThanOrEqual(0);
  // dark surface 应比 light surface 暗，且有明显差
  expect(ld).toBeLessThan(ll);
  expect(ll - ld).toBeGreaterThan(30);
});
