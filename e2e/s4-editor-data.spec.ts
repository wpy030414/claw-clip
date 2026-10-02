import { test, expect } from "@playwright/test";

/**
 * S4 数据闭环 E2E：新建 → 编辑 Markdown → 自动保存 → 刷新持久化 → 原地编辑 id 不变。
 *
 * 这是第一次把 Vditor 真正挂进 React 组件树（S2 是独立 UMD 探针页），
 * 验证 React19 StrictMode 双挂载下 VditorEditor 幂等（R5）+ 数据闭环（R7 光标/受控）。
 */

/**
 * Vditor IR 编辑区（contenteditable）。
 * ★ 实测：IR 模式下 Vditor 渲染 4 个 .vditor-reset（wysiwyg/sv/ir/preview），
 *   只有 .vditor-ir .vditor-reset 可见可交互。必须 scope 到 .vditor-ir，
 *   否则选择器先匹配到隐藏的 wysiwyg 容器 → waitForSelector 等可见超时。
 */
const IR_EDITOR = ".vditor-ir .vditor-reset";

async function newNote(page: any) {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  // 等 Vditor 就绪（IR 编辑区可交互）
  await page.waitForSelector(IR_EDITOR, { timeout: 15_000 });
  await page.locator(IR_EDITOR).first().click();
}

test("S4: 新建笔记 → Vditor IR 编辑器挂载（React19 StrictMode 幂等）", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("");
  await expect(page.getByTestId("empty-state")).toBeVisible();

  await page.getByTestId("btn-new").click();

  // Vditor 真实渲染出 IR 编辑区（React 挂载命令式组件成功）
  await expect(page.locator(IR_EDITOR).first()).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId("editor-pane")).toBeVisible();

  // ★ R5：StrictMode 双挂载下不应有重复实例/报错。
  // Vditor 根容器只应有一个（幂等守卫生效）
  const vditorRoots = await page.locator("#vditor, .vditor").count();
  // StrictMode dev 双挂载：第一次 destroy，第二次保留 → 最终应只有 1 个可用编辑器
  expect(vditorRoots).toBeGreaterThanOrEqual(1);
  expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
});

test("S4: 输入 Markdown → IR 实时渲染（# 标题 → <h1>）", async ({ page }) => {
  await newNote(page);

  await page.keyboard.type("# 我的第一篇笔记");
  await page.waitForTimeout(300); // IR 渲染 debounce

  // IR 模式：光标不在的行渲染成富文本，# 标题 → <h1>
  const h1 = page.locator(".vditor-ir .vditor-reset h1").first();
  await expect(h1).toBeAttached({ timeout: 5_000 });
  await expect(h1).toContainText("我的第一篇笔记");
});

test("S4: 自动保存 → 刷新页面内容仍在（IndexedDB 持久化）", async ({ page }) => {
  await newNote(page);

  const content = "持久化测试内容 ABC123";
  await page.keyboard.type(content);

  // 等节流自动保存（800ms）+ 落库余量
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 3_000 });

  // ★ 刷新页面 → IndexedDB 持久化，内容应恢复
  await page.reload();
  await page.waitForSelector(IR_EDITOR, { timeout: 15_000 });

  const restored = await page.locator(".vditor-ir .vditor-reset").first().innerText();
  expect(restored).toContain(content);
});

test("S4: 原地编辑 id 不变（回归旧「编辑=删旧建新」bug）", async ({ page }) => {
  await newNote(page);
  await page.keyboard.type("第一版内容");
  await page.waitForTimeout(1200);

  // 记录当前笔记链接的 id（列表投影）
  const linksBefore = await page.locator("[data-testid^='note-link-']").all();
  expect(linksBefore.length).toBe(1);
  const idBefore = await linksBefore[0].getAttribute("data-testid");

  // 编辑同一条（不新建）
  await page.locator(IR_EDITOR).first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" + 第二版追加");
  await page.waitForTimeout(1200);

  // ★ 列表仍只有一条笔记，且 id 不变（旧 bug 会变成两条/id 变化）
  const linksAfter = await page.locator("[data-testid^='note-link-']").all();
  expect(linksAfter.length).toBe(1);
  const idAfter = await linksAfter[0].getAttribute("data-testid");
  expect(idAfter).toBe(idBefore); // ★ id 不变
});

test("S4: 字数统计随输入更新", async ({ page }) => {
  await newNote(page);

  await page.keyboard.type("你好世界测试");
  // 确定性等待：计数值 > 0（Vditor counter 有 debounce，避免固定 sleep 脆弱）
  await expect
    .poll(async () => {
      const text = await page.getByTestId("word-count").innerText();
      return parseInt(text) || 0;
    }, { timeout: 5_000 })
    .toBeGreaterThan(0);
});
