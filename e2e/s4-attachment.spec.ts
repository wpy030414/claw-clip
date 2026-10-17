import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

/**
 * 附件闭环 E2E：拖入图片 → 存 IDB blobs → 正文写 clawclip:// → 预览 hydrate 成 object URL。
 * 菜单里的「插入图片/附件」已移除，入口统一为编辑器拖放/粘贴。
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';

// 1x1 透明 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function dropPng(page: any) {
  const dataTransfer = await page.evaluateHandle((base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "dot.png", { type: "image/png" }));
    return dt;
  }, PNG.toString("base64"));
  await page.dispatchEvent(EDITOR, "drop", { dataTransfer });
}

/** 读取 IndexedDB blobs store 的记录数。 */
async function blobCount(page: any): Promise<number> {
  return page.evaluate(async () => {
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
}

async function newNote(page: any) {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
}

test("附件: 选择图片 → 正文写入 clawclip:// 引用", async ({ page }) => {
  await newNote(page);

  await dropPng(page);

  // 源码里始终保存 clawclip:// 引用（运行时 object URL 不落库）
  await expect
    .poll(async () => page.locator(EDITOR).first().innerText(), { timeout: 5_000 })
    .toContain("clawclip://blob/");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });
});

test("附件: 预览把 clawclip:// hydrate 成可显示的 object URL", async ({ page }) => {
  await newNote(page);
  await dropPng(page);
  await page.waitForTimeout(800);

  // 右侧实时预览把 clawclip:// 水合成可显示的 object URL
  const img = page.getByTestId("md-preview").locator("img").first();
  await expect(img).toBeVisible({ timeout: 10_000 });
  const src = await img.getAttribute("src");
  expect(src?.startsWith("blob:")).toBeTruthy();
});

test("附件: blob 确实存进 IndexedDB blobs store", async ({ page }) => {
  await newNote(page);
  await dropPng(page);
  await page.waitForTimeout(800);

  expect(await blobCount(page)).toBe(1);
});

test("附件: 刷新后仍能 hydrate（blob 持久化）", async ({ page }) => {
  await newNote(page);
  await dropPng(page);
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });
  await page.waitForTimeout(500);

  await page.reload();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await expect(page.getByTestId("md-preview").locator("img").first()).toBeVisible({
    timeout: 10_000,
  });
});

test("附件: 删除笔记后无引用附件自动回收（引用计数）", async ({ page }) => {
  await newNote(page);
  await dropPng(page);
  // 等自动保存把引用关系落库（attachmentIds/refCount=1）
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });
  expect(await blobCount(page)).toBe(1);

  await page.getByTestId("btn-menu").click();
  await page.getByTestId("menu-delete").click();
  // 删除确认走 M3E dialog（不再使用 window.confirm）
  await expect(page.getByTestId("delete-note-content")).toBeVisible();
  await page.getByTestId("delete-note-confirm").click();

  // 笔记删除 → 引用计数归零 → blob 自动清掉
  await expect.poll(() => blobCount(page), { timeout: 5_000 }).toBe(0);
});

test("导出 HTML：附件图片内联为 data URL，离开会话仍可见", async ({ page }) => {
  await newNote(page);
  await dropPng(page);
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await page.getByTestId("btn-menu").click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByTestId("menu-export-html").click(),
  ]);

  const html = readFileSync((await download.path())!, "utf-8");
  expect(html).toContain("data:image/png;base64,");
  expect(html).not.toContain("blob:");
});
