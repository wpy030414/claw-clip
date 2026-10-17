/**
 * 文件夹模型（v2）：树形组织笔记。
 *
 * parentId=null 表示根级文件夹；笔记的 folderId 指向所属文件夹，
 * null/undefined 表示直接放在根目录。文件夹与笔记都存 IndexedDB。
 */
export interface Folder {
  id: string;
  name: string;
  /** 历史字段；文件夹已不允许嵌套，加载时会归一化为 null。 */
  parentId: string | null;
  /** 手动排序序号：越小越靠前；缺失时由 loadFolders 归一化补齐。 */
  order?: number;
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
