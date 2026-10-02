/**
 * 附件二进制记录（IndexedDB `blobs` store 的存储形状）。
 *
 * `data` 存 **Blob** 而非 ArrayBuffer：
 * - IDB 原生支持 Blob 结构化克隆，零拷贝、懒加载，不把二进制读进 JS 堆；
 * - `URL.createObjectURL(blobRecord.data)` 可直接生成渲染用 object URL。
 */
export interface BlobRecord {
  id: string;
  /** 归属笔记 id（删除级联用，blobs store 以此建索引） */
  noteId: string;
  /** MIME 类型（如 image/png） */
  mime: string;
  /** 字节数 */
  size: number;
  /** 二进制本体 */
  data: Blob;
  createdAt: number;
}
