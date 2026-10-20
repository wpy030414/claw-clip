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
 * - **title 跟随正文派生**：saveNote/saveActive 时若 patch 未显式给 title，则 deriveTitle(content) 重算
 *   （Typora/Obsidian 式「标题=首个 H1」，单一真相源）；显式给 title 则用之（支持将来重命名）。
 *   front matter 的 `title` 优先于 H1，但 patch 里的显式 title 仍代表用户动作，优先级最高。
 * - **tags 由 front matter 投影**：`tags` 键存在时以正文声明为准（含显式 `tags: []`）；
 *   没有 front matter 时保留库里的值，为将来的手动标签 UI 留路。
 * - **attachmentIds 从 content 反填**：保存时正则提取所有 clawclip://blob/<id>，保证与正文一致，
 *   附件引用计数与导出打包才准确。front matter 里的附件引用同样计入（如封面图）。
 */
import { create } from "zustand";
import { datasource } from "@/data/datasource";
import { extractBlobRefIds, releaseBlobUrls } from "@/data/blobStore";
import { emptyNote, toSummary } from "@/types/note";
import type { Note, NoteSummary } from "@/types/note";
import { emptyFolder } from "@/types/folder";
import type { Folder } from "@/types/folder";
import type { BackupPayload } from "@/types/backup";
import { parseFrontMatter } from "@/utils/frontMatter";
import { countWords, deriveTitle, makeExcerpt } from "@/utils/markdown";

/**
 * 已打开笔记的内存缓存（id → Note）。
 *
 * 作用：布局切换/来回切笔记时，openNote 优先读内存最新内容，避免
 * 「卸载时异步 flush 尚未落库 → 新实例读 IDB 读到旧值」的竞态丢字。
 * 刷新页面后缓存为空，仍从 IndexedDB 读。
 */
const noteCache = new Map<string, Note>();

/**
 * 在途写库 Promise。
 *
 * 导入/清空前必须 drain：否则 700ms 防抖保存可能落在 clear 之后，
 * 把刚清掉的笔记又写回来（IDB 事务按创建顺序执行）。
 */
const pendingWrites = new Set<Promise<unknown>>();

function trackWrite<T>(promise: Promise<T>): Promise<T> {
  const tracked = promise.finally(() => {
    pendingWrites.delete(tracked);
  });
  pendingWrites.add(tracked);
  return tracked;
}

async function drainWrites(): Promise<void> {
  while (pendingWrites.size > 0) {
    await Promise.allSettled(pendingWrites);
  }
}

/**
 * 由正文 front matter 投影 tags。
 *
 * - patch 显式给 tags：以 patch 为准（调用方意图最高）；
 * - 正文有 `tags` 键：以正文为准（含 `tags: []` 的显式清空）；
 * - 旧正文有 `tags` 键、新正文删掉了它：清空（声明被移除）；
 * - 两侧都没有该键：保留库里的值，为将来的手动标签 UI 留路。
 */
function projectTags(
  patchTags: string[] | undefined,
  content: string,
  previousContent: string,
  contentChanged: boolean,
  currentTags: string[],
): string[] {
  if (patchTags !== undefined) return patchTags;
  if (!contentChanged) return currentTags;

  const next = parseFrontMatter(content);
  if (next.present && next.hasTags) return next.tags;

  const previous = parseFrontMatter(previousContent);
  if (previous.present && previous.hasTags) return [];

  return currentTags;
}

interface NotesState {
  activeNoteId: string | null;
  activeNote: Note | null;
  /** 文件夹树（扁平存储，UI 组树）。 */
  folders: Folder[];
  /** 侧栏笔记树的全量轻量投影。 */
  treeNotes: NoteSummary[];
  /** 数据修订号：CRUD 后递增，供侧栏统计等派生视图刷新。 */
  revision: number;
  /** 数据代际：清空/覆盖导入后 +1，旧编辑器会话的延迟保存据此丢弃。 */
  dataEpoch: number;

  /** 加载侧栏笔记树（全部笔记，按标题排序；CRUD 时增量同步）。 */
  loadTree: () => Promise<void>;
  /** 打开笔记（取完整 content，不 hydrate）。 */
  openNote: (id: string) => Promise<void>;
  /** 关闭当前编辑态。 */
  closeNote: () => void;
  /** 新建空笔记并落库（folderId 指定归属文件夹），返回新 id。 */
  createNote: (folderId?: string | null) => Promise<string>;
  /**
   * 按 id 保存笔记；只有真实变更才重算派生字段、刷新 updatedAt 并落库。
   * 传入 epoch 时，若数据代际已变化（导入/清空），这次保存直接丢弃。
   */
  saveNote: (id: string, patch: Partial<Note>, epoch?: number) => Promise<void>;
  /** 保存当前活动笔记（= saveNote(activeNoteId, patch)）。 */
  saveActive: (patch: Partial<Note>) => Promise<void>;
  /** 删除笔记（乐观移除 + 按引用计数释放附件）。 */
  remove: (id: string) => Promise<void>;
  /**
   * 导入备份：`merge` 较新者胜；`replace` 原子覆盖（清空后写入）。
   * 会递增 dataEpoch、drain 在途写入，并重载文件夹/笔记树。
   */
  importBackup: (payload: BackupPayload, mode?: "merge" | "replace") => Promise<void>;
  /** 导出全库，返回 payload（调用方负责下载）。 */
  exportBackup: () => Promise<BackupPayload>;
  /** 清空全部数据。 */
  reset: () => Promise<void>;
  /**
   * 批量改写正文（如图床迁移）前调用：换代际并等待在途写入。
   * 调用方需先把活动编辑器的实时内容落库（见 `flushActiveEditor`）。
   */
  beginBulkMutation: () => Promise<void>;
  /** 批量改写后调用：清缓存、换代际、重载树与当前笔记，让编辑器重挂载。 */
  finishBulkMutation: () => Promise<void>;

