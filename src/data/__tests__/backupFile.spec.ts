/**
 * 备份文件序列化/校验单测。
 */
import { describe, expect, it } from "vitest";
import { backupFilename, parseBackupPayload, serializeBackup } from "@/data/backupFile";
import type { BackupPayload } from "@/types/backup";
import { makeNote } from "@/test/factories";

function payload(overrides: Partial<BackupPayload> = {}): BackupPayload {
  return {
    schemaVersion: 2,
    exportedAt: 1700000000000,
    notes: [makeNote({ id: "n1", title: "标题", content: "# 标题" })],
    folders: [],
    blobs: [],
    ...overrides,
  };
}

describe("serializeBackup", () => {
  it("只序列化白名单字段：混入的 token 不会进入备份", () => {
    const dirty = {
      ...payload(),
      gistToken: "ghp_secret",
      schemaExtra: { scheme: "dark" },
    } as BackupPayload;
    const text = serializeBackup(dirty);
    expect(text).not.toContain("ghp_secret");
    expect(text).not.toContain("scheme");
    expect(JSON.parse(text).notes).toHaveLength(1);
  });
});

describe("parseBackupPayload", () => {
  it("接受合法备份，folders 缺失时补空数组", () => {
    const raw = JSON.parse(serializeBackup(payload())) as Record<string, unknown>;
    delete raw.folders;
    const parsed = parseBackupPayload(JSON.stringify(raw));
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.folders).toEqual([]);
  });

  it("拒绝非法 JSON / 版本不符 / 缺字段", () => {
    expect(() => parseBackupPayload("not json")).toThrow("JSON");
    expect(() => parseBackupPayload(JSON.stringify({ schemaVersion: 1, notes: [], blobs: [] }))).toThrow(
      "版本",
    );
    expect(() => parseBackupPayload(JSON.stringify({ schemaVersion: 2, notes: [], blobs: [] }))).not.toThrow();
    expect(() =>
      parseBackupPayload(JSON.stringify({ schemaVersion: 2, notes: [{ id: "x" }], blobs: [] })),
    ).toThrow("缺少 title");
    expect(() =>
      parseBackupPayload(
        JSON.stringify({
          schemaVersion: 2,
          notes: [{ id: "x", title: "t", content: "c" }],
          blobs: [{ id: "b", mime: "image/png" }],
        }),
      ),
    ).toThrow("缺少 base64");
  });
});

describe("backupFilename", () => {
  it("按日期时间生成 .dat 文件名", () => {
    expect(backupFilename(new Date(2026, 9, 18, 9, 5))).toBe("clawclip-backup-20261018-0905.dat");
  });
});
