import { test, expect } from "@playwright/test";

/**
 * S4 附件闭环 E2E：上传图片 → 存 IndexedDB → 当场渲染 object URL
 * → 保存时 dehydrate 成 clawclip:// 存库 → 刷新后 hydrate 恢复显示。
 *
 * ★ R6（upload.handler 返回约定）+ R8（object URL 泄漏）在此验证。
 *
 * 选择器说明（实测）：IR 模式图片节点 --expand（光标在内）时 preview <img> 渲染时机不稳，
 * 故用「编辑器文本含 blob:」这一确定性信号作为上传完成的判据，再断言 img/IDB。
 */

const IR_EDITOR = ".vditor-ir .vditor-reset";

async function newNote(page: any) {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.waitForSelector(IR_EDITOR, { timeout: 15_000 });
  await page.locator(IR_EDITOR).first().click();
}

function pngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
}

async function uploadPng(page: any, name: string) {
  const fileInput = page.locator(".vditor input[type='file']").first();
  await fileInput.setInputFiles({ name, mimeType: "image/png", buffer: pngBuffer() });
  // 确定性等待：object URL 被插入正文（blob: 出现在编辑器文本里）
  await page
    .waitForFunction(
      () => (document.querySelector(".vditor-ir .vditor-reset")?.textContent ?? "").includes("blob:"),
      null,
      { timeout: 8_000 },
    );
}

test("S4: 上传图片 → 存 IDB + 正文当场插入 object URL", async ({ page }) => {
  await newNote(page);
  await uploadPng(page, "测试图.png");

  // ★ 正文 markdown 是 object URL（blob:），不是 clawclip://（那会当场破图）。
  //   用 textContent 作确定性判据：IR 模式光标停在图片节点内是 --expand 态显示源码，
  //   preview <img> 渲染时机不稳（并发下 flaky），故不在此断言 img——图片实际渲染
  //   由「刷新后 hydrate」测试验证（折叠态稳定）。
  const irText = await page.locator(IR_EDITOR).first().textContent();
  expect(irText).toMatch(/!\[测试图\.png\]\(blob:/);

  // blob 存进了 IndexedDB（handler 内 saveBlob 同步完成）
  const blobCount = await page.evaluate(async () => {
    return new Promise<number>((resolve) => {
      const req = indexedDB.open("claw-clip-v2", 1);
      req.onsuccess = () => {
        const db = req.result;
        const c = db.transaction("blobs").objectStore("blobs").count();
        c.onsuccess = () => resolve(c.result);
      };
    });
  });
  expect(blobCount).toBe(1);
});

test("S4: 图片保存 → 库里存 clawclip://（dehydrate），刷新后 hydrate 恢复", async ({ page }) => {
  await newNote(page);
  await uploadPng(page, "持久图.png");

  // 读取 IDB 中首条笔记 content 的辅助函数
  const readStoredContent = () =>
    page.evaluate(async () => {
      return new Promise<string>((resolve) => {
        const req = indexedDB.open("claw-clip-v2", 1);
        req.onsuccess = () => {
          const db = req.result;
          const all = db.transaction("notes").objectStore("notes").getAll();
          all.onsuccess = () => {
            const notes = all.result as Array<{ content: string }>;
            resolve(notes[0]?.content ?? "");
          };
        };
      });
    });

  // ★ 确定性轮询：等节流自动保存（800ms）+ dehydrate + IDB 写入落库，
  //   直到 content 从 blob:（渲染态）变成 clawclip://（存储态）
  await expect
    .poll(readStoredContent, { timeout: 8_000, intervals: [300] })
    .toContain("clawclip://blob/");

  const storedContent = await readStoredContent();
  expect(storedContent).not.toMatch(/blob:https?:/); // object URL 没被存进库

  // ★ 刷新 → hydrate 把 clawclip:// 换回 object URL，图片恢复显示
  await page.reload();
  await page.waitForSelector(IR_EDITOR, { timeout: 15_000 });
  await page
    .waitForFunction(
      () => (document.querySelector(".vditor-ir .vditor-reset")?.textContent ?? "").includes("blob:"),
      null,
      { timeout: 8_000 },
    );
  const textAfter = await page.locator(IR_EDITOR).first().textContent();
  expect(textAfter).toMatch(/blob:/); // hydrate 后重新是 object URL
  await expect(page.locator(".vditor img").first()).toBeAttached({ timeout: 5_000 });
});

test("S4: 附件 blob 确实存进 IndexedDB blobs store", async ({ page }) => {
  await newNote(page);
  await uploadPng(page, "blob检查.png");
  await page.waitForTimeout(1500);

  const blobInfo = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open("claw-clip-v2", 1);
      req.onsuccess = () => {
        const db = req.result;
        const all = db.transaction("blobs").objectStore("blobs").getAll();
        all.onsuccess = () => {
          const blobs = all.result as Array<{ mime: string; size: number; noteId: string }>;
          resolve(blobs.map((b) => ({ mime: b.mime, size: b.size, hasNoteId: !!b.noteId })));
        };
      };
    });
  });
  expect(blobInfo).toHaveLength(1);
  expect((blobInfo as any)[0].mime).toBe("image/png");
  expect((blobInfo as any)[0].hasNoteId).toBe(true);
});
