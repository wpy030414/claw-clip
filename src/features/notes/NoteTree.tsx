/**
 * NoteTree：侧栏「文件夹 + 笔记」统一树。
 *
 * - 文件夹**不允许嵌套**：全部平铺在根级；笔记作为叶子挂在所属文件夹下，
 *   根目录笔记与文件夹同级展示（文件夹在前，笔记按更新时间倒序）。
 * - 树顶部有一行「新建」，是唯一创建入口：新建文件夹 / 新建笔记 / 上传笔记，
 *   统一在 M3E dialog 里选择。文件夹始终建在根部；笔记/上传的归属由当前展开的文件夹决定。
 * - 文件夹行单击 = 开合（图标本身表达状态），展开时选为新建位置、收起选中项时回到根目录；
 *   重命名只能通过悬停后的编辑按钮，双击名称不会触发重命名。
 * - 拖拽：文件夹拖到另一文件夹行上/下半区 → 手动排序（order 持久化）；笔记拖入文件夹，
 *   或拖到树空白处 / 底部「移到顶层」浮条 → 移出到顶层。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, JSX } from "react";
import { useNavigate } from "react-router-dom";
import { M3eDialog } from "@/components/m3e";
import { useCreateNote } from "@/hooks/useCreateNote";
import { useImportDocument } from "@/hooks/useImportDocument";
import { useNotesStore } from "@/stores/notesStore";
import { useUiStore } from "@/stores/uiStore";
import type { Folder } from "@/types/folder";
import type { NoteSummary } from "@/types/note";
import { relativeTime } from "@/utils/time";

interface Editing {
  mode: "create" | "rename";
  id?: string;
  name: string;
}

/**
 * 树行左内边距：每层缩进 16px。
 * 文件夹不再有展开箭头，笔记图标与同层文件夹图标左对齐。
 */
const indent = (depth: number) => 8 + depth * 16;
const noteIndent = (depth: number) => indent(depth);

/**
 * 树行预览：excerpt 是 stripMarkdown 后的单行文本，通常以 H1 标题开头。
 * 标题已经在上一行展示，这里把开头重复的标题剥掉，只留正文首行预览。
 */
function notePreview(note: NoteSummary): string {
  const excerpt = note.excerpt.trim();
  if (!excerpt) return "空笔记";
  const title = (note.title || "").trim();
  if (title && excerpt.startsWith(title)) {
    const rest = excerpt.slice(title.length).replace(/^[\s·:：\-—]+/, "").trim();
    return rest || "空笔记";
  }
  return excerpt;
}

