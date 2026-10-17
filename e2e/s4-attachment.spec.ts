import { test, expect } from "@playwright/test";

/**
 * 附件闭环 E2E：选择图片 → 存 IDB blobs → 正文写 clawclip:// → 预览 hydrate 成 object URL。
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';

// 1x1 透明 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function newNote(page: any) {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
}

test("附件: 选择图片 → 正文写入 clawclip:// 引用", async ({ page }) => {
  await newNote(page);

  await page.getByTestId("file-input").setInputFiles({
    name: "dot.png",
    mimeType: "image/png",
    buffer: PNG,
  });

  // 浏览模式会把图片渲染成 widget（源码隐藏），切回源码模式检查引用
  await page.getByTestId("btn-mode").click();
  await expect
    .poll(async () => page.locator(EDITOR).first().innerText(), { timeout: 5_000 })
    .toContain("clawclip://blob/");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });
});

test("附件: 预览把 clawclip:// hydrate 成可显示的 object URL", async ({ page }) => {
  await newNote(page);
  await page.getByTestId("file-input").setInputFiles({
    name: "dot.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.waitForTimeout(800);

  // 默认浏览模式：图片行不是当前行 → 渲染成图片 widget
  const img = page.locator(".cm-ir-image").first();
  await expect(img).toBeAttached({ timeout: 10_000 });
  const src = await img.getAttribute("src");
  expect(src?.startsWith("blob:")).toBeTruthy();
});

test("附件: blob 确实存进 IndexedDB blobs store", async ({ page }) => {
  await newNote(page);
  await page.getByTestId("file-input").setInputFiles({
    name: "dot.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.waitForTimeout(800);

  const count = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("claw-clip-v2");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction("blobs", "readonly");
      const req = tx.objectStore("blobs").count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
  expect(count).toBe(1);
});

test("附件: 刷新后仍能 hydrate（blob 持久化）", async ({ page }) => {
  await newNote(page);
  await page.getByTestId("file-input").setInputFiles({
    name: "dot.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });
  await page.waitForTimeout(500);

  await page.reload();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await expect(page.locator(".cm-ir-image").first()).toBeAttached({ timeout: 10_000 });
});
