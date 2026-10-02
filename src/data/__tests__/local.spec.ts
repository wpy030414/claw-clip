/**
 * LocalDataSource 单测。
 *
 * ★ 重点：upsertNote 原地更新（同 id 覆盖）——回归旧「编辑=删旧建新」bug。
 * db.ts 单例重置已由 test/setup.ts 的 afterEach(__resetDbSingleton) 处理。
 */
import { describe, expect, it } from "vitest";
import { LocalDataSource } from "@/data/local";
import { makeNote, makeBlob } from "@/test/factories";

const ds = new LocalDataSource();

describe("LocalDataSource.upsertNote / getNote", () => {
  it("新笔记 upsert 后可 getNote 取回完整 content", async () => {
    const note = makeNote({ content: "# 标题\n\n完整正文内容" });
    await ds.upsertNote(note);

    const got = await ds.getNote(note.id);
    expect(got).toBeDefined();
    expect(got!.id).toBe(note.id);
    expect(got!.content).toBe("# 标题\n\n完整正文内容");
  });

  it("★ 同 id 二次 upsert = 原地更新（id 不变、只有一条、content 覆盖）", async () => {
    const id = "fixed-note-id-001";
    const first = makeNote({ id, content: "第一版", updatedAt: 1000 });
    await ds.upsertNote(first);

    // 模拟「编辑保存」：同 id 改 content，绝不改 id
    const second = makeNote({ id, content: "第二版", updatedAt: 2000 });
    await ds.upsertNote(second);

    const got = await ds.getNote(id);
    expect(got!.content).toBe("第二版");
    expect(got!.id).toBe(id); // ★ id 不变（旧版 bug：id 会变）

    // ★ 全库只有一条（旧版 bug：delete+add 若时序错会残留/重复）
    expect(await ds.countAll()).toBe(1);
  });

  it("getNote 不存在的 id 返回 undefined", async () => {
    expect(await ds.getNote("no-such-id")).toBeUndefined();
  });
});

describe("LocalDataSource.deleteNote（级联删附件）", () => {
  it("删除笔记时级联删除其全部附件 blob", async () => {
    const note = makeNote({ id: "note-with-blobs" });
    await ds.upsertNote(note);

    // 存两个附件
    const b1 = await ds.saveAttachment("note-with-blobs", makeBlob("img1", "image/png"));
    const b2 = await ds.saveAttachment("note-with-blobs", makeBlob("img2", "image/png"));
    expect(await ds.getAttachment(b1)).toBeDefined();
    expect(await ds.getAttachment(b2)).toBeDefined();

    await ds.deleteNote("note-with-blobs");

    // 笔记没了
    expect(await ds.getNote("note-with-blobs")).toBeUndefined();
    // ★ 附件也级联删了
    expect(await ds.getAttachment(b1)).toBeUndefined();
    expect(await ds.getAttachment(b2)).toBeUndefined();
  });

  it("删一条笔记不影响其它笔记的附件", async () => {
    const n1 = makeNote({ id: "n1" });
    const n2 = makeNote({ id: "n2" });
    await ds.upsertNote(n1);
    await ds.upsertNote(n2);
    const b1 = await ds.saveAttachment("n1", makeBlob("a"));
    const b2 = await ds.saveAttachment("n2", makeBlob("b"));

    await ds.deleteNote("n1");

    expect(await ds.getAttachment(b1)).toBeUndefined(); // n1 的附件删了
    expect(await ds.getAttachment(b2)).toBeDefined(); // n2 的附件还在
    expect(await ds.getNote("n2")).toBeDefined();
  });
});

