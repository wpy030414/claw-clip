import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { animateScrollTo, cancelScroll, prefersReducedMotion, scrollTopFor } from "@/utils/scroll";

const realMatchMedia = window.matchMedia;

function mockReducedMotion(reduced: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** 手动驱动的 rAF：按时间戳逐帧推进，便于断言动画中间状态。 */
function mockFrames() {
  const queue = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queue.set(++id, cb);
    return id;
  });
  const cancel = vi.fn((handle: number) => {
    queue.delete(handle);
  });
  vi.stubGlobal("cancelAnimationFrame", cancel);
  return {
    frame(time: number) {
      const entry = [...queue.entries()][0];
      if (!entry) return;
      queue.delete(entry[0]);
      entry[1](time);
    },
    pending: () => queue.size,
    cancel,
  };
}

/** 只有滚动尺寸的假容器（jsdom 量不出布局，这里直接给定）。 */
function fakeScroller(scrollHeight = 4000, clientHeight = 800): HTMLElement {
  let scrollTop = 0;
  return {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = value;
    },
    scrollHeight,
    clientHeight,
  } as unknown as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.matchMedia = realMatchMedia;
});

describe("scrollTopFor", () => {
  it("把目标贴到容器顶部：当前滚动量 + 目标相对容器的偏移 - 留白", () => {
    // 容器顶在屏幕 100，目标行在屏幕 900，当前已滚 200，留白 24
    expect(
      scrollTopFor({
        scrollTop: 200,
        currentTop: 900,
        containerTop: 100,
        margin: 24,
        maxScrollTop: 5000,
      }),
    ).toBe(976);
  });

  it("目标在容器上方时得到更小的 scrollTop（向上滚）", () => {
    expect(
      scrollTopFor({
        scrollTop: 800,
        currentTop: 150,
        containerTop: 300,
        margin: 24,
        maxScrollTop: 5000,
      }),
    ).toBe(626);
  });

  it("结果与当前滚动位置无关：同一布局下每帧重算得到同一落点", () => {
    const target = (scrollTop: number) =>
      scrollTopFor({
        scrollTop,
        currentTop: 900 - scrollTop,
        containerTop: 100,
        maxScrollTop: 5000,
      });
    expect(target(0)).toBe(800);
    expect(target(300)).toBe(800);
    expect(target(800)).toBe(800);
  });

  it("不越过顶部与底部的可滚动范围", () => {
    expect(
      scrollTopFor({ scrollTop: 0, currentTop: 50, containerTop: 400, maxScrollTop: 5000 }),
    ).toBe(0);
    expect(
      scrollTopFor({ scrollTop: 4800, currentTop: 2000, containerTop: 0, maxScrollTop: 5000 }),
    ).toBe(5000);
    // 内容不足一屏（maxScrollTop 为负）时不允许负值
    expect(
      scrollTopFor({ scrollTop: 0, currentTop: 900, containerTop: 100, maxScrollTop: -12 }),
    ).toBe(0);
  });

  it("留白默认 0", () => {
    expect(
      scrollTopFor({ scrollTop: 0, currentTop: 400, containerTop: 100, maxScrollTop: 5000 }),
    ).toBe(300);
  });
});

describe("prefersReducedMotion", () => {
  it("跟随系统设置", () => {
    mockReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    mockReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe("animateScrollTo", () => {
  it("逐帧推进，结束时精确落到目标（不是瞬移）", () => {
    mockReducedMotion(false);
    const frames = mockFrames();
    const el = fakeScroller();

    animateScrollTo(el, () => 1600, { duration: 300 });
    frames.frame(0);
    expect(el.scrollTop).toBe(0);

    frames.frame(100);
    const middle = el.scrollTop;
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1600);

    frames.frame(300);
    expect(el.scrollTop).toBe(1600);
    expect(frames.pending()).toBe(0);
  });

  it("布局变化时跟随最新落点：列宽过渡中重算目标", () => {
    mockReducedMotion(false);
    const frames = mockFrames();
    const el = fakeScroller();
    let target = 1000;

    animateScrollTo(el, () => target, { duration: 200 });
    frames.frame(0);
    frames.frame(100);
    // 视图切换过渡中换行变化：同一条标题的行位置整体后移
    target = 2400;
    frames.frame(200);
    expect(el.scrollTop).toBe(2400);

    // 目标连续 3 帧不变才收工，避免过渡的最后一下落在动画之后
    expect(frames.pending()).toBe(1);
    frames.frame(250);
    frames.frame(300);
    frames.frame(350);
    expect(el.scrollTop).toBe(2400);
    expect(frames.pending()).toBe(0);
  });

  it("落点夹在可滚动范围内", () => {
    mockReducedMotion(false);
    const frames = mockFrames();
    const el = fakeScroller(4000, 800);

    animateScrollTo(el, () => 99_999, { duration: 100 });
    frames.frame(0);
    frames.frame(100);
    expect(el.scrollTop).toBe(3200);
  });

  it("减少动态效果时直接到位，不排动画帧", () => {
    mockReducedMotion(true);
    const frames = mockFrames();
    const el = fakeScroller();

    animateScrollTo(el, () => 1600);
    expect(el.scrollTop).toBe(1600);
    expect(frames.pending()).toBe(0);
  });

  it("新的滚动请求接管旧动画", () => {
    mockReducedMotion(false);
    const frames = mockFrames();
    const el = fakeScroller();

    animateScrollTo(el, () => 1000, { duration: 300 });
    animateScrollTo(el, () => 2000, { duration: 300 });
    expect(frames.cancel).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(1);

    frames.frame(0);
    frames.frame(300);
    expect(el.scrollTop).toBe(2000);
  });

  it("cancelScroll 停止进行中的动画", () => {
    mockReducedMotion(false);
    const frames = mockFrames();
    const el = fakeScroller();

    animateScrollTo(el, () => 1600, { duration: 300 });
    frames.frame(0);
    const parked = el.scrollTop;
    cancelScroll(el);
    expect(frames.pending()).toBe(0);
    expect(el.scrollTop).toBe(parked);
  });
});
