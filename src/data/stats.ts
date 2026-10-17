/**
 * 本应用 IndexedDB 数据统计（侧栏底部展示）。
 *
 * 只统计本应用的四个 store：notes / folders / blobs / meta。
 * - 文本记录按 JSON 的 UTF-8 字节数估算；
 * - blob 记录用其 `size`（二进制本体占绝对大头），不把 Blob 本体序列化。
 *
 * 这是「应用自己库里有多少数据」的近似值，不包含 IndexedDB 的存储开销；
 * 与 navigator.storage.estimate() 的整站用量不同。
 */
import { globalConfig } from "@/config";
import type { BlobRecord } from "@/types/blob";
import type { Folder } from "@/types/folder";
import type { Note } from "@/types/note";
import { getAllOf } from "./db";

export interface DbStats {
  /** 笔记条数 */
  noteCount: number;
  /** notes + folders + blobs + meta 的数据字节数（近似） */
  bytes: number;
}

const encoder = new TextEncoder();

function jsonBytes(value: unknown): number {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

/** 读取本应用 IDB 的笔记数与占用大小。 */
export async function getDbStats(): Promise<DbStats> {
  const { notes, folders, blobs, meta } = globalConfig.storeNames;
  const [noteRows, folderRows, blobRows, metaRows] = await Promise.all([
    getAllOf<Note>(notes),
    getAllOf<Folder>(folders),
    getAllOf<BlobRecord>(blobs),
    getAllOf<Record<string, unknown>>(meta),
  ]);

  let bytes = 0;
  for (const note of noteRows) bytes += jsonBytes(note);
  for (const folder of folderRows) bytes += jsonBytes(folder);
  for (const blob of blobRows) {
    bytes += (blob.size || blob.data?.size || 0) + jsonBytes({
      id: blob.id,
      noteId: blob.noteId,
      mime: blob.mime,
      size: blob.size,
      createdAt: blob.createdAt,
    });
  }
  for (const record of metaRows) bytes += jsonBytes(record);

  return { noteCount: noteRows.length, bytes };
}

/** 人类可读大小：按 KB / MB / GB 展示（最小单位为 KB）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const kb = bytes / 1024;
  if (kb >= 1024 * 1024) return `${formatValue(kb / (1024 * 1024))} GB`;
  if (kb >= 1024) return `${formatValue(kb / 1024)} MB`;
  return `${formatValue(kb)} KB`;
}

/** 小于 10 保留一位小数，否则取整，避免长时间戳数字占满侧栏。 */
function formatValue(value: number): string {
  return value < 10 ? value.toFixed(1) : value.toFixed(0);
}
