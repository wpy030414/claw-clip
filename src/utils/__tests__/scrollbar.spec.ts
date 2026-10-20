import { describe, expect, it } from "vite-plus/test";
import { computeScrollbarThumb } from "@/utils/scrollbar";

describe("computeScrollbarThumb", () => {
  it("内容不超出视口时不显示", () => {
    expect(
      computeScrollbarThumb({
        viewportSize: 400,
        contentSize: 400,
        scrollOffset: 0,
        trackSize: 396,
      }),
    ).toEqual({ visible: false, size: 0, offset: 0 });
  });

  it("亚像素溢出（<=0.5px）不算可滚动，避免抖出一条细线", () => {
    expect(
      computeScrollbarThumb({
        viewportSize: 400,
        contentSize: 400.4,
        scrollOffset: 0,
        trackSize: 396,
      }).visible,
    ).toBe(false);
  });

  it("视口或轨道尺寸为 0 时不显示（容器尚未布局）", () => {
    expect(
      computeScrollbarThumb({ viewportSize: 0, contentSize: 800, scrollOffset: 0, trackSize: 0 })
        .visible,
    ).toBe(false);
  });

  it("缩略条长度按视口占比缩放", () => {
    const { size } = computeScrollbarThumb({
      viewportSize: 200,
      contentSize: 800,
      scrollOffset: 0,
      trackSize: 200,
    });
    expect(size).toBe(50);
  });

  it("内容极长时缩略条不低于最小值", () => {
    const { size } = computeScrollbarThumb({
      viewportSize: 200,
      contentSize: 100_000,
      scrollOffset: 0,
      trackSize: 200,
      minThumbSize: 32,
    });
    expect(size).toBe(32);
  });

  it("轨道比最小缩略条还短时，缩略条占满轨道", () => {
    const { size, offset } = computeScrollbarThumb({
      viewportSize: 10,
      contentSize: 900,
      scrollOffset: 400,
      trackSize: 20,
      minThumbSize: 32,
    });
    expect(size).toBe(20);
    expect(offset).toBe(0);
  });

  it("顶部时贴轨道起点，底部时贴轨道终点", () => {
    const input = { viewportSize: 200, contentSize: 800, trackSize: 200 };
    expect(computeScrollbarThumb({ ...input, scrollOffset: 0 }).offset).toBe(0);
    // 最大滚动 600，缩略条 50，行程 150
    expect(computeScrollbarThumb({ ...input, scrollOffset: 600 }).offset).toBe(150);
  });

  it("滚动过半时缩略条落在行程中点", () => {
    const { offset } = computeScrollbarThumb({
      viewportSize: 200,
      contentSize: 800,
      scrollOffset: 300,
      trackSize: 200,
    });
    expect(offset).toBe(75);
  });

  it("越界的滚动偏移被夹在 [0, 行程] 内（overscroll / 程序化滚动）", () => {
    const input = { viewportSize: 200, contentSize: 800, trackSize: 200 };
    expect(computeScrollbarThumb({ ...input, scrollOffset: -50 }).offset).toBe(0);
    expect(computeScrollbarThumb({ ...input, scrollOffset: 5000 }).offset).toBe(150);
  });

  it("NaN 尺寸不产生 NaN 样式值", () => {
    const result = computeScrollbarThumb({
      viewportSize: Number.NaN,
      contentSize: 800,
      scrollOffset: 0,
      trackSize: 200,
    });
    expect(result).toEqual({ visible: false, size: 0, offset: 0 });
  });
});
