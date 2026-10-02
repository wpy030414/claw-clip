import { test, expect } from "@playwright/test";

/**
 * S2 / R1 硬门禁：Vditor 离线自托管验证。
 *
 * 验证三件事：
 * 1. IR（即时渲染）模式能真实渲染 Markdown（# 标题 → <h1>，对齐 Typora）
 * 2. 全程零 unpkg.com 请求（子资源全走自托管 public/vditor）
 * 3. lute 引擎等关键资源本地可达
 *
 * 用独立探针页 public/__probe.html（纯 UMD，不依赖 React/blobStore），
 * 隔离验证 Vditor 本身，排除数据层干扰。
 */
test("S2/R1: Vditor 离线自托管 + IR 渲染", async ({ page }) => {
  const unpkgRequests: string[] = [];
  const allRequests: string[] = [];

  // 记录所有请求
  page.on("request", (req) => {
    const url = req.url();
    allRequests.push(url);
    if (url.includes("unpkg.com")) unpkgRequests.push(url);
  });

  // 拦截 unpkg.com：直接 abort（模拟断网/CDN 不可达），确保离线成立
  await page.route("**://unpkg.com/**", (route) => route.abort());

  await page.goto("__probe.html");

  // 等待 Vditor after 回调（lute 异步加载完成）
  await page.waitForFunction("window.__vditorReady === true", null, { timeout: 15_000 });

  // 等待 IR 渲染出 <h1>（setValue 在 after 里已灌入 "# 标题测试"）
  const h1 = page.locator(".vditor-ir h1, .vditor-reset h1").first();
  await expect(h1).toBeAttached({ timeout: 8_000 });
  await expect(h1).toContainText("标题测试");

  // 验证加粗、列表也渲染了
  await expect(page.locator(".vditor-reset strong").first()).toBeAttached();
  await expect(page.locator(".vditor-reset li").first()).toBeAttached();

  // ★ 核心断言：全程零 unpkg 请求（离线自托管成立）
  expect(unpkgRequests).toEqual([]);

  // 验证关键子资源确实从本地加载了（lute 引擎）
  const luteLoaded = allRequests.some((u) => u.includes("/claw-clip/vditor/dist/js/lute/lute.min.js"));
  expect(luteLoaded).toBe(true);

  console.log(`[S2] 总请求数: ${allRequests.length}, unpkg 请求: ${unpkgRequests.length}`);
  console.log(`[S2] 本地 vditor 请求: ${allRequests.filter((u) => u.includes("/claw-clip/vditor")).length}`);
});

test("S2/R5: StrictMode 双挂载幂等（探针页重建 Vditor 不报错）", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("__probe.html");
  await page.waitForFunction("window.__vditorReady === true", null, { timeout: 15_000 });

  // 模拟 StrictMode 场景：destroy 后重建，验证 destroy 正确清理、重建不报错
  const result = await page.evaluate(async () => {
    const vd = (window as any).__vd;
    vd.destroy();
    await new Promise((r) => setTimeout(r, 200));
    // 重建
    let rebuilt = false;
    const vd2 = new (window as any).Vditor("vditor", {
      mode: "ir",
      height: 300,
      cdn: "/claw-clip/vditor",
      cache: { id: "probe-remount", enable: false },
      after: () => { rebuilt = true; },
    });
    await new Promise((r) => setTimeout(r, 1500));
    (window as any).__vd = vd2;
    return { rebuilt, hasInstance: !!vd2 };
  });

  expect(result.rebuilt).toBe(true);
  expect(result.hasInstance).toBe(true);
  expect(errors).toEqual([]); // 无 JS 报错
});