  // —— 文件夹 ——
  loadFolders: () => Promise<void>;
  /** 文件夹不支持嵌套：始终在根部创建。 */
  createFolder: (name: string) => Promise<string>;
  renameFolder: (id: string, name: string) => Promise<void>;
  /** 拖拽排序：把 sourceId 放到 targetId 之前/之后，并持久化连续 order。 */
  reorderFolders: (sourceId: string, targetId: string, after: boolean) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  activeNoteId: null,
  activeNote: null,
  folders: [],
  treeNotes: [],
  revision: 0,
  dataEpoch: 0,

  async loadTree() {
    const notes = await datasource.listAllNotes();
    set({ treeNotes: notes });
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
    await trackWrite(datasource.upsertNote(note));
    noteCache.set(note.id, note);
    set({
      treeNotes: [toSummary(note), ...get().treeNotes],
      activeNoteId: note.id,
      activeNote: note,
      revision: get().revision + 1,
    });
    return note.id;
  },

  async saveNote(id, patch, epoch) {
    // 数据代际已变化（刚导入/清空）：旧会话的防抖/卸载保存一律丢弃
    if (epoch !== undefined && epoch !== get().dataEpoch) return;
    // ★ 必须按 id 取源数据：切笔记后 activeNote 已指向别的笔记，
    //   旧会话的延迟保存若直接写 activeNote 会把 A 的正文串到 B。
    const cur = noteCache.get(id) ?? (await datasource.getNote(id));
    if (!cur) return;

    const content = patch.content ?? cur.content;
    const contentChanged = content !== cur.content;
    // 只有正文变化时才重新派生标题；否则保留原标题，避免「打开再关闭」改动手动标题
    const title =
      patch.title !== undefined ? patch.title : contentChanged ? deriveTitle(content) : cur.title;
    const tags = projectTags(patch.tags, content, cur.content, contentChanged, cur.tags);
    const folderId = patch.folderId !== undefined ? patch.folderId : cur.folderId;
    const pinned = patch.pinned !== undefined ? patch.pinned : cur.pinned;

    // ★ 打开/关闭笔记会触发一次 content 相同的保存；必须识别为「没有真实改动」，
    //   否则每次打开都会刷新 updatedAt，侧栏按修改时间排序就会被「浏览」打乱。
    const changed =
      content !== cur.content ||
      title !== cur.title ||
      tags.length !== cur.tags.length ||
      tags.some((t, i) => t !== cur.tags[i]) ||
      (folderId ?? null) !== (cur.folderId ?? null) ||
      (pinned ?? false) !== (cur.pinned ?? false);
    if (!changed) return;

    const next: Note = {
      ...cur,
      ...patch,
      content,
      title,
      tags,
      folderId,
      pinned,
      // 派生字段只在真实改动时重算
      wordCount: countWords(content),
      excerpt: makeExcerpt(content),
      attachmentIds: extractBlobRefIds(content),
      updatedAt: Date.now(),
    };

    // 乐观更新内存态
    set({
      activeNote: get().activeNote?.id === id ? next : get().activeNote,
      treeNotes: get().treeNotes.map((s) => (s.id === id ? toSummary(next) : s)),
      revision: get().revision + 1,
    });

    noteCache.set(next.id, next);
    // 落库（登记为在途写，导入/清空会先等它完成）
    await trackWrite(datasource.upsertNote(next));
  },

  async saveActive(patch) {
    const id = get().activeNoteId ?? get().activeNote?.id;
    if (!id) return;
    await get().saveNote(id, patch);
  },

  async remove(id) {
    noteCache.delete(id);
    // 乐观：先从树里移除
    set({
      treeNotes: get().treeNotes.filter((s) => s.id !== id),
      activeNoteId: get().activeNoteId === id ? null : get().activeNoteId,
      activeNote: get().activeNote?.id === id ? null : get().activeNote,
      revision: get().revision + 1,
    });

    await trackWrite(datasource.deleteNote(id));
  },

