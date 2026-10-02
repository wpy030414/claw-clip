/**
 * Vitest 全局 setup。
 *
 * 处理三个测试环境坑（均经实测确认）：
 * 1. fake-indexeddb 模拟 IndexedDB（jsdom 无原生实现）。
 * 2. jsdom 的 Blob 无法被 structuredClone（fake-indexeddb 存储 Blob 用），
 *    换成 Node 原生 Blob（API 兼容：arrayBuffer/text/type/size 齐全）。
 * 3. db.ts 是 Promise 单例：每个用例后 setup 会换掉 indexedDB factory（等于删库），
 *    但单例仍握旧连接 → 必须 __resetDbSingleton() 否则串库。
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { afterEach, vi } from "vitest";
import { __resetDbSingleton } from "@/data/db";
import { releaseBlobUrls } from "@/data/blobStore";

// jsdom 的 Blob/File 没有 arrayBuffer()（Node 18+ 才有），换成 Node 原生实现
(globalThis as any).Blob = NodeBlob;
(globalThis as any).File = NodeFile;

// matchMedia mock（useMediaQuery / useThemeSync 依赖）
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// URL.createObjectURL / revokeObjectURL mock（blobStore 附件 URL 依赖）
let urlCounter = 0;
Object.defineProperty(URL, "createObjectURL", {
  writable: true,
  value: vi.fn(() => `blob:mock/${++urlCounter}`),
});
Object.defineProperty(URL, "revokeObjectURL", {
  writable: true,
  value: vi.fn(),
});

afterEach(() => {
  // 释放附件 object URL 缓存（防跨用例串）
  releaseBlobUrls();
  // 换掉 indexedDB factory = 物理删库
  globalThis.indexedDB = new IDBFactory();
  // ★ 重置 db.ts 单例，否则握着上一个库的连接会串库
  __resetDbSingleton();
});
