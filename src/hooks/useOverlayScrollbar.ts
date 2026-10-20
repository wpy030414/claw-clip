/**
 * overlay 滚动条：在滚动容器的定位父级上画一条 M3E 风格的圆角缩略条。
 *
 * 原生滚动条会挤占内容宽度（Windows 上约 17px），各容器又各写一套样式；
 * 这里把原生条交给 CSS 隐藏（见 `styles/scrollbar.css`），滚动指示改由本 hook
 * 绘制：不参与布局、悬停/滚动时浮现，颜色走 `--md-sys-color-*` token。
 *
 * 缩略条挂在**父级**而不是滚动容器内：容器内的绝对定位元素会随内容一起滚走。
 * 因此父级会被设为定位上下文（原本是 static 时才改，卸载时还原）。
 */
import { useEffect } from "react";
import { computeScrollbarThumb } from "@/utils/scrollbar";

/** 轨道两端留白（px）：缩略条不顶到容器边缘。 */
const TRACK_INSET = 2;
/** 缩略条最短长度（px）：内容再长也要能抓住拖动。 */
const MIN_THUMB = 32;
/** 滚动后保持可见的时长（ms）。 */
const IDLE_MS = 900;
/** 指针/焦点离开后收起的延迟（ms）。 */
const LEAVE_MS = 260;

/**
 * 求元素相对 host 内边距盒的偏移（布局 px）。
 *
 * 优先走 offset 链：offsetLeft/offsetTop 是布局坐标，天然免疫祖先的 transform/zoom。
 * 但 offset 链会在 host 与 el 之间隔着 shadow boundary 或 fixed 定位祖先时断裂——
 * 典型是 M3eDialog：`.base` 是 shadow DOM 内的 fixed 元素，被 slot 投影的 light DOM
 * 子节点 `offsetParent` 为 null。此时回退到 rect 差值，并除以 host 的缩放还原成布局 px
 * （移动端 `.note-list-pane { zoom }` 会让 rect 是视觉 px，而 rail 尺寸用布局 px）。
 */
function offsetWithin(el: HTMLElement, host: HTMLElement): { left: number; top: number } {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== host) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node === host) return { left, top };

  const hostRect = host.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const scaleX = host.offsetWidth > 0 ? hostRect.width / host.offsetWidth : 1;
  const scaleY = host.offsetHeight > 0 ? hostRect.height / host.offsetHeight : scaleX;
  return {
    left: (elRect.left - hostRect.left) / (scaleX || 1) - host.clientLeft,
    top: (elRect.top - hostRect.top) / (scaleY || 1) - host.clientTop,
  };
}

