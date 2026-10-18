/**
 * IDB 统计单测：笔记数、字节估算与人类可读格式化。
 */
import { describe, expect, it } from "vite-plus/test";
import { LocalDataSource } from "@/data/local";
import { formatBytes, getDbStats } from "@/data/stats";
import { emptyFolder } from "@/types/folder";
import { makeBlob, makeNote } from "@/test/factories";

const ds = new LocalDataSource();

describe("formatBytes", () => {
  it("按 KB / MB / GB 展示", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(512)).toBe("0.5 KB");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12 * 1024)).toBe("12 KB");
    expect(formatBytes(1024 ** 2)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });
});

describe("getDbStats", () => {
  it("统计笔记数，并把 notes / folders / blobs 计入字节", async () => {
    await ds.upsertNote(makeNote({ id: "stat-note", content: "# 标题\n\n正文内容" }));
    await ds.upsertFolder(emptyFolder("工作"));
    await ds.saveAttachment("stat-note", makeBlob("hello"));

    const stats = await getDbStats();

    expect(stats.noteCount).toBe(1);
    expect(stats.bytes).toBeGreaterThan(5);
  });
});
