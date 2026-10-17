/**
 * 节流 / 防抖工具（自动保存、搜索用）。
 */

export interface ThrottledFn<A extends unknown[]> {
  (...args: A): void;
  /** 立即执行挂起的调用（若有），用于失焦/切笔记/Cmd+S 时 flush。 */
  flush: () => void;
  /** 取消挂起的调用，不执行。 */
  cancel: () => void;
}

/**
 * leading + trailing 节流：
 * - 窗口空闲时的首次调用**立即执行**（leading edge）；
 * - 窗口内的后续调用只在末尾执行最后一次（trailing edge）。
 *
 * 为何用 leading+trailing 而非纯 trailing（自动保存语义）：
 * 连续打字仍每 wait 毫秒批量存一次（省 IDB 写入）；但**离散动作**（如插入附件后
 * 只此一次变更、之后不再打字）能立即落库，不必干等整个节流窗口——既降低
 * 「窗口内崩溃丢数据」的风险，也让保存对单次操作即时生效。
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): ThrottledFn<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const invoke = () => {
    if (lastArgs) {
      fn(...lastArgs);
      lastArgs = null;
    }
    timer = null;
  };

  const throttled = (...args: A) => {
    if (timer === null) {
      // 窗口空闲：立即执行（leading），并开启冷却窗口
      fn(...args);
      lastArgs = null;
      timer = setTimeout(invoke, wait);
    } else {
      // 窗口内：记录最新参数，末尾执行（trailing）
      lastArgs = args;
    }
  };

  throttled.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    invoke();
  };

  throttled.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  return throttled;
}

/**
 * 防抖：wait 内每次调用都重置计时器，只有停止调用 wait 后才执行。
 * 适合搜索输入（停止打字后才查）。
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): ThrottledFn<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: A) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };

  debounced.flush = () => {
    // 防抖的 flush 无法拿到「最后参数」除非缓存，这里缓存一份
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      if (pendingArgs) {
        fn(...pendingArgs);
        pendingArgs = null;
      }
    }
  };
  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };

  // 缓存最后一次参数供 flush
  let pendingArgs: A | null = null;
  const wrapped = (...args: A) => {
    pendingArgs = args;
    debounced(...args);
  };
  wrapped.flush = debounced.flush;
  wrapped.cancel = debounced.cancel;

  return wrapped;
}