describe("LocalDataSource.setStarred / toggleStar（内联字段）", () => {
  it("setStarred 改内联字段，无需独立 stars 表", async () => {
    const note = makeNote({ id: "star-me", starred: false });
    await ds.upsertNote(note);

    await ds.setStarred("star-me", true);
    expect((await ds.getNote("star-me"))!.starred).toBe(true);

    await ds.setStarred("star-me", false);
    expect((await ds.getNote("star-me"))!.starred).toBe(false);
  });

  it("toggleStar 返回切换后的值", async () => {
    const note = makeNote({ id: "toggle-me", starred: false });
    await ds.upsertNote(note);

    expect(await ds.toggleStar("toggle-me")).toBe(true);
    expect((await ds.getNote("toggle-me"))!.starred).toBe(true);
    expect(await ds.toggleStar("toggle-me")).toBe(false);
    expect((await ds.getNote("toggle-me"))!.starred).toBe(false);
  });

  it("setStarred 保留原 createdAt，不因收藏刷新", async () => {
    const note = makeNote({ id: "keep-time", createdAt: 12345, updatedAt: 12345 });
    await ds.upsertNote(note);
    await ds.setStarred("keep-time", true);
    const got = await ds.getNote("keep-time");
    expect(got!.createdAt).toBe(12345);
    expect(got!.updatedAt).toBe(12345); // ★ 收藏不改 updatedAt
  });
});

describe("LocalDataSource.countAll / clear", () => {
  it("countAll 返回笔记总数", async () => {
    await ds.upsertNote(makeNote({ id: "c1" }));
    await ds.upsertNote(makeNote({ id: "c2" }));
    await ds.upsertNote(makeNote({ id: "c3" }));
    expect(await ds.countAll()).toBe(3);
  });

  it("clear 清空 notes + blobs", async () => {
    await ds.upsertNote(makeNote({ id: "x1" }));
    await ds.saveAttachment("x1", makeBlob("data"));
    await ds.clear();
    expect(await ds.countAll()).toBe(0);
  });
});

describe("LocalDataSource.exportAll / importAll（备份往返）", () => {
  it("导出→导入往返一致（notes 字段 + blob 二进制还原）", async () => {
    const note = makeNote({ id: "exp1", content: "导出测试", tags: ["tag1"] });
    await ds.upsertNote(note);
    const blobContent = "图片二进制内容";
    const blobId = await ds.saveAttachment("exp1", makeBlob(blobContent, "image/png"));

    // 导出
    const payload = await ds.exportAll();
    expect(payload.schemaVersion).toBe(2);
    expect(payload.notes).toHaveLength(1);
    expect(payload.blobs).toHaveLength(1);
    expect(payload.blobs[0].base64).toBeTruthy(); // base64 化

    // 清空再导入
    await ds.clear();
    expect(await ds.countAll()).toBe(0);

    const result = await ds.importAll(payload);
    expect(result.notes).toBe(1);
    expect(result.blobs).toBe(1);

    // 验证还原
    const gotNote = await ds.getNote("exp1");
    expect(gotNote!.content).toBe("导出测试");
    expect(gotNote!.tags).toEqual(["tag1"]);

    const gotBlob = await ds.getAttachment(blobId);
    expect(gotBlob).toBeDefined();
    expect(await gotBlob!.data.text()).toBe(blobContent); // ★ 二进制无损还原
    expect(gotBlob!.mime).toBe("image/png");
  });

  it("base64 编解码二进制安全（含 0x00/0xFF 非 ASCII 字节）", async () => {
    const note = makeNote({ id: "bin1" });
    await ds.upsertNote(note);

    // 构造含非 ASCII 字节的二进制
    const bytes = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0xc3, 0xa9, 0x01, 0xfe]);
    const blobId = await ds.saveAttachment("bin1", new Blob([bytes], { type: "application/octet-stream" }));

    const payload = await ds.exportAll();
    await ds.clear();
    await ds.importAll(payload);

    const got = await ds.getAttachment(blobId);
    const restored = new Uint8Array(await got!.data.arrayBuffer());
    // ★ 逐字节比对
    expect(Array.from(restored)).toEqual(Array.from(bytes));
  });
});
