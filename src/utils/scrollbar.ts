/**
 * overlay 滚动条的缩略条几何计算。
 *
 * 不依赖 DOM，方便单测：所有尺寸均为同一坐标系下的像素值。
 */

export interface ScrollbarThumb {
  /** 内容是否超出视口；false 时不显示滚动条。 */
  visible: boolean;
  /** 缩略条长度（px）。 */
  size: number;
  /** 缩略条在轨道内的偏移（px）。 */
  offset: number;
}

export interface ScrollbarThumbInput {
  /** 视口尺寸（clientHeight / clientWidth）。 */
  viewportSize: number;
  /** 内容尺寸（scrollHeight / scrollWidth）。 */
  contentSize: number;
  /** 当前滚动偏移（scrollTop / scrollLeft）。 */
  scrollOffset: number;
  /** 轨道尺寸，已扣除两端留白。 */
  trackSize: number;
  /** 缩略条最小长度，避免内容很长时细到无法拖拽。 */
  minThumbSize?: number;
}

const EPSILON = 0.5;

export function computeScrollbarThumb({
  viewportSize,
  contentSize,
  scrollOffset,
  trackSize,
  minThumbSize = 32,
}: ScrollbarThumbInput): ScrollbarThumb {
  if (
    !Number.isFinite(viewportSize) ||
    !Number.isFinite(contentSize) ||
    !Number.isFinite(trackSize) ||
    viewportSize <= 0 ||
    trackSize <= 0 ||
    contentSize <= viewportSize + EPSILON
  ) {
    return { visible: false, size: 0, offset: 0 };
  }

  const rawSize = (trackSize * viewportSize) / contentSize;
  const size = Math.min(trackSize, Math.max(minThumbSize, rawSize));
  const maxScroll = contentSize - viewportSize;
  const progress = maxScroll > EPSILON ? Math.min(1, Math.max(0, scrollOffset / maxScroll)) : 0;

  return {
    visible: true,
    size,
    offset: (trackSize - size) * progress,
  };
}
