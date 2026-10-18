/**
 * 全库备份文件（.dat，内容为 BackupPayload JSON）的序列化与校验。
 *
 * 只序列化白名单字段：即使调用方传入的对象里混入了 token / 设置等，
 * 也不会被写进备份文件。
 */
import type { BackupBlob, BackupPayload } from "@/types/backup";
import type { Folder } from "@/types/folder";
import type { Note } from "@/types/note";

/** 白名单序列化（2 空格缩进便于人工检查，体积影响可忽略）。 */
export function serializeBackup(payload: BackupPayload): string {
  return JSON.stringify(
    {
      schemaVersion: 2,
      exportedAt: payload.exportedAt,
      notes: payload.notes,
      folders: payload.folders ?? [],
      blobs: payload.blobs,
    },
    null,
    2,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNote(value: unknown, index: number): asserts value is Note {
  if (!isObject(value)) throw new Error(`第 ${index + 1} 条笔记格式错误`);
  for (const key of ["id", "title", "content"] as const) {
    if (typeof value[key] !== "string") throw new Error(`第 ${index + 1} 条笔记缺少 ${key}`);
  }
}

function assertBlob(value: unknown, index: number): asserts value is BackupBlob {
  if (!isObject(value)) throw new Error(`第 ${index + 1} 个附件格式错误`);
  for (const key of ["id", "mime", "base64"] as const) {
    if (typeof value[key] !== "string") throw new Error(`第 ${index + 1} 个附件缺少 ${key}`);
  }
  if (typeof value.size !== "number") throw new Error(`第 ${index + 1} 个附件缺少 size`);
}

/** 解析并校验备份文本；失败抛出可直接展示给用户的中文错误。 */
export function parseBackupPayload(text: string): BackupPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  if (!isObject(raw)) throw new Error("备份内容格式错误");
  if (raw.schemaVersion !== 2) throw new Error("不支持的备份版本（需要 schemaVersion: 2）");
  if (!Array.isArray(raw.notes)) throw new Error("备份缺少 notes 数组");
  if (!Array.isArray(raw.blobs)) throw new Error("备份缺少 blobs 数组");

  raw.notes.forEach(assertNote);
  raw.blobs.forEach(assertBlob);

  let folders: Folder[] = [];
  if (raw.folders !== undefined) {
    if (!Array.isArray(raw.folders)) throw new Error("folders 必须是数组");
    folders = raw.folders as Folder[];
  }

  return {
    schemaVersion: 2,
    exportedAt: typeof raw.exportedAt === "number" ? raw.exportedAt : Date.now(),
    notes: raw.notes as Note[],
    folders,
    blobs: raw.blobs as BackupBlob[],
  };
}

/** 备份文件名：clawclip-backup-YYYYMMDD-HHmm.dat */
export function backupFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `clawclip-backup-${date}-${time}.dat`;
}
