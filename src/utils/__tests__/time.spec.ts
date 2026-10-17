import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, relativeTime } from "@/utils/time";

const NOW = new Date(2026, 9, 17, 12, 0, 0).getTime();

describe("relativeTime 相对时间", () => {
  it("1 分钟内显示「刚刚」", () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe("刚刚");
  });

  it("分钟/小时/昨天/天前逐级切换", () => {
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5 分钟前");
    expect(relativeTime(NOW - 3 * 3600_000, NOW)).toBe("3 小时前");
    expect(relativeTime(NOW - 26 * 3600_000, NOW)).toBe("昨天");
    expect(relativeTime(NOW - 3 * 86400_000, NOW)).toBe("3 天前");
  });

  it("超过 7 天回落为绝对日期", () => {
    const ts = new Date(2026, 8, 1, 8, 30).getTime();
    expect(relativeTime(ts, NOW)).toBe("2026-09-01");
  });

  it("未来时间（时钟偏差）直接显示绝对时间", () => {
    const ts = new Date(2026, 9, 18, 9, 5).getTime();
    expect(relativeTime(ts, NOW)).toBe("2026-10-18 09:05");
  });
});

describe("绝对时间格式化", () => {
  it("formatDateTime 输出 YYYY-MM-DD HH:mm（本地时区）", () => {
    expect(formatDateTime(new Date(2026, 0, 2, 3, 4).getTime())).toBe("2026-01-02 03:04");
  });

  it("formatDate 输出 YYYY-MM-DD", () => {
    expect(formatDate(new Date(2026, 11, 31).getTime())).toBe("2026-12-31");
  });
});
