/**
 * 文件夹模型（v2）：树形组织笔记。
 *
 * parentId=null 表示根级文件夹；笔记的 folderId 指向所属文件夹，
 * null/undefined 表示直接放在根目录。文件夹与笔记都存 IndexedDB。
 */
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export function emptyFolder(
  name: string,
  parentId: string | null = null,
  now = Date.now(),
): Folder {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || "新建文件夹",
    parentId,
    createdAt: now,
    updatedAt: now,
  };
}
