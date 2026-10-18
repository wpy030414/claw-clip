/**
 * 滚动落点与平滑动画的公共逻辑。
 *
 * 大纲跳转、以及其它「滚到某个位置」的交互都希望是**快速滚动**而不是瞬移，
 * 但系统开启「减少动态效果」时必须退化为瞬时（见全局 CSS 的同名媒体查询）。
 *
 * 落点必须**每帧重算**：视图切换时两列有 260ms 的列宽过渡，CodeMirror 的换行
 * 与行高随之持续变化，「点击那一刻算好的位置」很快就过期了——刚切回编辑/分屏
 * 就点大纲，会滚到错误的距离。
 */

/** 系统是否要求减少动态效果。 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface ScrollTopInput {
  /** 容器当前的 `scrollTop`。 */
  scrollTop: number;
  /** 目标当前在视口中的屏幕纵坐标（含滚动后的实际位置）。 */
  currentTop: number;
  /** 滚动容器当前在视口中的屏幕纵坐标。 */
  containerTop: number;
  /** 目标贴顶时保留的留白。 */
  margin?: number;
  /** 容器的最大可滚动距离（`scrollHeight - clientHeight`）。 */
  maxScrollTop: number;
}

/**
 * 让目标贴到容器顶部（留 `margin`）所需的 `scrollTop`。
 *
 * `currentTop` 直接取目标当前的屏幕坐标、`containerTop` 取容器当前屏幕坐标，
 * 两者相减就是「目标相对容器顶部的偏移」，加上当前 `scrollTop` 就是落点。
 * 结果与当前滚动位置无关，因此每帧重算也稳定，不会因动画自身的滚动而漂移。
 */
export function scrollTopFor({
  scrollTop,
  currentTop,
  containerTop,
  margin = 0,
  maxScrollTop,
}: ScrollTopInput): number {
  const raw = scrollTop + currentTop - containerTop - margin;
  return Math.min(Math.max(0, raw), Math.max(0, maxScrollTop));
}

/** 正在进行的动画（每个滚动容器最多一个），新请求接管旧请求。 */
const running = new WeakMap<HTMLElement, number>();

/** 取消容器上尚未结束的滚动动画。 */
export function cancelScroll(scroller: HTMLElement): void {
  const id = running.get(scroller);
  if (id === undefined) return;
  cancelAnimationFrame(id);
  running.delete(scroller);
}

export interface AnimateScrollOptions {
  /** 主动画时长，默认 320ms。 */
  duration?: number;
  /** 主动画结束后继续跟随布局变化的最长时间，默认 1000ms。 */
  follow?: number;
}

/**
 * 平滑滚动到 `targetOf()` 给出的位置。
 *
 * `targetOf` **每帧**都会被重新调用，落点始终按当下的布局计算：列宽过渡、
 * 预览重渲染等造成的位移都会被自动吸收。主动画结束后还要跟随几帧，
 * 确认目标连续多帧不再变化才收工——否则过渡的最后一下恰好落在动画之后，
 * 仍会差出一截。
 */
export function animateScrollTo(
  scroller: HTMLElement,
  targetOf: () => number,
  { duration = 320, follow = 1000 }: AnimateScrollOptions = {},
): void {
  cancelScroll(scroller);

  const clamp = (top: number) =>
    Math.min(Math.max(0, top), Math.max(0, scroller.scrollHeight - scroller.clientHeight));

  if (prefersReducedMotion()) {
    scroller.scrollTop = clamp(targetOf());
    return;
  }

  const startTop = scroller.scrollTop;
  let startTime = -1;
  let lastTarget = clamp(targetOf());
  let steady = 0;

  const step = (now: number) => {
    if (startTime < 0) startTime = now;
    const target = clamp(targetOf());
    const progress = Math.min(1, (now - startTime) / duration);
    // easeOutCubic：起步快、收尾稳，是「快速滚动」而不是匀速拉丝。
    const eased = 1 - Math.pow(1 - progress, 3);
    scroller.scrollTop = progress >= 1 ? target : startTop + (target - startTop) * eased;

    // 目标连续 3 帧不变、且已经对齐，才算布局稳定
    steady = Math.abs(target - lastTarget) < 0.5 ? steady + 1 : 0;
    lastTarget = target;
    const settled = progress >= 1 && steady >= 3;
    if (!settled && now - startTime < duration + follow) {
      running.set(scroller, requestAnimationFrame(step));
    } else {
      running.delete(scroller);
    }
  };

  running.set(scroller, requestAnimationFrame(step));
}
