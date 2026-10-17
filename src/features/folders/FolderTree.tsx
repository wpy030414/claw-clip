/**
 * FolderTree：文件夹树（新建 / 重命名 / 删除 / 在文件夹内新建笔记）。
 *
 * 数据来自 notesStore.folders（扁平数组），UI 按 parentId 递归组树。
 * 删除为级联操作（子文件夹 + 其下笔记 + 附件），因此走 window.confirm 二次确认。
 */
import { useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useNotesStore } from "@/stores/notesStore";
import { useUiStore } from "@/stores/uiStore";
import type { Folder } from "@/types/folder";

interface Editing {
  mode: "create" | "rename";
  parentId: string | null;
  id?: string;
  name: string;
}

export function FolderTree() {
  const navigate = useNavigate();
  const folders = useNotesStore((s) => s.folders);
  const createFolder = useNotesStore((s) => s.createFolder);
  const renameFolder = useNotesStore((s) => s.renameFolder);
  const removeFolder = useNotesStore((s) => s.removeFolder);
  const createNote = useNotesStore((s) => s.createNote);
  const currentFolderId = useUiStore((s) => s.currentFolderId);
  const setCurrentFolderId = useUiStore((s) => s.setCurrentFolderId);
  const [editing, setEditing] = useState<Editing | null>(null);

  const startCreate = (parentId: string | null) =>
    setEditing({ mode: "create", parentId, name: "新建文件夹" });
  const startRename = (folder: Folder) =>
    setEditing({ mode: "rename", parentId: folder.parentId, id: folder.id, name: folder.name });

  const commit = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    setEditing(null);
    if (!name) return;
    if (editing.mode === "create") {
      const id = await createFolder(name, editing.parentId);
      setCurrentFolderId(id);
    } else if (editing.id) {
      await renameFolder(editing.id, name);
    }
  };

  const handleDelete = async (folder: Folder) => {
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

  const handleCreateNote = async (folderId: string) => {
    const id = await createNote(folderId);
    setCurrentFolderId(folderId);
    navigate(`/n/${id}`);
  };

  const renderEditor = (parentId: string | null) => {
    if (!editing || editing.mode !== "create" || editing.parentId !== parentId) return null;
    return (
      <input
        className="folder-edit-input"
        autoFocus
        value={editing.name}
        data-testid="folder-edit-input"
        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") setEditing(null);
        }}
        onBlur={() => void commit()}
      />
    );
  };

  const renderNodes = (parentId: string | null, depth: number): JSX.Element[] =>
    folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((folder) => [
        <div
          key={folder.id}
          className="folder-row"
          data-active={currentFolderId === folder.id ? "true" : "false"}
          data-testid={`folder-row-${folder.id}`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          <button
            type="button"
            className="folder-main"
            onClick={() => setCurrentFolderId(folder.id)}
            onDoubleClick={() => startRename(folder)}
            title={folder.name}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {currentFolderId === folder.id ? "folder_open" : "folder"}
            </span>
            {editing?.mode === "rename" && editing.id === folder.id ? (
              <input
                className="folder-edit-input"
                autoFocus
                value={editing.name}
                data-testid="folder-edit-input"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commit();
                  if (e.key === "Escape") setEditing(null);
                }}
                onBlur={() => void commit()}
              />
            ) : (
              <span className="folder-name">{folder.name}</span>
            )}
          </button>
          <span className="folder-actions">
            <button
              type="button"
              title="新建子文件夹"
              aria-label="新建子文件夹"
              data-testid={`folder-add-${folder.id}`}
              onClick={() => startCreate(folder.id)}
            >
              <span className="material-symbols-outlined">create_new_folder</span>
            </button>
            <button
              type="button"
              title="在此文件夹新建笔记"
              aria-label="在此文件夹新建笔记"
              data-testid={`folder-note-${folder.id}`}
              onClick={() => void handleCreateNote(folder.id)}
            >
              <span className="material-symbols-outlined">note_add</span>
            </button>
            <button
              type="button"
              title="删除文件夹"
              aria-label="删除文件夹"
              data-testid={`folder-delete-${folder.id}`}
              onClick={() => void handleDelete(folder)}
            >
              <span className="material-symbols-outlined">delete</span>
            </button>
          </span>
        </div>,
        ...renderNodes(folder.id, depth + 1),
      ]);

  return (
    <nav className="folder-tree" data-testid="folder-tree" aria-label="文件夹">
      <div className="folder-tree-header">
        <span>文件夹</span>
        <button
          type="button"
          title="新建文件夹"
          aria-label="新建文件夹"
          data-testid="btn-new-folder"
          onClick={() => startCreate(null)}
        >
          <span className="material-symbols-outlined">create_new_folder</span>
        </button>
      </div>

      <button
        type="button"
        className="folder-row folder-row--all"
        data-active={currentFolderId === null ? "true" : "false"}
        data-testid="folder-all"
        onClick={() => setCurrentFolderId(null)}
      >
        <span className="material-symbols-outlined">inventory_2</span>
        <span className="folder-name">全部笔记</span>
      </button>

      {renderEditor(null)}
      {renderNodes(null, 0)}
    </nav>
  );
}
