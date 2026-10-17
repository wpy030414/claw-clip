/**
 * notesStore 单测：笔记树数据态 + 乐观更新 + 派生字段重算。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useNotesStore } from "@/stores/notesStore";
import { datasource } from "@/data/datasource";
import { emptyFolder } from "@/types/folder";

beforeEach(() => {
  // 重置 store 状态
  useNotesStore.setState({
    activeNoteId: null,
    activeNote: null,
    folders: [],
    treeNotes: [],
    revision: 0,
  });
});

describe("notesStore.createNote", () => {
  it("创建空笔记并乐观插入笔记树", async () => {
    const id = await useNotesStore.getState().createNote();
    expect(id).toBeTruthy();

    const state = useNotesStore.getState();
    expect(state.treeNotes).toHaveLength(1);
    expect(state.treeNotes[0].id).toBe(id);
    expect(state.activeNoteId).toBe(id);
    expect(state.activeNote).toBeDefined();
  });
});

describe("notesStore.saveActive（乐观更新 + 派生字段重算）", () => {
  it("保存 content 后重算 title/wordCount/excerpt/updatedAt", async () => {
    await useNotesStore.getState().createNote();

    await useNotesStore.getState().saveActive({ content: "# 新标题\n\n这是正文内容" });

    const state = useNotesStore.getState();
    expect(state.activeNote!.content).toBe("# 新标题\n\n这是正文内容");
    expect(state.activeNote!.title).toBe("新标题"); // ★ deriveTitle 重算
    expect(state.activeNote!.wordCount).toBeGreaterThan(0); // ★ countWords 重算
    expect(state.activeNote!.excerpt).toBeTruthy(); // ★ makeExcerpt 重算
    expect(state.activeNote!.updatedAt).toBeGreaterThan(0);
  });

  it("乐观更新笔记树对应项（侧栏实时反映标题）", async () => {
    const id = await useNotesStore.getState().createNote();
    const oldRow = useNotesStore.getState().treeNotes[0];

    await useNotesStore.getState().saveActive({ title: "改了标题" });

    const newRow = useNotesStore.getState().treeNotes[0];
    expect(newRow.id).toBe(id);
    expect(newRow.title).toBe("改了标题"); // ★ 树投影也更新了
    expect(newRow).not.toBe(oldRow); // 对象引用变了（乐观替换）
  });

  it("显式给 title 则用之，否则 deriveTitle 回填", async () => {
    await useNotesStore.getState().createNote();

    // 不显式给 title：从 content 派生
    await useNotesStore.getState().saveActive({ content: "# 自动派生" });
    expect(useNotesStore.getState().activeNote!.title).toBe("自动派生");

    // 显式给 title：用之（支持将来重命名）
    await useNotesStore.getState().saveActive({ title: "手动改名" });
    expect(useNotesStore.getState().activeNote!.title).toBe("手动改名");
  });

  it("attachmentIds 从 content 反填（提取 clawclip://blob/<id>）", async () => {
    await useNotesStore.getState().createNote();

    const content = "![图](clawclip://blob/abc-123)\n\n正文\n\n![](clawclip://blob/def-456)";
    await useNotesStore.getState().saveActive({ content });

    const ids = useNotesStore.getState().activeNote!.attachmentIds;
    expect(ids).toEqual(expect.arrayContaining(["abc-123", "def-456"]));
    expect(ids).toHaveLength(2);
  });
});

describe("notesStore.saveNote（切笔记不串写）", () => {
  it("显式 id 保存只写入该笔记，即使 activeNote 已切到别的笔记", async () => {
    const a = await useNotesStore.getState().createNote();
    await useNotesStore.getState().saveNote(a, { content: "# A\n\n内容 A" });

    const b = await useNotesStore.getState().createNote(); // activeNote 切到 b
    await useNotesStore.getState().saveNote(b, { content: "# B\n\n内容 B" });

    // 模拟 a 的延迟保存：activeNote 是 b，但必须落到 a
    await useNotesStore.getState().saveNote(a, { content: "# A2\n\n追加 A" });

    await useNotesStore.getState().openNote(a);
    expect(useNotesStore.getState().activeNote!.content).toContain("追加 A");
    await useNotesStore.getState().openNote(b);
    expect(useNotesStore.getState().activeNote!.content).toBe("# B\n\n内容 B");
  });
});

describe("notesStore.loadFolders（文件夹不可嵌套）", () => {
  it("历史嵌套文件夹在加载时提升为根级并落库", async () => {
    const parent = await datasource.upsertFolder(emptyFolder("父", null));
    const child = await datasource.upsertFolder(emptyFolder("子", parent.id));

    await useNotesStore.getState().loadFolders();

    expect(useNotesStore.getState().folders.find((f) => f.id === child.id)?.parentId).toBeNull();
    const persisted = (await datasource.listFolders()).find((f) => f.id === child.id);
    expect(persisted?.parentId).toBeNull();
    // 旧数据没有 order：加载时补齐连续序号
    expect(useNotesStore.getState().folders.map((f) => f.order)).toEqual([0, 1]);
  });
});

describe("notesStore 文件夹手动排序", () => {
  it("createFolder 按创建顺序追加 order，不按名称插入", async () => {
    await useNotesStore.getState().createFolder("乙");
    await useNotesStore.getState().createFolder("甲");

    const folders = useNotesStore.getState().folders;
    expect(folders.map((f) => f.name)).toEqual(["乙", "甲"]);
    expect(folders.map((f) => f.order)).toEqual([0, 1]);
  });

  it("reorderFolders 调整顺序并持久化", async () => {
    const a = await useNotesStore.getState().createFolder("甲");
    await useNotesStore.getState().createFolder("乙");
    const c = await useNotesStore.getState().createFolder("丙");

    await useNotesStore.getState().reorderFolders(c, a, false); // 丙 放到 甲 之前

    expect(useNotesStore.getState().folders.map((f) => f.name)).toEqual(["丙", "甲", "乙"]);
    const persisted = await datasource.listFolders();
    expect(persisted.map((f) => f.name)).toEqual(["丙", "甲", "乙"]);
  });
});

describe("notesStore.revision（供侧栏统计刷新）", () => {
  it("创建 / 真实编辑 / 删除都会递增", async () => {
    const id = await useNotesStore.getState().createNote();
    const afterCreate = useNotesStore.getState().revision;
    expect(afterCreate).toBeGreaterThan(0);

    await useNotesStore.getState().saveNote(id, { content: "# 改动" });
    const afterSave = useNotesStore.getState().revision;
    expect(afterSave).toBeGreaterThan(afterCreate);

    await useNotesStore.getState().saveNote(id, { content: "# 改动" }); // 无变化
    expect(useNotesStore.getState().revision).toBe(afterSave);

    await useNotesStore.getState().remove(id);
    expect(useNotesStore.getState().revision).toBeGreaterThan(afterSave);
  });
});

describe("notesStore.saveNote（真实修改才刷新 updatedAt）", () => {
  const rowOf = (id: string) =>
    useNotesStore.getState().treeNotes.find((n) => n.id === id)!;

  it("内容相同的保存不刷新 updatedAt（打开/关闭不算修改）", async () => {
    const id = await useNotesStore.getState().createNote();
    await useNotesStore.getState().saveNote(id, { content: "# 标题\n\n正文" });
    const before = rowOf(id).updatedAt;

    await new Promise((r) => setTimeout(r, 10));
    await useNotesStore.getState().saveNote(id, { content: "# 标题\n\n正文" });

    expect(rowOf(id).updatedAt).toBe(before);
  });

  it("内容真实变化时刷新 updatedAt", async () => {
    const id = await useNotesStore.getState().createNote();
    await useNotesStore.getState().saveNote(id, { content: "# 标题\n\n正文" });
    const before = rowOf(id).updatedAt;

    await new Promise((r) => setTimeout(r, 10));
    await useNotesStore.getState().saveNote(id, { content: "# 标题\n\n正文改了" });

    expect(rowOf(id).updatedAt).toBeGreaterThan(before);
  });

  it("无改动的保存不会把手动标题派生回去", async () => {
    const id = await useNotesStore.getState().createNote();
    await useNotesStore
      .getState()
      .saveNote(id, { content: "# 正文标题", title: "手动标题" });
    const before = rowOf(id).updatedAt;

    await useNotesStore.getState().saveNote(id, { content: "# 正文标题" });

    expect(rowOf(id).title).toBe("手动标题");
    expect(rowOf(id).updatedAt).toBe(before);
  });

  it("openNote 不刷新 updatedAt", async () => {
    const id = await useNotesStore.getState().createNote();
    await useNotesStore.getState().saveNote(id, { content: "# 打开测试" });
    const before = rowOf(id).updatedAt;

    await new Promise((r) => setTimeout(r, 10));
    useNotesStore.getState().closeNote();
    await useNotesStore.getState().openNote(id);

    expect(rowOf(id).updatedAt).toBe(before);
  });
});

describe("notesStore.loadTree", () => {
  it("拉取全部笔记投影", async () => {
    await useNotesStore.getState().createNote();
    await useNotesStore.getState().createNote();
    useNotesStore.setState({ treeNotes: [] });

    await useNotesStore.getState().loadTree();

    expect(useNotesStore.getState().treeNotes).toHaveLength(2);
  });
});

describe("notesStore.remove（乐观删除）", () => {
  it("乐观从笔记树移除，并清空当前编辑态", async () => {
    const id = await useNotesStore.getState().createNote();
    expect(useNotesStore.getState().treeNotes).toHaveLength(1);

    await useNotesStore.getState().remove(id);

    expect(useNotesStore.getState().treeNotes).toHaveLength(0); // ★ 乐观移除
    expect(useNotesStore.getState().activeNoteId).toBeNull();
  });
});

describe("notesStore.openNote / closeNote", () => {
  it("openNote 取完整 content（不 hydrate，保持 clawclip:// 真相源）", async () => {
    const id = await useNotesStore.getState().createNote();
    await useNotesStore.getState().saveActive({ content: "带附件 clawclip://blob/test-id" });

    // 关闭再重开
    useNotesStore.getState().closeNote();
    expect(useNotesStore.getState().activeNote).toBeNull();

    await useNotesStore.getState().openNote(id);
    // ★ content 保持 clawclip:// 形式（hydrate 是编辑器桥接层 S4 的职责）
    expect(useNotesStore.getState().activeNote!.content).toContain("clawclip://blob/test-id");
  });
});

describe("notesStore.exportBackup / reset", () => {
  it("exportBackup 返回完整 payload", async () => {
    await useNotesStore.getState().createNote();

    const payload = await useNotesStore.getState().exportBackup();

    expect(payload.schemaVersion).toBe(2);
    expect(payload.notes.length).toBeGreaterThan(0);
    expect(payload.exportedAt).toBeGreaterThan(0);
  });

  it("reset 清空全部状态", async () => {
    await useNotesStore.getState().createNote();
    expect(useNotesStore.getState().treeNotes).toHaveLength(1);

    await useNotesStore.getState().reset();

    expect(useNotesStore.getState().treeNotes).toHaveLength(0);
    expect(useNotesStore.getState().activeNote).toBeNull();
  });
});
