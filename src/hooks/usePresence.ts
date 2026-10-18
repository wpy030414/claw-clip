/**
 * 退场动画的挂载保持。
 *
 * 条件渲染的浮层/面板在 `visible` 变 false 时立即卸载，CSS 没有时间播放退出动画。
 * 这里把「是否还挂在树上」与「现在是什么状态」拆开：关闭后延迟 `exitMs` 再卸载，
 * 期间由调用方渲染 `data-state="closing"` 触发退出关键帧。
 */
import { useEffect, useState } from "react";

export type PresenceState = "open" | "closing";

export interface Presence {
  mounted: boolean;
  state: PresenceState;
}

export function usePresence(visible: boolean, exitMs = 200): Presence {
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return undefined;
    }
    if (!mounted) return undefined;
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [visible, exitMs, mounted]);

  return { mounted, state: visible ? "open" : "closing" };
}
