import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * S8 存储空间：大 dialog、全库备份/清空、图床、GitHub Gist 云同步。
 *
 * 外部服务（img.scdn.io / api.github.com）一律用 page.route 拦截，
 * 并显式返回 CORS 头（GitHub 请求带 Authorization，会先发 OPTIONS 预检）。
 */

const EDITOR = '[data-testid="md-editor"] .cm-content';
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, x-github-api-version",
};

async function newNote(page: Page, text?: string): Promise<void> {
  await page.goto("");
  await page.getByTestId("btn-new").click();
  await page.getByTestId("create-note").click();
  await page.waitForSelector(EDITOR, { timeout: 15_000 });
  await page.locator(EDITOR).first().click();
  if (text) await page.keyboard.insertText(text);
}

async function openStorage(page: Page): Promise<void> {
  await page.getByTestId("sidebar-stats").click();
  await expect(page.getByTestId("storage-dialog-content")).toBeVisible();
}

async function dropPng(page: Page): Promise<void> {
  const dataTransfer = await page.evaluateHandle((base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "dot.png", { type: "image/png" }));
    return dt;
  }, PNG.toString("base64"));
  await page.dispatchEvent(EDITOR, "drop", { dataTransfer });
}

async function blobCount(page: Page): Promise<number> {
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

function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("存储 dialog：用量、分解与排行", async ({ page }) => {
  await newNote(page, "# 空间测试\n\n正文内容");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await openStorage(page);
  await expect(page.getByTestId("storage-overview")).toBeVisible();
  await expect(page.getByTestId("storage-store-notes")).toContainText("笔记（1）");
  await expect(page.getByTestId("storage-note-ranking")).toContainText("空间测试");
  await expect(page.getByTestId("storage-overview")).toContainText("本应用数据");

  // 大 dialog 尺寸：桌面下宽度应明显超过旧的小对话框（560px 上限）
  const box = await page.getByTestId("storage-dialog-content").boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(600);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("storage-dialog-content")).toBeHidden();
});

test("备份：导出 .dat → 清空 → 导入恢复", async ({ page }) => {
  await newNote(page, "# 备份标题\n\n需要被备份的正文");
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await openStorage(page);
  await page.getByTestId("storage-tab-backup").click();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("storage-backup-export").click(),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();
  const text = readFileSync(path!, "utf8");
  const parsed = JSON.parse(text) as { schemaVersion: number; notes: unknown[] };
  expect(parsed.schemaVersion).toBe(2);
  expect(parsed.notes.length).toBe(1);
  expect(text).not.toContain("ghp_");

  // 清空：必须输入「清空」才能确认
  await page.getByTestId("storage-clear").click();
  const confirm = page.getByTestId("storage-clear-confirm");
  await expect(confirm).toBeDisabled();
  await page.getByTestId("storage-clear-input").fill("清空");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByTestId("sidebar-stats")).toContainText("共 0 个笔记", {
    timeout: 5_000,
  });

  // 导入刚才的文件（合并导入）
  await page.getByTestId("storage-import-input").setInputFiles({
    name: "backup.dat",
    mimeType: "application/json",
    buffer: Buffer.from(text, "utf8"),
  });
  await expect(page.getByTestId("storage-import-preview")).toBeVisible();
  await page.getByTestId("storage-import-apply").click();
  await expect(page.getByTestId("storage-backup-message")).toContainText("已合并导入", {
    timeout: 10_000,
  });

  await page.getByTestId("storage-dialog-close").click();
  await expect(
    page.locator("[data-testid^='note-link-']").filter({ hasText: "备份标题" }),
  ).toBeVisible({ timeout: 5_000 });
});