function attachOverlayScrollbar(scroller: HTMLElement, host: HTMLElement): () => void {
  const previousPosition = host.style.position;
  // host 必须是定位上下文，否则 rail 的 offsetParent 会落到更外层（M3eDialog 的
  // .base 是 shadow DOM 内的 fixed 元素），rect 差值随之错位。
  // attach 可能早于 M3E shadow 样式就绪，此时 getComputedStyle 返回空串而非 "static"，
  // 故空值也按 static 兜底；absolute/fixed/sticky 的 host 保持原样不覆盖。
  const computedPosition = getComputedStyle(host).position;
  const forcedPosition = computedPosition === "static" || computedPosition === "";
  if (forcedPosition) host.style.position = "relative";

  const rail = document.createElement("div");
  rail.className = "m3e-overlay-scrollbar";
  rail.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("div");
  thumb.className = "m3e-overlay-scrollbar__thumb";
  rail.append(thumb);
  host.append(rail);

  let visible = false;
  let scrollable = false;
  let hovering = false;
  let dragging = false;
  let thumbSize = 0;
  let frame = 0;
  let hideTimer: number | null = null;
  const drag = { pointerId: -1, start: 0, startScroll: 0, travel: 1, maxScroll: 0 };

  function stopFrame() {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
  }

  function startFrame() {
    if (frame !== 0) return;
    const tick = () => {
      frame = 0;
      if (!visible) return;
      measure();
      // measure 可能因内容变短而收起滚动条，此时不再续帧
      if (visible && frame === 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  function setVisible(next: boolean) {
    const shown = next && scrollable;
    if (shown === visible) return;
    visible = shown;
    rail.dataset.visible = shown ? "true" : "false";
    if (shown) startFrame();
    else stopFrame();
  }

  function clearHide() {
    if (hideTimer === null) return;
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }

  function scheduleHide(delay: number) {
    clearHide();
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      if (!dragging && !hovering) setVisible(false);
    }, delay);
  }

  function measure() {
    const origin = offsetWithin(scroller, host);
    rail.style.left = `${origin.left + scroller.clientLeft}px`;
    rail.style.top = `${origin.top + scroller.clientTop}px`;
    rail.style.width = `${scroller.clientWidth}px`;
    rail.style.height = `${scroller.clientHeight}px`;

    const viewportSize = scroller.clientHeight;
    const next = computeScrollbarThumb({
      viewportSize,
      contentSize: scroller.scrollHeight,
      scrollOffset: scroller.scrollTop,
      trackSize: Math.max(0, viewportSize - TRACK_INSET * 2),
      minThumbSize: MIN_THUMB,
    });
    scrollable = next.visible;
    thumbSize = next.size;
    if (!scrollable) {
      setVisible(false);
      return;
    }
    thumb.style.top = `${TRACK_INSET + next.offset}px`;
    thumb.style.height = `${next.size}px`;
  }

  function onScroll() {
    measure();
    setVisible(true);
    scheduleHide(IDLE_MS);
  }

  function onPointerEnter() {
    hovering = true;
    clearHide();
    measure();
    setVisible(true);
  }

  function onPointerLeave() {
    hovering = false;
    if (!dragging) scheduleHide(LEAVE_MS);
  }

  function onFocusIn() {
    measure();
    setVisible(true);
    if (!hovering) scheduleHide(IDLE_MS);
  }

  function onFocusOut() {
    if (!hovering) scheduleHide(LEAVE_MS);
  }

  function onThumbPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !scrollable) return;
    // 拦住默认行为：否则拖拽会顺手选中缩略条下方的正文
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    rail.dataset.dragging = "true";
    drag.pointerId = event.pointerId;
    drag.start = event.clientY;
    drag.startScroll = scroller.scrollTop;
    drag.travel = Math.max(1, scroller.clientHeight - TRACK_INSET * 2 - thumbSize);
    drag.maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    thumb.setPointerCapture(event.pointerId);
    clearHide();
    setVisible(true);
  }

  function onThumbPointerMove(event: PointerEvent) {
    if (!dragging || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const ratio = (event.clientY - drag.start) / drag.travel;
    scroller.scrollTop = drag.startScroll + ratio * drag.maxScroll;
  }

  function onThumbPointerEnd(event: PointerEvent) {
    if (!dragging || event.pointerId !== drag.pointerId) return;
    dragging = false;
    delete rail.dataset.dragging;
    if (thumb.hasPointerCapture(event.pointerId)) thumb.releasePointerCapture(event.pointerId);
    scheduleHide(hovering ? IDLE_MS : LEAVE_MS);
  }

  /** 缩略条浮在滚动容器之外，滚轮落在它上面时要把滚动量转交容器。 */
  function onThumbWheel(event: WheelEvent) {
    event.preventDefault();
    scroller.scrollTop += event.deltaY;
  }

  scroller.addEventListener("scroll", onScroll, { passive: true });
  scroller.addEventListener("pointerenter", onPointerEnter);
  scroller.addEventListener("pointerleave", onPointerLeave);
  scroller.addEventListener("focusin", onFocusIn);
  scroller.addEventListener("focusout", onFocusOut);
  thumb.addEventListener("pointerdown", onThumbPointerDown);
  thumb.addEventListener("pointermove", onThumbPointerMove);
  thumb.addEventListener("pointerup", onThumbPointerEnd);
  thumb.addEventListener("pointercancel", onThumbPointerEnd);
  thumb.addEventListener("pointerenter", onPointerEnter);
  thumb.addEventListener("pointerleave", onPointerLeave);
  thumb.addEventListener("wheel", onThumbWheel, { passive: false });
  window.addEventListener("resize", measure);

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  observer?.observe(scroller);
  observer?.observe(host);

  measure();

  return () => {
    scroller.removeEventListener("scroll", onScroll);
    scroller.removeEventListener("pointerenter", onPointerEnter);
    scroller.removeEventListener("pointerleave", onPointerLeave);
    scroller.removeEventListener("focusin", onFocusIn);
    scroller.removeEventListener("focusout", onFocusOut);
    thumb.removeEventListener("pointerdown", onThumbPointerDown);
    thumb.removeEventListener("pointermove", onThumbPointerMove);
    thumb.removeEventListener("pointerup", onThumbPointerEnd);
    thumb.removeEventListener("pointercancel", onThumbPointerEnd);
    thumb.removeEventListener("pointerenter", onPointerEnter);
    thumb.removeEventListener("pointerleave", onPointerLeave);
    thumb.removeEventListener("wheel", onThumbWheel);
    window.removeEventListener("resize", measure);
    observer?.disconnect();
    stopFrame();
    clearHide();
    rail.remove();
    if (forcedPosition) host.style.position = previousPosition;
  };
}

/**
 * 给一个滚动容器挂上 overlay 滚动条。
 *
 * @param scroller 滚动容器；为 null 时不挂载（条件渲染的容器可直接传 state）
 * @param host     缩略条的挂载父级，默认取 `scroller.parentElement`。
 *                 滚动容器自身不能当 host（缩略条会跟着内容滚走），
 *                 CodeMirror 这类「ref 指向外壳、滚动在内层」的场景显式传外壳。
 */
export function useOverlayScrollbar(scroller: HTMLElement | null, host?: HTMLElement | null): void {
  useEffect(() => {
    if (!scroller) return undefined;
    const overlayHost = host ?? scroller.parentElement;
    if (!overlayHost?.contains(scroller)) return undefined;
    return attachOverlayScrollbar(scroller, overlayHost);
  }, [scroller, host]);
}
