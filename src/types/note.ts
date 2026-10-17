/**
 * Note v2 数据模型。
 *
 * 对旧 Blog 模型的关键修正：
 * - id 用 UUID（非时间戳），编辑原地更新永不改 id（修正旧「编辑=删旧建新」bug）
 * - starred 内联为字段（不再独立 stars 表）
 * - wordCount/excerpt 冗余存储，列表页只读轻量投影 NoteSummary，content 不进内存
 * - attachmentIds 反向索引，供删除级联 & 导出打包
 */
export interface Note {
  id: string;
  /** 显式存储；由 deriveTitle 回填，用户手动改过则锁定（锁定态在 uiStore 会话态） */
  title: string;
  /** Markdown GFM 正文（附件用 clawclip://blob/<id> 引用） */
  content: string;
  starred: boolean;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /** 冗余：正文字数（避免列表页解析 content） */
  wordCount: number;
  /** 冗余：前 N 字纯文本摘要（列表卡片用） */
  excerpt: string;
  /** 该笔记引用的 blob id 列表（删除级联 & 导出用） */
  attachmentIds: string[];
  /** 所属文件夹 id；null/undefined = 根目录（v2 起） */
  folderId?: string | null;
  pinned?: boolean;
  schemaVersion: 2;
}

/** 列表轻量投影（不含 content），列表页只读这个，避免全量正文进内存。 */
export type NoteSummary = Pick<
  Note,
  | "id"
  | "title"
  | "excerpt"
  | "wordCount"
  | "starred"
  | "tags"
  | "updatedAt"
  | "createdAt"
  | "pinned"
  | "folderId"
>;

export type NoteSort = "updated" | "created" | "title";

export interface NoteFilter {
  /** 搜 title + content + tags */
  keyword?: string;
  starred?: boolean;
  /** AND 语义：需同时含所有指定标签 */
  tags?: string[];
  /** 文件夹过滤：undefined=全部；null=根目录；string=指定文件夹 */
  folderId?: string | null;
  sort?: NoteSort;
}

/** 创建一条空笔记（未落库）。 */
export function emptyNote(now = Date.now(), folderId: string | null = null): Note {
  return {
    id: crypto.randomUUID(),
    title: "无标题",
    content: "",
    starred: false,
    tags: [],
    createdAt: now,
    updatedAt: now,
    wordCount: 0,
    excerpt: "",
    attachmentIds: [],
    folderId,
    schemaVersion: 2,
  };
}

/** Note → NoteSummary 投影。 */
export function toSummary(n: Note): NoteSummary {
  return {
    id: n.id,
    title: n.title,
    excerpt: n.excerpt,
    wordCount: n.wordCount,
    starred: n.starred,
    tags: n.tags,
    updatedAt: n.updatedAt,
    createdAt: n.createdAt,
    pinned: n.pinned,
    folderId: n.folderId,
  };
}