test("图床：切换到 img.scdn.io 后粘贴图片写外链，失败回退本地", async ({ page }) => {
  let failUpload = false;
  let sawImageField = false;

  await page.route("https://img.scdn.io/**", async (route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    if (body.includes('name="image"')) sawImageField = true;
    if (failUpload) {
      await fulfillJson(route, 500, { success: false, error: "boom" });
      return;
    }
    await fulfillJson(route, 200, {
      success: true,
      data: { url: "https://img.cdn1.vip/i/mock.webp" },
    });
  });

  await newNote(page);
  await openStorage(page);
  await page.getByTestId("storage-tab-image").click();
  await page.getByTestId("storage-image-host-scdn").click();
  await expect(page.getByTestId("storage-image-warning")).toContainText("60 天");
  await page.getByTestId("storage-dialog-close").click();

  // 成功：正文写外链，不产生本地附件
  await dropPng(page);
  await expect
    .poll(async () => page.locator(EDITOR).first().innerText(), { timeout: 5_000 })
    .toContain("https://img.cdn1.vip/i/mock.webp");
  expect(sawImageField).toBe(true);
  expect(await blobCount(page)).toBe(0);

  // 失败：回退本地 clawclip://，并给出提示
  failUpload = true;
  await page.locator(EDITOR).first().click();
  await page.keyboard.press("End");
  await dropPng(page);
  await expect
    .poll(async () => page.locator(EDITOR).first().innerText(), { timeout: 5_000 })
    .toContain("clawclip://blob/");
  await expect(page.getByText(/图床上传失败，已保存到本地/).first()).toBeVisible({
    timeout: 5_000,
  });
  expect(await blobCount(page)).toBe(1);
});

test("云同步：推送快照（图片转图床）并从 Gist 合并拉取", async ({ page }) => {
  const token = "ghp_test_token_should_not_leak";
  let pushBody: Record<string, unknown> | null = null;
  let pullContent: string | null = null;

  await page.route("https://img.scdn.io/**", (route) =>
    fulfillJson(route, 200, {
      success: true,
      data: { url: "https://img.cdn1.vip/i/snapshot.webp" },
    }),
  );

  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    const path = new URL(request.url()).pathname;
    if (path === "/user") {
      await fulfillJson(route, 200, { login: "octocat" });
      return;
    }
    if (path === "/gists" && request.method() === "GET") {
      await fulfillJson(route, 200, []);
      return;
    }
    if (path === "/gists" && request.method() === "POST") {
      pushBody = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      await fulfillJson(route, 200, {
        id: "g1",
        html_url: "https://gist.github.com/g1",
        updated_at: "2026-10-18T00:00:00Z",
      });
      return;
    }
    if (path === "/gists/g1" && request.method() === "PATCH") {
      pushBody = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      await fulfillJson(route, 200, {
        id: "g1",
        html_url: "https://gist.github.com/g1",
        updated_at: "2026-10-18T00:00:00Z",
      });
      return;
    }
    if (path === "/gists/g1" && request.method() === "GET") {
      await fulfillJson(route, 200, {
        id: "g1",
        html_url: "https://gist.github.com/g1",
        updated_at: "2026-10-18T00:00:01Z",
        files: {
          "clawclip-backup.json": {
            filename: "clawclip-backup.json",
            size: pullContent?.length ?? 0,
            truncated: false,
            content: pullContent,
          },
        },
      });
      return;
    }
    await fulfillJson(route, 404, { message: "not found" });
  });

  await newNote(page, "# 同步笔记\n\n本地正文");
  await dropPng(page);
  await expect(page.getByTestId("save-state")).toHaveText("已保存", { timeout: 5_000 });

  await openStorage(page);
  await page.getByTestId("storage-tab-sync").click();
  await page.getByTestId("storage-sync-token").fill(token);
  await page.getByTestId("storage-sync-validate").click();
  await expect(page.getByTestId("storage-sync-message")).toContainText("已连接 @octocat", {
    timeout: 10_000,
  });

  await page.getByTestId("storage-sync-push").click();
  await expect(page.getByTestId("storage-sync-message")).toContainText("已推送", {
    timeout: 20_000,
  });
  expect(pushBody).toBeTruthy();
  expect(pushBody!.public).toBe(false);
  const files = pushBody!.files as Record<string, { content: string }>;
  const snapshot = JSON.parse(files["clawclip-backup.json"].content) as {
    notes: Array<{ content: string }>;
    blobs: unknown[];
  };
  // 图片已转图床：正文是外链，blobs 里不再有图片二进制
  expect(snapshot.notes[0].content).toContain("https://img.cdn1.vip/i/snapshot.webp");
  expect(snapshot.blobs).toHaveLength(0);
  expect(JSON.stringify(pushBody)).not.toContain(token);

  // 拉取：远端快照里有一条本地不存在的笔记
  pullContent = JSON.stringify({
    schemaVersion: 2,
    exportedAt: Date.now(),
    notes: [
      {
        id: "remote-note",
        title: "云端笔记",
        content: "# 云端笔记\n\n来自 Gist 的内容",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        wordCount: 4,
        excerpt: "来自 Gist 的内容",
        attachmentIds: [],
        schemaVersion: 2,
      },
    ],
    folders: [],
    blobs: [],
  });
  await page.getByTestId("storage-sync-pull").click();
  await expect(page.getByTestId("storage-sync-preview")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("storage-sync-apply").click();
  await expect(page.getByTestId("storage-sync-message")).toContainText("已合并导入", {
    timeout: 10_000,
  });

  await page.getByTestId("storage-dialog-close").click();
  await expect(
    page.locator("[data-testid^='note-link-']").filter({ hasText: "云端笔记" }),
  ).toBeVisible({ timeout: 5_000 });
});

