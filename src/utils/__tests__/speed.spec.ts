/**
 * 网络速度计单测：滑动窗口、样本不足与长时间无数据衰减。
 */
import { describe, expect, it } from "vitest";
import { SpeedMeter } from "@/utils/speed";

describe("SpeedMeter", () => {
  it("样本不足时返回 0；两个样本后按时间差计算速度", () => {
    const meter = new SpeedMeter(2000);
    expect(meter.add(1000, 0)).toBe(0);
    // 1 秒内再传 1000 字节 → 1000 B/s
    expect(meter.add(1000, 1000)).toBeCloseTo(1000, 5);
  });

  it("只用最近窗口内的样本", () => {
    const meter = new SpeedMeter(2000);
    meter.add(1000, 0);
    meter.add(1000, 1000);
    // t=5000：窗口起点 3000，丢弃 t=0 的样本 → (3000-2000) / (5-1)s = 250 B/s
    expect(meter.add(1000, 5000)).toBeCloseTo(250, 5);
  });

  it("长时间没有新数据时速度衰减为 0", () => {
    const meter = new SpeedMeter(2000);
    meter.add(1000, 0);
    meter.add(1000, 1000);
    expect(meter.speed(1000)).toBeCloseTo(1000, 5);
    expect(meter.speed(4000)).toBe(0);
  });

  it("reset 清空累计值", () => {
    const meter = new SpeedMeter(2000);
    meter.add(1000, 0);
    meter.add(1000, 1000);
    meter.reset();
    expect(meter.add(1000, 2000)).toBe(0);
  });
});
