/**
 * 附件二进制记录（IndexedDB `blobs` store 的存储形状）。
 *
 * `data` 存 **Blob** 而非 ArrayBuffer：
 * - IDB 原生支持 Blob 结构化克隆，零拷贝、懒加载，不把二进制读进 JS 堆；
 * - `URL.createObjectURL(blobRecord.data)` 可直接生成渲染用 object URL。
 *
 * ★ 生命周期由 `refCount` 决定：它表示**有多少条笔记的正文引用了该附件**
 * （同一笔记内多处引用只算 1）。计数归零即删除 blob；`noteId` 只保留创建
 * 溯源信息，不再作为删除依据（附件可被复制/粘贴到其它笔记）。
 */
export interface BlobRecord {
  id: string;
  /** 创建时所在的笔记 id（仅作溯源，删除判定看 refCount） */
  noteId: string;
  /** MIME 类型（如 image/png） */
  mime: string;
  /** 字节数 */
  size: number;
  /** 二进制本体 */
  data: Blob;
  createdAt: number;
  /** 引用该附件的笔记数（0=无引用，等待回收）；旧记录缺失时按 0 处理 */
  refCount: number;
  /**
   * 已上传到图床后的外链（仅作为云快照组装的缓存，避免重复上传）。
   * 本地正文仍引用 `clawclip://blob/<id>`，本字段不参与渲染与引用计数。
   */
  remoteUrl?: string;
  /** 图床上传时间（epoch ms） */
  remoteUploadedAt?: number;
}
