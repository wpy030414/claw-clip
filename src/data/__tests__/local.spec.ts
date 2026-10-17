/**
 * LocalDataSource 单测。
 *
 * ★ 重点：upsertNote 原地更新（同 id 覆盖）——回归旧「编辑=删旧建新」bug。
 * db.ts 单例重置已由 test/setup.ts 的 afterEach(__resetDbSingleton) 处理。
 */
import { describe, expect, it } from "vitest";
import { LocalDataSource } from "@/data/local";
import { BLOB_URL_SCHEME } from "@/data/blobStore";
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

describe("LocalDataSource.deleteNote（引用计数级联）", () => {
  /** 把附件挂进正文（attachmentIds 故意留空，验证 upsert 以正文为准反填）。 */
  const withRefs = (id: string, blobIds: string[]) =>
    makeNote({
      id,
      content: blobIds.map((b) => `![](${BLOB_URL_SCHEME}${b})`).join("\n"),
      attachmentIds: [],
    });

  it("删除笔记时引用计数归零，其全部附件自动删除", async () => {
    const b1 = await ds.saveAttachment("note-with-blobs", makeBlob("img1", "image/png"));
    const b2 = await ds.saveAttachment("note-with-blobs", makeBlob("img2", "image/png"));
    await ds.upsertNote(withRefs("note-with-blobs", [b1, b2]));

    expect((await ds.getAttachment(b1))!.refCount).toBe(1);
    expect((await ds.getAttachment(b2))!.refCount).toBe(1);

    await ds.deleteNote("note-with-blobs");

    expect(await ds.getNote("note-with-blobs")).toBeUndefined();
    // ★ 引用归零 → 附件自动回收
    expect(await ds.getAttachment(b1)).toBeUndefined();
    expect(await ds.getAttachment(b2)).toBeUndefined();
  });

  it("删一条笔记不影响其它笔记独立引用的附件", async () => {
    const b1 = await ds.saveAttachment("n1", makeBlob("a"));
    const b2 = await ds.saveAttachment("n2", makeBlob("b"));
    await ds.upsertNote(withRefs("n1", [b1]));
    await ds.upsertNote(withRefs("n2", [b2]));

    await ds.deleteNote("n1");

    expect(await ds.getAttachment(b1)).toBeUndefined(); // n1 的附件回收
    expect(await ds.getAttachment(b2)).toBeDefined(); // n2 的附件还在
    expect((await ds.getAttachment(b2))!.refCount).toBe(1);
    expect(await ds.getNote("n2")).toBeDefined();
  });
});

