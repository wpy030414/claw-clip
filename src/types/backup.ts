import type { Note } from "./note";

/**
 * 备份载荷（.dat 文件的 JSON 形状）。
 *
 * blob 二进制以 base64 字符串承载（JSON 无法直接放二进制），
 * 由 `src/data/backup.ts` 的 blobToBase64 / base64ToBlob 负责编解码。
 */
export interface BackupPayload {
  /** 数据模型版本，当前固定为 2（与 Note.schemaVersion 对齐） */
  schemaVersion: 2;
  /** 导出时刻（epoch ms） */
  exportedAt: number;
  notes: Note[];
  blobs: BackupBlob[];
}

/** 备份中的单个附件（二进制已 base64 化）。 */
export interface BackupBlob {
  id: string;
  noteId: string;
  mime: string;
  size: number;
  base64: string;
}
