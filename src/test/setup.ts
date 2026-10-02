// Vitest 全局 setup：用 fake-indexeddb 模拟 IndexedDB，mock matchMedia（jsdom 无）。
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, vi } from "vitest";

// matchMedia mock（useMediaQuery / useThemeSync 依赖）
if (!window.matchMedia) {
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
}

// URL.createObjectURL / revokeObjectURL mock（blobStore 附件 URL 依赖）
if (!URL.createObjectURL) {
  let counter = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock/${++counter}`);
  URL.revokeObjectURL = vi.fn();
}

afterEach(() => {
  // 每个测试后重置 IndexedDB 工厂，清库避免跨用例污染
  globalThis.indexedDB = new IDBFactory();
});
