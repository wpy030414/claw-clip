/**
 * query 单测：内存过滤 / 排序 / 分页。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { LocalDataSource } from "@/data/local";
import { queryNotes } from "@/data/query";
import { makeNote } from "@/test/factories";

const ds = new LocalDataSource();

async function seed() {
  // 造 5 条笔记，updatedAt 递增，含不同 tags/starred
  await ds.upsertNote(makeNote({ id: "n1", title: "苹果派食谱", content: "面粉 苹果 糖", tags: ["美食"], starred: true, updatedAt: 100, createdAt: 100 }));
  await ds.upsertNote(makeNote({ id: "n2", title: "React 笔记", content: "hooks effect state", tags: ["编程", "前端"], starred: false, updatedAt: 200, createdAt: 150 }));
  await ds.upsertNote(makeNote({ id: "n3", title: "读书摘录", content: "人生若只如初见", tags: ["读书"], starred: true, updatedAt: 300, createdAt: 300 }));
  await ds.upsertNote(makeNote({ id: "n4", title: "前端框架对比", content: "React Vue Svelte", tags: ["编程", "前端"], starred: false, updatedAt: 400, createdAt: 200 }));
  await ds.upsertNote(makeNote({ id: "n5", title: "购物清单", content: "牛奶 面包 苹果", tags: ["生活"], starred: false, updatedAt: 500, createdAt: 500 }));
}

beforeEach(async () => {
  await seed();
});

describe("queryNotes 过滤", () => {
  it("无 filter 返回全部", async () => {
    const r = await queryNotes({}, 100, 0);
    expect(r.total).toBe(5);
    expect(r.items).toHaveLength(5);
  });

  it("keyword 命中标题（跨 title+content 匹配）", async () => {
    const r = await queryNotes({ keyword: "React" }, 100, 0);
    // n2 标题「React 笔记」命中；n4 正文「React Vue Svelte」也命中
    expect(r.total).toBe(2);
    expect(r.items.map((i) => i.id).sort()).toEqual(["n2", "n4"]);
  });

  it("keyword 仅命中标题时精确定位单条", async () => {
    const r = await queryNotes({ keyword: "购物清单" }, 100, 0);
    expect(r.total).toBe(1);
    expect(r.items[0].id).toBe("n5");
  });

  it("keyword 命中正文 content", async () => {
    const r = await queryNotes({ keyword: "Svelte" }, 100, 0);
    expect(r.items.map((i) => i.id)).toContain("n4");
  });

  it("keyword 命中标签", async () => {
    const r = await queryNotes({ keyword: "美食" }, 100, 0);
    expect(r.items[0].id).toBe("n1");
  });

  it("keyword 大小写不敏感", async () => {
    const r = await queryNotes({ keyword: "react" }, 100, 0);
    expect(r.items.map((i) => i.id)).toContain("n2");
  });

  it("keyword 无命中返回空", async () => {
    const r = await queryNotes({ keyword: "不存在的关键词xyz" }, 100, 0);
    expect(r.total).toBe(0);
    expect(r.items).toHaveLength(0);
  });

  it("starred 过滤", async () => {
    const r = await queryNotes({ starred: true }, 100, 0);
    expect(r.total).toBe(2);
    expect(r.items.every((i) => i.starred)).toBe(true);
  });

  it("tags AND 语义（同时含多标签）", async () => {
    const r = await queryNotes({ tags: ["编程", "前端"] }, 100, 0);
    expect(r.total).toBe(2); // n2, n4
    expect(r.items.map((i) => i.id).sort()).toEqual(["n2", "n4"]);
  });

  it("tags 只含一个标签时命中更少", async () => {
    const r = await queryNotes({ tags: ["读书"] }, 100, 0);
    expect(r.total).toBe(1);
    expect(r.items[0].id).toBe("n3");
  });

  it("多条件组合（starred + keyword）", async () => {
    const r = await queryNotes({ starred: true, keyword: "苹果" }, 100, 0);
    expect(r.total).toBe(1); // n1（收藏且含苹果）
    expect(r.items[0].id).toBe("n1");
  });
});

describe("queryNotes 排序", () => {
  it("默认按 updatedAt 降序（新在前）", async () => {
    const r = await queryNotes({}, 100, 0);
    expect(r.items[0].id).toBe("n5"); // updatedAt=500 最大
    expect(r.items[4].id).toBe("n1"); // updatedAt=100 最小
  });

  it("sort=created 按 createdAt 降序", async () => {
    const r = await queryNotes({ sort: "created" }, 100, 0);
    expect(r.items[0].id).toBe("n5"); // createdAt=500
    expect(r.items[4].id).toBe("n1"); // createdAt=100
  });

  it("sort=title 按标题 localeCompare 升序", async () => {
    const r = await queryNotes({ sort: "title" }, 100, 0);
    const titles = r.items.map((i) => i.title);
    const sorted = [...titles].sort((a, b) => a.localeCompare(b));
    expect(titles).toEqual(sorted);
  });
});

describe("queryNotes 分页", () => {
  it("pageSize 限制每页条数", async () => {
    const r = await queryNotes({}, 2, 0);
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(5); // total 是过滤后总数，非本页数
  });

  it("pageOffset 偏移取后续页", async () => {
    const page1 = await queryNotes({}, 2, 0);
    const page2 = await queryNotes({}, 2, 2);
    expect(page1.items.map((i) => i.id)).not.toEqual(page2.items.map((i) => i.id));
    expect(page2.items).toHaveLength(2);
  });

  it("pageOffset 超范围返回空 items", async () => {
    const r = await queryNotes({}, 2, 100);
    expect(r.items).toHaveLength(0);
    expect(r.total).toBe(5);
  });

  it("最后一页返回剩余条数", async () => {
    const r = await queryNotes({}, 2, 4); // 第 3 页，只剩 1 条
    expect(r.items).toHaveLength(1);
  });
});

describe("queryNotes 投影（NoteSummary 不含 content）", () => {
  it("返回的 items 是轻量投影，不含 content 字段", async () => {
    const r = await queryNotes({}, 100, 0);
    const item = r.items[0] as Record<string, unknown>;
    expect(item.content).toBeUndefined(); // ★ content 不进列表投影
    expect(item.title).toBeDefined();
    expect(item.excerpt).toBeDefined();
    expect(item.wordCount).toBeDefined();
  });
});

describe("queryNotes 文件夹过滤", () => {
  it("folderId 精确匹配；undefined=全部；null=根目录", async () => {
    await ds.upsertNote(makeNote({ id: "f1", title: "文件夹内笔记", folderId: "folder-a" }));
    await ds.upsertNote(makeNote({ id: "root-1", title: "根目录笔记", folderId: null }));

    const inFolder = await queryNotes({ folderId: "folder-a" }, 100, 0);
    expect(inFolder.items.map((i) => i.id)).toEqual(["f1"]);

    const rootOnly = await queryNotes({ folderId: null }, 100, 0);
    // seed 的 5 条旧笔记没有 folderId → 视为根目录
    expect(rootOnly.total).toBe(6);
    expect(rootOnly.items.map((i) => i.id)).not.toContain("f1");

    const all = await queryNotes({}, 100, 0);
    expect(all.total).toBe(7);
  });
});