export function NoteTree() {
  const navigate = useNavigate();
  const create = useCreateNote();
  const importDoc = useImportDocument();

  const folders = useNotesStore((s) => s.folders);
  const notes = useNotesStore((s) => s.treeNotes);
  const activeId = useNotesStore((s) => s.activeNoteId);
  const createFolder = useNotesStore((s) => s.createFolder);
  const renameFolder = useNotesStore((s) => s.renameFolder);
  const reorderFolders = useNotesStore((s) => s.reorderFolders);
  const removeFolder = useNotesStore((s) => s.removeFolder);
  const saveNote = useNotesStore((s) => s.saveNote);

  const currentFolderId = useUiStore((s) => s.currentFolderId);
  const setCurrentFolderId = useUiStore((s) => s.setCurrentFolderId);

  /** 折叠集合（默认全展开，存「已折叠」比存「已展开」更省心）。 */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commitLock = useRef(false);
  const cancelRef = useRef(false);

  // —— 笔记拖拽：拖进文件夹 / 拖到空白处移出 ——
  const draggingIdRef = useRef<string | null>(null);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);

  // —— 文件夹拖拽排序 ——
  const folderDragIdRef = useRef<string | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [folderDropTarget, setFolderDropTarget] = useState<{
    id: string;
    after: boolean;
  } | null>(null);

  /** 文件夹不允许嵌套：全部平铺在根级，按手动 order 排序。 */
  const sortedFolders = useMemo(
    () =>
      [...folders].sort(
        (a, b) =>
          (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
          a.name.localeCompare(b.name),
      ),
    [folders],
  );

  /** 笔记按 folderId 分组；指向已删文件夹的孤儿笔记回落到根目录。 */
  const notesByFolder = useMemo(() => {
    const folderIds = new Set(folders.map((f) => f.id));
    const map = new Map<string | null, NoteSummary[]>();
    map.set(null, []);
    for (const f of folders) map.set(f.id, []);
    for (const n of notes) {
      const key = n.folderId && folderIds.has(n.folderId) ? n.folderId : null;
      map.get(key)!.push(n);
    }
    for (const arr of map.values()) arr.sort((a, b) => b.updatedAt - a.updatedAt);
    return map;
  }, [folders, notes]);

  const draggingNote = draggingNoteId
    ? notes.find((n) => n.id === draggingNoteId)
    : undefined;
  const draggingInsideFolder =
    !!draggingNote && (draggingNote.folderId ?? null) !== null;

  const clearDrag = () => {
    draggingIdRef.current = null;
    setDraggingNoteId(null);
    setDragOverFolderId(null);
    setDragOverRoot(false);
  };

  const clearFolderDrag = () => {
    folderDragIdRef.current = null;
    setDraggingFolderId(null);
    setFolderDropTarget(null);
  };

  const startDrag = (e: DragEvent<HTMLElement>, note: NoteSummary) => {
    clearFolderDrag();
    draggingIdRef.current = note.id;
    setDraggingNoteId(note.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-clawclip-note", note.id);
    e.dataTransfer.setData("text/plain", note.id);
  };

  const startFolderDrag = (e: DragEvent<HTMLElement>, folder: Folder) => {
    clearDrag();
    folderDragIdRef.current = folder.id;
    setDraggingFolderId(folder.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-clawclip-folder", folder.id);
    e.dataTransfer.setData("text/plain", folder.id);
  };

  const handleFolderDragOver = (e: DragEvent<HTMLElement>, folder: Folder) => {
    // 拖文件夹：按指针在行的上半/下半决定插到前面还是后面
    if (folderDragIdRef.current) {
      if (folderDragIdRef.current === folder.id) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      e.dataTransfer.dropEffect = "move";
      setFolderDropTarget({ id: folder.id, after });
      setDragOverFolderId(null);
      setDragOverRoot(false);
      return;
    }

    // 拖笔记：移入文件夹
    const id = draggingIdRef.current;
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    const note = notes.find((n) => n.id === id);
    if (!note || (note.folderId ?? null) === folder.id) {
      setDragOverFolderId(null);
      e.dataTransfer.dropEffect = "none";
      return;
    }
    e.dataTransfer.dropEffect = "move";
    setDragOverFolderId(folder.id);
    setDragOverRoot(false);
  };

  const handleFolderDragLeave = (e: DragEvent<HTMLElement>, folder: Folder) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverFolderId((cur) => (cur === folder.id ? null : cur));
    setFolderDropTarget((cur) => (cur?.id === folder.id ? null : cur));
  };

  const handleFolderDrop = (e: DragEvent<HTMLElement>, folder: Folder) => {
    // 文件夹重排
    if (folderDragIdRef.current) {
      e.preventDefault();
      e.stopPropagation();
      const sourceId = folderDragIdRef.current;
      const after =
        folderDropTarget?.id === folder.id ? folderDropTarget.after : false;
      clearFolderDrag();
      if (sourceId !== folder.id) void reorderFolders(sourceId, folder.id, after);
      return;
    }

    // 笔记移入文件夹
    e.preventDefault();
    e.stopPropagation();
    const id = draggingIdRef.current;
    setDragOverFolderId(null);
    setDragOverRoot(false);
    if (!id) {
      clearDrag();
      return;
    }
    const note = notes.find((n) => n.id === id);
    if (note && (note.folderId ?? null) !== folder.id) {
      expand(folder.id);
      setCurrentFolderId(folder.id);
      void saveNote(id, { folderId: folder.id });
    }
    clearDrag();
  };

  const moveDraggedToRoot = () => {
    const id = draggingIdRef.current;
    const note = id ? notes.find((n) => n.id === id) : undefined;
    if (id && note && (note.folderId ?? null) !== null) {
      setCurrentFolderId(null);
      void saveNote(id, { folderId: null });
    }
    clearDrag();
  };

  const handleRootZoneDragOver = (e: DragEvent<HTMLElement>) => {
    if (!draggingIdRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverRoot(true);
    setDragOverFolderId(null);
  };

  const handleRootZoneDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    moveDraggedToRoot();
  };

  const handleTreeDragOver = (e: DragEvent<HTMLElement>) => {
    if (!draggingIdRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverRoot(true);
    setDragOverFolderId(null);
  };

  const handleTreeDragLeave = (e: DragEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverRoot(false);
  };

  const handleTreeDrop = (e: DragEvent<HTMLElement>) => {
    if (!draggingIdRef.current) return; // 只处理笔记拖拽，忽略外部拖入
    e.preventDefault();
    moveDraggedToRoot();
  };

  // 当前选中的文件夹被级联删除后，把新建位置回落到根目录
  useEffect(() => {
    if (currentFolderId && !folders.some((f) => f.id === currentFolderId)) {
      setCurrentFolderId(null);
    }
  }, [currentFolderId, folders, setCurrentFolderId]);

  const expand = (id: string) =>
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const startCreateFolder = () => {
    cancelRef.current = false;
    setDialogOpen(false);
    // 文件夹不支持嵌套：无论当前选中哪个文件夹，都建在根部
    setEditing({ mode: "create", name: "新建文件夹" });
  };

  const startRename = (folder: Folder) => {
    cancelRef.current = false;
    setEditing({ mode: "rename", id: folder.id, name: folder.name });
  };

  const commitEditing = async () => {
    if (!editing || commitLock.current) return;
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    commitLock.current = true;
    const current = editing;
    setEditing(null);
    try {
      const name = current.name.trim();
      if (!name) return;
      if (current.mode === "create") {
        const id = await createFolder(name);
        setCurrentFolderId(id);
      } else if (current.id) {
        await renameFolder(current.id, name);
      }
    } finally {
      commitLock.current = false;
    }
  };

  const cancelEditing = () => {
    cancelRef.current = true;
    setEditing(null);
  };

  const handleDeleteFolder = async (folder: Folder) => {
    if (
      !window.confirm(
        `删除文件夹「${folder.name}」？子文件夹及其中的笔记、附件都会被删除。`,
      )
    ) {
      return;
    }
    await removeFolder(folder.id);
    if (currentFolderId === folder.id) setCurrentFolderId(null);
  };

  /** 点击文件夹行：开合；展开时选为新建位置，收起选中项时回到根目录。 */
  const toggleFolder = (folder: Folder) => {
    const isCollapsed = collapsed.has(folder.id);
    toggleCollapsed(folder.id);
    if (isCollapsed) {
      setCurrentFolderId(folder.id);
    } else if (currentFolderId === folder.id) {
      setCurrentFolderId(null);
    }
  };

  const openNote = (note: NoteSummary) => {
    setCurrentFolderId(note.folderId ?? null);
    navigate(`/n/${note.id}`);
  };

  const handleCreateNote = () => {
    if (currentFolderId) expand(currentFolderId);
    setDialogOpen(false);
    void create();
  };

  const handleUpload = () => {
    if (currentFolderId) expand(currentFolderId);
    setDialogOpen(false);
    fileInputRef.current?.click();
  };

  const renderEditor = (depth: number) => {
    if (!editing || editing.mode !== "create") return null;
    const value = editing.name;
    return (
      <div key="editor" className="tree-row tree-row--editor" style={{ paddingLeft: noteIndent(depth) }}>
        <span className="material-symbols-outlined" aria-hidden="true">
          folder
        </span>
        <input
          className="folder-edit-input"
          autoFocus
          value={value}
          aria-label="文件夹名称"
          data-testid="folder-edit-input"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) =>
            setEditing((prev) => (prev ? { ...prev, name: e.target.value } : prev))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancelEditing();
            }
          }}
          onBlur={() => void commitEditing()}
        />
      </div>
    );
  };

  const renderFolder = (folder: Folder, depth: number): JSX.Element => {
    const renameValue =
      editing?.mode === "rename" && editing.id === folder.id ? editing.name : null;
    const isCollapsed = collapsed.has(folder.id);
    return (
      <div
        className="tree-row tree-row--folder"
        role="button"
        tabIndex={0}
        draggable
        aria-expanded={!isCollapsed}
        data-selected={currentFolderId === folder.id ? "true" : "false"}
        data-drop-target={dragOverFolderId === folder.id ? "true" : "false"}
        data-drop-position={
          folderDropTarget?.id === folder.id
            ? folderDropTarget.after
              ? "after"
              : "before"
            : undefined
        }
        data-dragging={draggingFolderId === folder.id ? "true" : "false"}
        data-testid={`folder-row-${folder.id}`}
        style={{ paddingLeft: indent(depth) }}
        title={folder.name}
        onClick={() => toggleFolder(folder)}
        onDragStart={(e) => startFolderDrag(e, folder)}
        onDragEnd={clearFolderDrag}
        onDragOver={(e) => handleFolderDragOver(e, folder)}
        onDragLeave={(e) => handleFolderDragLeave(e, folder)}
        onDrop={(e) => handleFolderDrop(e, folder)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleFolder(folder);
          }
        }}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          {isCollapsed ? "folder" : "folder_open"}
        </span>

        {renameValue !== null ? (
          <input
            className="folder-edit-input"
            autoFocus
            draggable={false}
            value={renameValue}
            aria-label="文件夹名称"
            data-testid="folder-edit-input"
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setEditing((prev) => (prev ? { ...prev, name: e.target.value } : prev))
            }
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEditing();
              }
            }}
            onBlur={() => void commitEditing()}
          />
        ) : (
          <span className="tree-name">{folder.name}</span>
        )}

        <span className="tree-actions">
          <button
            type="button"
            title="重命名文件夹"
            aria-label="重命名文件夹"
            draggable={false}
            data-testid={`folder-rename-${folder.id}`}
            onClick={(e) => {
              e.stopPropagation();
              startRename(folder);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <span className="material-symbols-outlined">edit</span>
          </button>
          <button
            type="button"
            title="删除文件夹"
            aria-label="删除文件夹"
            draggable={false}
            data-testid={`folder-delete-${folder.id}`}
            onClick={(e) => {
              e.stopPropagation();
              void handleDeleteFolder(folder);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <span className="material-symbols-outlined">delete</span>
          </button>
        </span>
      </div>
    );
  };

  const renderNote = (note: NoteSummary, depth: number): JSX.Element => (
    <div
      key={note.id}
      className="tree-row tree-row--note"
      role="button"
      tabIndex={0}
      draggable
      title={`${note.title || "无标题"}\n${notePreview(note)}`}
      data-testid={`note-link-${note.id}`}
      data-active={activeId === note.id ? "true" : "false"}
      data-dragging={draggingNoteId === note.id ? "true" : "false"}
      style={{ paddingLeft: noteIndent(depth) }}
      onClick={() => openNote(note)}
      onDragStart={(e) => startDrag(e, note)}
      onDragEnd={clearDrag}
      onDragOver={(e) => e.stopPropagation()}
      onDrop={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openNote(note);
        }
      }}
    >
      <span className="material-symbols-outlined tree-note-icon" aria-hidden="true">
        description
      </span>
      <span className="tree-note-main">
        <span className="tree-note-head">
          <span className="tree-note-title">{note.title || "无标题"}</span>
          <span className="tree-note-time">{relativeTime(note.updatedAt)}</span>
        </span>
        <span className="tree-note-excerpt">{notePreview(note)}</span>
      </span>
    </div>
  );

  /** 扁平树：根级文件夹 → 各自展开的笔记；最后是根级笔记。 */
  const renderTree = (): JSX.Element[] => {
    const rows: JSX.Element[] = [];
    const editor = renderEditor(0);
    if (editor) rows.push(editor);

    for (const folder of sortedFolders) {
      rows.push(renderFolder(folder, 0));
      if (!collapsed.has(folder.id)) {
        for (const note of notesByFolder.get(folder.id) ?? []) {
          rows.push(renderNote(note, 1));
        }
      }
    }
    for (const note of notesByFolder.get(null) ?? []) {
      rows.push(renderNote(note, 0));
    }
    return rows;
  };

  const targetFolder = currentFolderId
    ? folders.find((f) => f.id === currentFolderId)
    : undefined;
  const isEmpty = folders.length === 0 && notes.length === 0;

  return (
    <div className="note-tree" data-testid="note-tree">
      <div
        className="note-tree-body"
        data-testid="note-tree-body"
        data-drop-root={dragOverRoot && draggingInsideFolder ? "true" : "false"}
        onDragOver={handleTreeDragOver}
        onDragLeave={handleTreeDragLeave}
        onDrop={handleTreeDrop}
      >
        {/* 与树行同组，粘在滚动容器顶部 */}
        <div className="note-tree-create">
          <button
            type="button"
            className="tree-row tree-row--create"
            data-testid="btn-new"
            aria-label="新建文件夹、新建笔记或上传笔记"
            title="新建"
            onClick={() => setDialogOpen(true)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              add
            </span>
            <span className="tree-name">新建</span>
          </button>
        </div>

        {renderTree()}

        {isEmpty && (
          <div className="note-list-empty" data-testid="note-list-empty">
            还没有笔记，点上方「新建」创建
          </div>
        )}
      </div>

      {draggingInsideFolder && (
        <div
          className="tree-drop-root"
          data-testid="drop-root"
          data-active={dragOverRoot ? "true" : "false"}
          onDragOver={handleRootZoneDragOver}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverRoot(false);
          }}
          onDrop={handleRootZoneDrop}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            drive_file_move
          </span>
          <span>移到顶层</span>
        </div>
      )}

      <M3eDialog
        open={dialogOpen}
        data-testid="create-dialog"
        onClosed={() => setDialogOpen(false)}
      >
        <span slot="header">新建</span>
        <div className="create-dialog" data-testid="create-dialog-content">
          {targetFolder && (
            <p className="create-dialog-hint">笔记位置：{targetFolder.name}</p>
          )}
          <button
            type="button"
            className="create-dialog-option"
            data-testid="create-folder"
            onClick={startCreateFolder}
          >
            <span className="material-symbols-outlined">create_new_folder</span>
            <span className="create-dialog-option-text">
              <strong>新建文件夹</strong>
              <span>在根部创建（文件夹不支持嵌套）</span>
            </span>
          </button>
          <button
            type="button"
            className="create-dialog-option"
            data-testid="create-note"
            onClick={handleCreateNote}
          >
            <span className="material-symbols-outlined">note_add</span>
            <span className="create-dialog-option-text">
              <strong>新建笔记</strong>
              <span>在当前位置创建一条空白笔记</span>
            </span>
          </button>
          <button
            type="button"
            className="create-dialog-option"
            data-testid="upload-note"
            onClick={handleUpload}
          >
            <span className="material-symbols-outlined">upload_file</span>
            <span className="create-dialog-option-text">
              <strong>上传笔记</strong>
              <span>导入 MD / DOCX / PDF 为一条笔记</span>
            </span>
          </button>
        </div>
      </M3eDialog>

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,.docx,.pdf"
        hidden
        data-testid="import-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importDoc(file);
        }}
      />
    </div>
  );
}
