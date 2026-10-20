import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { searchAllNotes, compileSearchQuery } from "../searchAll";
import { openDB } from "../db";
import type { Note } from "@/types/note";

/**
 * 创建测试用的笔记数据。
 */
function createNote(overrides: Partial<Note> = {}): Note {
  return {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: "测试笔记",
    content: "这是一段测试内容",
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    wordCount: 10,
    excerpt: "测试内容",
    attachmentIds: [],
    folderId: null,
    schemaVersion: 2,
    ...overrides,
  };
}

/**
 * 向 IndexedDB 插入测试笔记。
 */
async function insertNote(note: Note): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("notes", "readwrite");
    tx.objectStore("notes").put(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 清空 IndexedDB 中的笔记。
 */
async function clearNotes(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("notes", "readwrite");
    tx.objectStore("notes").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe("searchAllNotes", () => {
  beforeEach(async () => {
    await clearNotes();
  });

  afterEach(async () => {
    await clearNotes();
  });

  describe("过滤功能", () => {
    it("按标题匹配", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          title: "React 学习指南",
          content: "无关内容",
        }),
      );
      await insertNote(
        createNote({
          id: "note-2",
          title: "Vue 教程",
          content: "无关内容",
        }),
      );

      const results = await searchAllNotes("React");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("note-1");
    });

    it("按正文匹配", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          title: "笔记1",
          content: "TypeScript 是 JavaScript 的超集",
        }),
      );
      await insertNote(
        createNote({
          id: "note-2",
          title: "笔记2",
          content: "Python 是另一种语言",
        }),
      );

      const results = await searchAllNotes("TypeScript");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("note-1");
    });

    it("按标签匹配", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          title: "笔记1",
          content: "无关内容",
          tags: ["前端", "JavaScript"],
        }),
      );
      await insertNote(
        createNote({
          id: "note-2",
          title: "笔记2",
          content: "无关内容",
          tags: ["后端", "Python"],
        }),
      );

      const results = await searchAllNotes("前端");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("note-1");
    });

    it("大小写不敏感", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          title: "React Tutorial",
          content: "Learn react hooks",
        }),
      );

      const results = await searchAllNotes("REACT");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("note-1");
    });

    it("空关键词返回空数组", async () => {
      await insertNote(createNote({ id: "note-1" }));

      const results = await searchAllNotes("");
      expect(results).toHaveLength(0);
    });

    it("无匹配返回空数组", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          title: "React 笔记",
          content: "学习 React",
        }),
      );

      const results = await searchAllNotes("Vue");
      expect(results).toHaveLength(0);
    });
  });

  describe("评分排序", () => {
    it("标题匹配权重最高", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          title: "其他标题",
          content: "React 相关内容",
        }),
      );
      await insertNote(
        createNote({
          id: "note-2",
          title: "React 教程",
          content: "无关内容",
        }),
      );

      const results = await searchAllNotes("React");
      expect(results).toHaveLength(2);
      // 标题匹配的应该排在前面
      expect(results[0].id).toBe("note-2");
      expect(results[0].score).toBe(10); // 标题匹配权重10
      expect(results[1].score).toBe(1); // 正文匹配权重1
    });

    it("正文命中次数影响评分", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          title: "笔记1",
          content: "React React React 三次出现",
        }),
      );
      await insertNote(
        createNote({
          id: "note-2",
          title: "笔记2",
          content: "React 只出现一次",
        }),
      );

      const results = await searchAllNotes("React");
      expect(results).toHaveLength(2);
      // 出现三次的应该排在前面
      expect(results[0].id).toBe("note-1");
      expect(results[0].score).toBe(3); // 正文匹配3次
      expect(results[1].score).toBe(1); // 正文匹配1次
    });

    it("标签匹配权重为3", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          title: "笔记1",
          content: "React 内容",
          tags: ["前端"],
        }),
      );
      await insertNote(
        createNote({
          id: "note-2",
          title: "笔记2",
          content: "无关内容",
          tags: ["React"],
        }),
      );

      const results = await searchAllNotes("React");
      expect(results).toHaveLength(2);
      // 标签匹配的评分应该高于正文匹配
      const tagMatch = results.find((r) => r.id === "note-2");
      const contentMatch = results.find((r) => r.id === "note-1");
      expect(tagMatch?.score).toBe(3);
      expect(contentMatch?.score).toBe(1);
    });
  });

  describe("片段生成", () => {
    it("包含高亮标记", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          title: "笔记1",
          content: "这是一段包含 React 的长文本内容",
        }),
      );

      const results = await searchAllNotes("React");
      expect(results).toHaveLength(1);
      expect(results[0].snippet).toContain("<mark>");
      expect(results[0].snippet).toContain("</mark>");
      expect(results[0].snippet).toContain("React");
    });

    it("包含省略号", async () => {
      const longContent = "A".repeat(100) + "React" + "B".repeat(100);
      await insertNote(
        createNote({
          id: "note-1",
          title: "笔记1",
          content: longContent,
        }),
      );

      const results = await searchAllNotes("React");
      expect(results).toHaveLength(1);
      expect(results[0].snippet).toContain("…");
    });

    it("标题匹配但正文无匹配时不生成片段", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          title: "React 笔记",
          content: "完全不相关的内容",
        }),
      );

      const results = await searchAllNotes("React");
      expect(results).toHaveLength(1);
      expect(results[0].snippet).toBe("");
    });
  });

  describe("命中详情（树形叶子）", () => {
    it("标题 / 标签 / 正文标题行 / 正文按局部相关度排序", async () => {
      const content = "第一段 React 出现\n\n# React 标题\n\n第二段 React";
      await insertNote(
        createNote({
          id: "note-1",
          title: "React 指南",
          tags: ["React", "前端"],
          content,
        }),
      );

      const results = await searchAllNotes("React");
      expect(results).toHaveLength(1);
      const result = results[0];

      expect(result.matchCount).toBe(5); // 标题 + 1 个标签 + 3 处正文
      expect(result.matches.map((m) => m.kind)).toEqual([
        "title",
        "tag",
        "content",
        "content",
        "content",
      ]);
      // 标题行命中高于正文命中
      expect(result.matches[2].inHeading).toBe(true);
      expect(result.matches[3].inHeading).toBe(false);
      expect(result.matches[4].inHeading).toBe(false);

      // 每个正文命中的偏移都能原样切回关键词
      for (const match of result.matches.filter((m) => m.kind === "content")) {
        expect(match.offset).not.toBeNull();
        expect(content.slice(match.offset!, match.offset! + match.length)).toBe("React");
      }
    });

    it("大小写不敏感时偏移仍指向原文", async () => {
      const content = "xx REACT yy react zz";
      await insertNote(
        createNote({
          id: "note-1",
          content,
        }),
      );

      const results = await searchAllNotes("react");
      const matches = results[0].matches.filter((m) => m.kind === "content");
      expect(matches).toHaveLength(2);
      expect(content.slice(matches[0].offset!, matches[0].offset! + matches[0].length)).toBe(
        "REACT",
      );
      expect(content.slice(matches[1].offset!, matches[1].offset! + matches[1].length)).toBe(
        "react",
      );
    });

    it("标题/标签命中没有正文偏移", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          title: "React 指南",
          tags: ["React"],
          content: "无关内容",
        }),
      );

      const results = await searchAllNotes("React");
      const titleMatch = results[0].matches.find((m) => m.kind === "title");
      const tagMatch = results[0].matches.find((m) => m.kind === "tag");
      expect(titleMatch?.offset).toBeNull();
      expect(tagMatch?.offset).toBeNull();
    });

    it("CRLF 内容按编辑器归一后的偏移返回", async () => {
      const raw = "第一行\r\n第二行 React\r\n第三行";
      await insertNote(
        createNote({
          id: "note-1",
          content: raw,
        }),
      );

      const results = await searchAllNotes("React");
      const match = results[0].matches.find((m) => m.kind === "content")!;
      const normalized = raw.replace(/\r\n?/g, "\n");
      expect(match.offset).toBe(normalized.indexOf("React"));
      expect(normalized.slice(match.offset!, match.offset! + match.length)).toBe("React");
    });

    it("单篇命中过多时保留真实总数，叶子受上限约束", async () => {
      const content = "React ".repeat(40);
      await insertNote(
        createNote({
          id: "note-1",
          content,
        }),
      );

      const results = await searchAllNotes("React");
      expect(results[0].matchCount).toBe(40);
      expect(results[0].matches).toHaveLength(30);
    });

    it("每个命中片段只高亮目标关键词一次", async () => {
      const content = "React 前面 React 后面 React";
      await insertNote(
        createNote({
          id: "note-1",
          content,
        }),
      );

      const results = await searchAllNotes("React");
      for (const match of results[0].matches) {
        const marks = match.snippet.match(/<mark>/g) ?? [];
        expect(marks).toHaveLength(1);
      }
    });

    it("当前文章永远排在第一位", async () => {
      await insertNote(
        createNote({
          id: "note-strong",
          title: "React React React",
          content: "React React React",
        }),
      );
      await insertNote(
        createNote({
          id: "note-current",
          title: "普通笔记",
          content: "只出现一次 React",
        }),
      );

      const results = await searchAllNotes("React", { currentNoteId: "note-current" });
      expect(results.map((r) => r.id)).toEqual(["note-current", "note-strong"]);
    });
  });

  describe("正则搜索", () => {
    it("两斜杠包裹时按正则匹配，偏移与长度指向真实命中", async () => {
      const content = "订单 12 已创建\n\n订单 345 已归档";
      await insertNote(createNote({ id: "note-1", content }));

      const results = await searchAllNotes("/订单 \\d+/");
      expect(results).toHaveLength(1);

      const matches = results[0].matches.filter((m) => m.kind === "content");
      expect(matches.map((m) => m.text)).toEqual(["订单 12", "订单 345"]);
      for (const match of matches) {
        expect(content.slice(match.offset!, match.offset! + match.length)).toBe(match.text);
      }
    });

    it("多行模式：^ 匹配每一行行首", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          content: "12 abc\n345 def\nxx 99",
        }),
      );

      const results = await searchAllNotes("/^\\d\\d/");
      expect(results).toHaveLength(1);
      expect(results[0].matchCount).toBe(2);
      expect(results[0].matches.filter((m) => m.kind === "content").map((m) => m.text)).toEqual([
        "12",
        "34",
      ]);
    });

    it("正则大小写不敏感，命中文本保留原文大小写", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          content: "REACT hooks 与 React 组件",
        }),
      );

      const results = await searchAllNotes("/react/");
      const matches = results[0].matches.filter((m) => m.kind === "content");
      expect(matches.map((m) => m.text)).toEqual(["REACT", "React"]);
    });

    it("正则同时作用于标题与标签", async () => {
      await insertNote(
        createNote({
          id: "note-1",
          title: "2026 年度计划",
          tags: ["2026", "年度"],
          content: "无关内容",
        }),
      );

      const results = await searchAllNotes("/^2026/");
      expect(results).toHaveLength(1);
      expect(results[0].matches.map((m) => m.kind)).toEqual(["title", "tag"]);
    });

    it("零宽匹配只计数，不生成空叶子", async () => {
      await insertNote(createNote({ id: "note-1", content: "a\nb\nc" }));

      // 前瞻断言是零宽的：命中位置没有可高亮、可跳转的文本
      const results = await searchAllNotes("/(?=c)/");
      expect(results).toHaveLength(1);
      expect(results[0].matchCount).toBe(1);
      expect(results[0].matches).toHaveLength(0);
    });

    it("斜杠未成对时按字面量处理", async () => {
      await insertNote(createNote({ id: "note-1", content: "路径是 /path/to/file" }));

      expect(await searchAllNotes("/path")).toHaveLength(1);
      expect(await searchAllNotes("path")).toHaveLength(1);
    });

    it("普通模式的正则元字符按字面量匹配", async () => {
      await insertNote(createNote({ id: "note-1", content: "C++ 与 a.b" }));
      await insertNote(createNote({ id: "note-2", content: "axb 不含目标" }));

      const results = await searchAllNotes("a.b");
      expect(results.map((r) => r.id)).toEqual(["note-1"]);
      expect(await searchAllNotes("C++")).toHaveLength(1);
    });

    it("非法或空正则返回空结果，并给出可展示的错误", async () => {
      await insertNote(createNote({ id: "note-1", content: "1 2 3" }));

      expect(await searchAllNotes("/(/")).toEqual([]);
      const invalid = compileSearchQuery("/(/");
      expect(invalid?.ok).toBe(false);
      if (invalid && !invalid.ok) expect(invalid.error).toContain("正则表达式无效");

      const empty = compileSearchQuery("//");
      expect(empty?.ok).toBe(false);
    });

    it("空输入不产生编译结果", () => {
      expect(compileSearchQuery("   ")).toBeNull();
    });

    it("普通模式编译为大小写不敏感的字面量正则", () => {
      const compiled = compileSearchQuery("a.b");
      expect(compiled?.ok).toBe(true);
      if (compiled?.ok) {
        expect(compiled.mode).toBe("plain");
        expect(compiled.test.test("A.B")).toBe(true);
        expect(compiled.test.test("AXB")).toBe(false);
      }
    });
  });
});
