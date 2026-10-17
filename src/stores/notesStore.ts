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
import { emptyFolder } from "@/types/folder";
import type { Folder } from "@/types/folder";
import type { BackupPayload } from "@/types/backup";
import { countWords, deriveTitle, makeExcerpt } from "@/utils/markdown";

/** 与 blobStore 的 BLOB_REF_RE 同源：提取正文中所有附件引用 id。 */
const BLOB_REF_RE = /clawclip:\/\/blob\/([\w-]+)/g;

/**
 * 已打开笔记的内存缓存（id → Note）。
 *
 * 作用：布局切换/来回切笔记时，openNote 优先读内存最新内容，避免
 * 「卸载时异步 flush 尚未落库 → 新实例读 IDB 读到旧值」的竞态丢字。
 * 刷新页面后缓存为空，仍从 IndexedDB 读。
 */
const noteCache = new Map<string, Note>();

/**
 * 列表请求序号：过滤条件快速切换时，先发出的查询可能后返回。
 * 只允许最新一次请求写回 summaries，避免旧结果覆盖新筛选。
 */
let loadSeq = 0;

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
  /** 文件夹树（扁平存储，UI 组树）。 */
  folders: Folder[];

  /** 加载列表（page=0 替换，page>0 追加，供无限滚动）。 */
  load: (filter: NoteFilter, page?: number) => Promise<void>;
  /** 打开笔记（取完整 content，不 hydrate）。 */
  openNote: (id: string) => Promise<void>;
  /** 关闭当前编辑态。 */
  closeNote: () => void;
  /** 新建空笔记并落库（folderId 指定归属文件夹），返回新 id。 */
  createNote: (folderId?: string | null) => Promise<string>;
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

  // —— 文件夹 ——
  loadFolders: () => Promise<void>;
  createFolder: (name: string, parentId?: string | null) => Promise<string>;
  renameFolder: (id: string, name: string) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  summaries: [],
  total: 0,
  loading: false,
  activeNoteId: null,
  activeNote: null,
  folders: [],

  async load(filter, page = 0) {
    const seq = ++loadSeq;
    set({ loading: true });
    try {
      const { total, items } = await datasource.listNotes(
        filter,
        globalConfig.pageSize,
        page * globalConfig.pageSize,
      );
      if (seq !== loadSeq) return; // 过期响应：过滤条件已变化，丢弃
      set({
        summaries: page === 0 ? items : [...get().summaries, ...items],
        total,
        loading: false,
      });
    } catch {
      if (seq === loadSeq) set({ loading: false });
    }
  },

  async openNote(id) {
    const cached = noteCache.get(id);
    if (cached) {
      set({ activeNoteId: id, activeNote: cached });
      return;
    }
    const note = await datasource.getNote(id);
    if (!note) return;
    noteCache.set(id, note);
    // content 保持 clawclip:// 真相源形式，hydrate 交给编辑器桥接层（S4）
    set({ activeNoteId: id, activeNote: note });
  },

  closeNote() {
    set({ activeNoteId: null, activeNote: null });
  },

  async createNote(folderId = null) {
    const note = emptyNote(Date.now(), folderId);
    await datasource.upsertNote(note);
    noteCache.set(note.id, note);
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

    noteCache.set(next.id, next);
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
    noteCache.delete(id);
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
    noteCache.clear();
    // 导入后重载文件夹与列表
    await get().loadFolders();
    await get().load({});
  },

  async exportBackup() {
    return datasource.exportAll();
  },

  async reset() {
    await datasource.clear();
    noteCache.clear();
    set({ summaries: [], total: 0, activeNoteId: null, activeNote: null, folders: [] });
  },

  // —— 文件夹 ——

  async loadFolders() {
    const folders = await datasource.listFolders();
    set({ folders });
  },

  async createFolder(name, parentId = null) {
    const folder = await datasource.upsertFolder(emptyFolder(name, parentId));
    set({ folders: [...get().folders, folder].sort((a, b) => a.name.localeCompare(b.name)) });
    return folder.id;
  },

  async renameFolder(id, name) {
    const folder = get().folders.find((f) => f.id === id);
    if (!folder) return;
    const next = await datasource.upsertFolder({ ...folder, name: name.trim() || folder.name });
    set({ folders: get().folders.map((f) => (f.id === id ? next : f)) });
  },

  async removeFolder(id) {
    // 收集子孙文件夹 id（与数据层级联语义保持一致，用于同步内存态）
    const all = get().folders;
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of all) {
        if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) {
          doomed.add(f.id);
          grew = true;
        }
      }
    }
    await datasource.deleteFolder(id);

    const removedNoteIds = get()
      .summaries.filter((s) => s.folderId && doomed.has(s.folderId))
      .map((s) => s.id);
    for (const nid of removedNoteIds) noteCache.delete(nid);

    set({
      folders: all.filter((f) => !doomed.has(f.id)),
      summaries: get().summaries.filter((s) => !(s.folderId && doomed.has(s.folderId))),
      activeNote:
        get().activeNote?.folderId && doomed.has(get().activeNote!.folderId!)
          ? null
          : get().activeNote,
      activeNoteId:
        get().activeNote?.folderId && doomed.has(get().activeNote!.folderId!)
          ? null
          : get().activeNoteId,
    });
  },
}));
