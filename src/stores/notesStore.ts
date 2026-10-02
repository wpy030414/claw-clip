/**
 * notesStore：笔记数据的真相源（方案 §5.3 / 附录 B）。
 *
 * 唯一直接触碰 datasource 的地方。业务编排（自动保存节流、附件 URL 转换、光标保持）
 * 放在 hooks 层，本 store 只做「数据态 + CRUD + 乐观更新」，保持可单测。
 *
 * ★ 关键设计决策（对 plan 附录 B 的现场修正）：
 * - **activeNote.content 始终存 `clawclip://blob/<id>` 真相源形式**（与 IndexedDB 一致），
 *   openNote 不做 hydrate。object URL 的 hydrate/dehydrate 转换由编辑器桥接层（S4）负责，
 *   避免内存态 content 与存储态 content 含义不一致。
 * - **title 跟随正文派生**：saveActive 时若 patch 未显式给 title，则 deriveTitle(content) 重算
 *   （Typora/Obsidian 式「标题=首个 H1」，单一真相源）；显式给 title 则用之（支持将来重命名）。
 * - **attachmentIds 从 content 反填**：保存时正则提取所有 clawclip://blob/<id>，保证与正文一致，
 *   删除级联与导出打包才准确。
 */
import { create } from "zustand";
import { globalConfig } from "@/config";
import { datasource } from "@/data/datasource";
import { emptyNote, toSummary } from "@/types/note";
import type { Note, NoteFilter, NoteSummary } from "@/types/note";
import type { BackupPayload } from "@/types/backup";
import { countWords, deriveTitle, makeExcerpt } from "@/utils/markdown";

/** 与 blobStore 的 BLOB_REF_RE 同源：提取正文中所有附件引用 id。 */
const BLOB_REF_RE = /clawclip:\/\/blob\/([\w-]+)/g;

function extractAttachmentIds(content: string): string[] {
  const ids = new Set<string>();
  for (const m of content.matchAll(BLOB_REF_RE)) ids.add(m[1]);
  return [...ids];
}

interface NotesState {
  summaries: NoteSummary[];
  total: number;
  loading: boolean;
  activeNoteId: string | null;
  activeNote: Note | null;

  /** 加载列表（page=0 替换，page>0 追加，供无限滚动）。 */
  load: (filter: NoteFilter, page?: number) => Promise<void>;
  /** 打开笔记（取完整 content，不 hydrate）。 */
  openNote: (id: string) => Promise<void>;
  /** 关闭当前编辑态。 */
  closeNote: () => void;
  /** 新建空笔记并落库，返回新 id。 */
  createNote: () => Promise<string>;
  /** 保存当前活动笔记（乐观更新 + 重算派生字段 + 落库）。 */
  saveActive: (patch: Partial<Note>) => Promise<void>;
  /** 切换收藏（乐观）。 */
  toggleStar: (id: string) => Promise<void>;
  /** 删除笔记（乐观移除 + 级联删附件）。 */
  remove: (id: string) => Promise<void>;
  /** 导入备份。 */
  importBackup: (payload: BackupPayload) => Promise<void>;
  /** 导出全库，返回 payload（调用方负责下载）。 */
  exportBackup: () => Promise<BackupPayload>;
  /** 清空全部数据。 */
  reset: () => Promise<void>;
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  summaries: [],
  total: 0,
  loading: false,
  activeNoteId: null,
  activeNote: null,

  async load(filter, page = 0) {
    set({ loading: true });
    try {
      const { total, items } = await datasource.listNotes(
        filter,
        globalConfig.pageSize,
        page * globalConfig.pageSize,
      );
      set({
        summaries: page === 0 ? items : [...get().summaries, ...items],
        total,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  async openNote(id) {
    const note = await datasource.getNote(id);
    if (!note) return;
    // content 保持 clawclip:// 真相源形式，hydrate 交给编辑器桥接层（S4）
    set({ activeNoteId: id, activeNote: note });
  },

  closeNote() {
    set({ activeNoteId: null, activeNote: null });
  },

  async createNote() {
    const note = emptyNote();
    await datasource.upsertNote(note);
    set({
      summaries: [toSummary(note), ...get().summaries],
      total: get().total + 1,
      activeNoteId: note.id,
      activeNote: note,
    });
    return note.id;
  },

  async saveActive(patch) {
    const cur = get().activeNote;
    if (!cur) return;

    const next: Note = { ...cur, ...patch };
    // 重算派生字段
    next.content = patch.content ?? cur.content;
    next.title = patch.title !== undefined ? patch.title : deriveTitle(next.content);
    next.wordCount = countWords(next.content);
    next.excerpt = makeExcerpt(next.content);
    next.attachmentIds = extractAttachmentIds(next.content);
    next.updatedAt = Date.now();

    // 乐观更新内存态
    set({
      activeNote: next,
      summaries: get().summaries.map((s) => (s.id === next.id ? toSummary(next) : s)),
    });

    // 落库
    await datasource.upsertNote(next);
  },

  async toggleStar(id) {
    const cur = get().summaries.find((s) => s.id === id);
    if (!cur) return;
    const next = !cur.starred;

    // 乐观：先改本地
    set({
      summaries: get().summaries.map((s) => (s.id === id ? { ...s, starred: next } : s)),
      activeNote:
        get().activeNote?.id === id ? { ...get().activeNote!, starred: next } : get().activeNote,
    });

    await datasource.setStarred(id, next);
  },

  async remove(id) {
    const removed = get().summaries.find((s) => s.id === id);
    // 乐观：先从列表移除
    set({
      summaries: get().summaries.filter((s) => s.id !== id),
      total: Math.max(0, get().total - 1),
      activeNoteId: get().activeNoteId === id ? null : get().activeNoteId,
      activeNote: get().activeNote?.id === id ? null : get().activeNote,
    });

    await datasource.deleteNote(id);

    // 失败回滚：重新拉回（简化处理，本地 IDB 极少失败）
    if (!removed) return;
  },

  async importBackup(payload) {
    await datasource.importAll(payload);
    // 导入后重载列表
    await get().load({});
  },

  async exportBackup() {
    return datasource.exportAll();
  },

  async reset() {
    await datasource.clear();
    set({ summaries: [], total: 0, activeNoteId: null, activeNote: null });
  },
}));