describe("LocalDataSource 附件引用计数", () => {
  it("从正文移除引用并保存后，附件立即自动回收", async () => {
    const b = await ds.saveAttachment("n", makeBlob("img", "image/png"));
    const note = makeNote({
      id: "n",
      content: `![](${BLOB_URL_SCHEME}${b})`,
    });
    await ds.upsertNote(note);
    expect((await ds.getAttachment(b))!.refCount).toBe(1);

    await ds.upsertNote({ ...note, content: "附件删掉了" });

    expect(await ds.getAttachment(b)).toBeUndefined(); // ★ 无笔记使用 → 清掉
  });

  it("同一附件被多条笔记引用：删一条不误删，全部删完才回收", async () => {
    const b = await ds.saveAttachment("n1", makeBlob("shared", "image/png"));
    const content = `![](${BLOB_URL_SCHEME}${b})`;
    await ds.upsertNote(makeNote({ id: "n1", content }));
    await ds.upsertNote(makeNote({ id: "n2", content }));

    expect((await ds.getAttachment(b))!.refCount).toBe(2);

    await ds.deleteNote("n1");
    expect((await ds.getAttachment(b))!.refCount).toBe(1); // ★ 仍被 n2 引用

    await ds.deleteNote("n2");
    expect(await ds.getAttachment(b)).toBeUndefined(); // 最后一条引用消失才删
  });

  it("同一笔记内重复引用同一附件只计一次", async () => {
    const b = await ds.saveAttachment("n", makeBlob("dup", "image/png"));
    await ds.upsertNote(
      makeNote({
        id: "n",
        content: `![](${BLOB_URL_SCHEME}${b}) 再次 ![](${BLOB_URL_SCHEME}${b})`,
      }),
    );

    expect((await ds.getAttachment(b))!.refCount).toBe(1);
  });

  it("upsert 以正文为准重填 attachmentIds（陈旧索引不会污染计数）", async () => {
    const b = await ds.saveAttachment("n", makeBlob("real", "image/png"));
    await ds.upsertNote(
      makeNote({
        id: "n",
        content: `![](${BLOB_URL_SCHEME}${b})`,
        attachmentIds: ["ghost-blob"],
      }),
    );

    const got = await ds.getNote("n");
    expect(got!.attachmentIds).toEqual([b]);
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
    const blobContent = "图片二进制内容";
    const blobId = await ds.saveAttachment("exp1", makeBlob(blobContent, "image/png"));
    const note = makeNote({
      id: "exp1",
      content: `导出测试 ![](${BLOB_URL_SCHEME}${blobId})`,
      tags: ["tag1"],
    });
    await ds.upsertNote(note);

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
    expect(gotNote!.content).toContain("导出测试");
    expect(gotNote!.content).toContain(`${BLOB_URL_SCHEME}${blobId}`);
    expect(gotNote!.tags).toEqual(["tag1"]);

    const gotBlob = await ds.getAttachment(blobId);
    expect(gotBlob!.refCount).toBe(1); // ★ 导入后按正文重算
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
    // 附件必须被正文引用，否则导入后的 reconcile 会把它当孤儿回收
    await ds.upsertNote(
      makeNote({ id: "bin1", content: `![](${BLOB_URL_SCHEME}${blobId})` }),
    );

    const payload = await ds.exportAll();
    await ds.clear();
    await ds.importAll(payload);

    const got = await ds.getAttachment(blobId);
    const restored = new Uint8Array(await got!.data.arrayBuffer());
    // ★ 逐字节比对
    expect(Array.from(restored)).toEqual(Array.from(bytes));
  });
});

describe("LocalDataSource 文件夹（v2）", () => {
  it("新建 / 列出文件夹", async () => {
    const f = await ds.upsertFolder({
      id: "folder-1",
      name: "工作",
      parentId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(f.name).toBe("工作");
    const all = await ds.listFolders();
    expect(all.map((x) => x.id)).toContain("folder-1");
  });

  it("删除文件夹级联删除子孙文件夹与其下笔记", async () => {
    await ds.upsertFolder({ id: "f-root", name: "项目", parentId: null, createdAt: 1, updatedAt: 1 });
    await ds.upsertFolder({ id: "f-child", name: "子项", parentId: "f-root", createdAt: 1, updatedAt: 1 });
    await ds.upsertFolder({ id: "f-other", name: "无关", parentId: null, createdAt: 1, updatedAt: 1 });
    await ds.upsertNote(makeNote({ id: "n-in", folderId: "f-child" }));
    await ds.upsertNote(makeNote({ id: "n-out", folderId: "f-other" }));

    await ds.deleteFolder("f-root");

    const folders = await ds.listFolders();
    expect(folders.map((f) => f.id)).toEqual(["f-other"]);
    expect(await ds.getNote("n-in")).toBeUndefined();
    expect(await ds.getNote("n-out")).toBeDefined();
  });

  it("deleteNote 不影响同文件夹的其它笔记", async () => {
    await ds.upsertFolder({ id: "f-x", name: "X", parentId: null, createdAt: 1, updatedAt: 1 });
    await ds.upsertNote(makeNote({ id: "a", folderId: "f-x" }));
    await ds.upsertNote(makeNote({ id: "b", folderId: "f-x" }));
    await ds.deleteNote("a");
    expect(await ds.getNote("b")).toBeDefined();
  });
});
