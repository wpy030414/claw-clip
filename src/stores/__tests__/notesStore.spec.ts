/**
 * notesStore 单测：数据态 + 乐观更新 + 派生字段重算。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useNotesStore } from "@/stores/notesStore";

beforeEach(() => {
  // 重置 store 状态
  useNotesStore.setState({
    summaries: [],
    total: 0,
    loading: false,
    activeNoteId: null,
    activeNote: null,
  });
});

describe("notesStore.createNote", () => {
  it("创建空笔记并乐观插入 summaries 头部", async () => {
    const id = await useNotesStore.getState().createNote();
    expect(id).toBeTruthy();

    const state = useNotesStore.getState();
    expect(state.summaries).toHaveLength(1);
    expect(state.summaries[0].id).toBe(id);
    expect(state.total).toBe(1);
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

  it("乐观更新 summaries 对应项（列表 UI 实时反映）", async () => {
    const id = await useNotesStore.getState().createNote();
    const oldSummary = useNotesStore.getState().summaries[0];

    await useNotesStore.getState().saveActive({ title: "改了标题" });

    const newSummary = useNotesStore.getState().summaries[0];
    expect(newSummary.id).toBe(id);
    expect(newSummary.title).toBe("改了标题"); // ★ 列表投影也更新了
    expect(newSummary).not.toBe(oldSummary); // 对象引用变了（乐观替换）
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

describe("notesStore.toggleStar（乐观）", () => {
  it("乐观切换收藏，summaries 和 activeNote 同步更新", async () => {
    const id = await useNotesStore.getState().createNote();
    expect(useNotesStore.getState().summaries[0].starred).toBe(false);

    await useNotesStore.getState().toggleStar(id);

    expect(useNotesStore.getState().summaries[0].starred).toBe(true); // ★ 乐观
    expect(useNotesStore.getState().activeNote!.starred).toBe(true);

    await useNotesStore.getState().toggleStar(id);
    expect(useNotesStore.getState().summaries[0].starred).toBe(false);
  });
});

describe("notesStore.remove（乐观删除）", () => {
  it("乐观从 summaries 移除，total 减一", async () => {
    const id = await useNotesStore.getState().createNote();
    expect(useNotesStore.getState().summaries).toHaveLength(1);

    await useNotesStore.getState().remove(id);

    expect(useNotesStore.getState().summaries).toHaveLength(0); // ★ 乐观移除
    expect(useNotesStore.getState().total).toBe(0);
    expect(useNotesStore.getState().activeNoteId).toBeNull(); // 当前编辑态也清了
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

describe("notesStore.load", () => {
  it("加载列表到 summaries，total 反映过滤后总数", async () => {
    await useNotesStore.getState().createNote();
    await useNotesStore.getState().createNote();

    // 清空 summaries 模拟「刷新页面后重新加载」
    useNotesStore.setState({ summaries: [], total: 0 });

    await useNotesStore.getState().load({});

    expect(useNotesStore.getState().summaries).toHaveLength(2);
    expect(useNotesStore.getState().total).toBe(2);
    expect(useNotesStore.getState().loading).toBe(false);
  });

  it("page=0 替换，page>0 追加（无限滚动）", async () => {
    // 造 3 条
    await useNotesStore.getState().createNote();
    await useNotesStore.getState().createNote();
    await useNotesStore.getState().createNote();
    useNotesStore.setState({ summaries: [], total: 0 });

    await useNotesStore.getState().load({}, 0);
    const firstBatch = useNotesStore.getState().summaries;

    await useNotesStore.getState().load({}, 1); // 第二页（追加）
    const secondBatch = useNotesStore.getState().summaries;

    // 追加后总数 >= 第一批（取决于 pageSize，此处仅验证追加逻辑不替换）
    expect(secondBatch.length).toBeGreaterThanOrEqual(firstBatch.length);
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
    expect(useNotesStore.getState().summaries).toHaveLength(1);

    await useNotesStore.getState().reset();

    expect(useNotesStore.getState().summaries).toHaveLength(0);
    expect(useNotesStore.getState().total).toBe(0);
    expect(useNotesStore.getState().activeNote).toBeNull();
  });
});