  async importBackup(payload, mode = "merge") {
    // 先换代际并等旧写入落库，避免清空/覆盖后又被在途保存写回来
    const nextEpoch = get().dataEpoch + 1;
    set({ dataEpoch: nextEpoch });
    await drainWrites();

    if (mode === "replace") await datasource.replaceAll(payload);
    else await datasource.mergeAll(payload);

    noteCache.clear();
    releaseBlobUrls();
    await get().loadFolders();
    await get().loadTree();

    // 当前打开的笔记可能已被覆盖：能命中就刷新内容，不能命中就清空
    const activeId = get().activeNoteId;
    if (activeId) {
      const stillExists = get().treeNotes.some((n) => n.id === activeId);
      if (!stillExists) {
        set({ activeNoteId: null, activeNote: null });
      } else {
        const fresh = await datasource.getNote(activeId);
        if (fresh) {
          noteCache.set(activeId, fresh);
          set({ activeNote: fresh });
        }
      }
    }
    set({ revision: get().revision + 1 });
  },

  async exportBackup() {
    return datasource.exportAll();
  },

  async reset() {
    // 与 importBackup 同理：先换代际 + drain，防止在途保存把数据写回来
    const nextEpoch = get().dataEpoch + 1;
    set({ dataEpoch: nextEpoch });
    await drainWrites();

    await datasource.clear();
    noteCache.clear();
    releaseBlobUrls();
    set({
      treeNotes: [],
      activeNoteId: null,
      activeNote: null,
      folders: [],
      revision: get().revision + 1,
    });
  },

  async beginBulkMutation() {
    // 换代际后，旧编辑器会话的防抖/卸载保存会被丢弃，避免覆盖迁移结果
    set({ dataEpoch: get().dataEpoch + 1 });
    await drainWrites();
  },

  async finishBulkMutation() {
    noteCache.clear();
    releaseBlobUrls();
    // 再换一次代际：编辑器按新代际重挂载，读取迁移后的正文
    set({ dataEpoch: get().dataEpoch + 1 });
    await get().loadFolders();
    await get().loadTree();

    const activeId = get().activeNoteId;
    if (activeId) {
      const stillExists = get().treeNotes.some((n) => n.id === activeId);
      if (!stillExists) {
        set({ activeNoteId: null, activeNote: null });
      } else {
        const fresh = await datasource.getNote(activeId);
        if (fresh) {
          noteCache.set(activeId, fresh);
          set({ activeNote: fresh });
        }
      }
    }
    set({ revision: get().revision + 1 });
  },

  // —— 文件夹 ——

  async loadFolders() {
    const folders = await datasource.listFolders();
    const changed = new Set<string>();

    // ★ 文件夹不支持嵌套：历史数据里的子文件夹统一提升为根级，
    //   避免出现「界面上平铺、删除时却级联删掉看不见的子文件夹」。
    let next = folders.map((f) => {
      if ((f.parentId ?? null) === null) return f;
      changed.add(f.id);
      return { ...f, parentId: null };
    });

    // 手动排序：旧数据可能没有 order；按现有 order / 名称兜底排序后压成连续序号
    next.sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
    );
    next = next.map((f, i) => {
      if (f.order === i) return f;
      changed.add(f.id);
      return { ...f, order: i };
    });

    if (changed.size > 0) {
      await Promise.all(
        next.filter((f) => changed.has(f.id)).map((f) => datasource.upsertFolder(f)),
      );
    }
    set({ folders: next, revision: get().revision + (changed.size > 0 ? 1 : 0) });
  },

  async createFolder(name) {
    // 新文件夹追加到末尾（手动排序，不按名称插入）
    const order = get().folders.reduce((max, f) => Math.max(max, f.order ?? -1), -1) + 1;
    const folder = await datasource.upsertFolder({ ...emptyFolder(name, null), order });
    set({ folders: [...get().folders, folder], revision: get().revision + 1 });
    return folder.id;
  },

  async reorderFolders(sourceId, targetId, after) {
    if (sourceId === targetId) return;
    const ordered = [...get().folders].sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
    );
    const from = ordered.findIndex((f) => f.id === sourceId);
    if (from < 0) return;
    const [moved] = ordered.splice(from, 1);
    const targetIndex = ordered.findIndex((f) => f.id === targetId);
    if (targetIndex < 0) return;
    ordered.splice(after ? targetIndex + 1 : targetIndex, 0, moved);

    const previous = new Map(get().folders.map((f) => [f.id, f.order]));
    const next = ordered.map((f, i) => (f.order === i ? f : { ...f, order: i }));
    set({ folders: next, revision: get().revision + 1 });
    await Promise.all(
      next.filter((f) => previous.get(f.id) !== f.order).map((f) => datasource.upsertFolder(f)),
    );
  },

  async renameFolder(id, name) {
    const folder = get().folders.find((f) => f.id === id);
    if (!folder) return;
    const next = await datasource.upsertFolder({ ...folder, name: name.trim() || folder.name });
    set({
      folders: get().folders.map((f) => (f.id === id ? next : f)),
      revision: get().revision + 1,
    });
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
      .treeNotes.filter((s) => s.folderId && doomed.has(s.folderId))
      .map((s) => s.id);
    for (const nid of removedNoteIds) noteCache.delete(nid);

    set({
      folders: all.filter((f) => !doomed.has(f.id)),
      treeNotes: get().treeNotes.filter((s) => !(s.folderId && doomed.has(s.folderId))),
      revision: get().revision + 1,
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
