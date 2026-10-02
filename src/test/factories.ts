/**
 * 测试辅助：快速构造 Note / BlobRecord 等测试夹具。
 */
import type { Note } from "@/types/note";
import { newId } from "@/utils/id";

/** 造一条测试笔记（可覆盖任意字段）。 */
export function makeNote(overrides: Partial<Note> = {}): Note {
  const now = Date.now();
  return {
    id: newId(),
    title: "测试笔记",
    content: "# 测试\n\n正文内容",
    starred: false,
    tags: [],
    createdAt: now,
    updatedAt: now,
    wordCount: 2,
    excerpt: "测试 正文内容",
    attachmentIds: [],
    schemaVersion: 2,
    ...overrides,
  };
}

/** 造一个测试用 Blob（Node 原生 Blob，setup 已全局替换）。 */
export function makeBlob(content: string, type = "text/plain"): Blob {
  return new Blob([content], { type });
}