test("云同步：覆盖拉取需要输入「覆盖」", async ({ page }) => {
  const remote = JSON.stringify({
    schemaVersion: 2,
    exportedAt: Date.now(),
    notes: [
      {
        id: "remote-only",
        title: "只剩云端",
        content: "# 只剩云端",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        wordCount: 4,
        excerpt: "只剩云端",
        attachmentIds: [],
        schemaVersion: 2,
      },
    ],
    folders: [],
    blobs: [],
  });

  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    const path = new URL(request.url()).pathname;
    if (path === "/user") return fulfillJson(route, 200, { login: "octocat" });
    if (path === "/gists/g1" && request.method() === "GET") {
      return fulfillJson(route, 200, {
        id: "g1",
        updated_at: "2026-10-18T00:00:00Z",
        files: {
          "clawclip-backup.json": { size: remote.length, truncated: false, content: remote },
        },
      });
    }
    return fulfillJson(route, 200, []);
  });

  await newNote(page, "# 本地独有\n\n会被覆盖掉");
  await openStorage(page);
  await page.getByTestId("storage-tab-sync").click();
  await page.getByTestId("storage-sync-token").fill("ghp_test");
  await page.getByTestId("storage-sync-gist-id").fill("g1");
  await page.getByTestId("storage-sync-pull").click();
  await expect(page.getByTestId("storage-sync-preview")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("storage-sync-mode-replace").check();
  await page.getByTestId("storage-sync-apply").click();
  await expect(page.getByTestId("storage-sync-message")).toContainText("输入「覆盖」", {
    timeout: 5_000,
  });

  await page.getByTestId("storage-sync-overwrite-input").fill("覆盖");
  await page.getByTestId("storage-sync-apply").click();
  await expect(page.getByTestId("storage-sync-message")).toContainText("已覆盖导入", {
    timeout: 10_000,
  });

  await page.getByTestId("storage-dialog-close").click();
  await expect(
    page.locator("[data-testid^='note-link-']").filter({ hasText: "只剩云端" }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    page.locator("[data-testid^='note-link-']").filter({ hasText: "本地独有" }),
  ).toHaveCount(0);
});

test("移动端 390px：存储 dialog 不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("");
  await openStorage(page);

  const box = await page.getByTestId("storage-dialog-content").boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(342);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.getByTestId("storage-tab-overview")).toBeVisible();
  await expect(page.getByTestId("storage-dialog-close")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("storage-dialog-content")).toBeHidden();
});
