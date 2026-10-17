/**
 * 全局快捷键 hook（方案 §5.8）。
 *
 * 分层原则：
 * - CodeMirror 处理编辑区内文本操作（历史/查找等），本 hook 不重复注册，避免双触发。
 * - 本 hook 处理跨区命令（保存/新建/面板/主题/源码模式等）。
 *
 * 冲突规避：仅拦截带 mod（Cmd/Ctrl）的组合键，或 Esc；纯字符输入交给编辑器。
 */
import { useEffect, useRef } from "react";

export type HotkeyHandler = (e: KeyboardEvent) => void;
export type HotkeyMap = Record<string, HotkeyHandler>;

/**
 * 把 KeyboardEvent 规范化成组合键字符串，如 "mod+shift+d"、"mod+s"、"esc"。
 * mod = Cmd(mac) 或 Ctrl(其它)。
 */
export function normalizeCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(e.key.toLowerCase());
  return parts.join("+");
}

/**
 * 注册全局快捷键。handlers 用 ref 存最新引用，避免每次 render 重新绑定、也避免闭包过时。
 * @param handlers 组合键 → 处理函数映射（key 用 normalizeCombo 的格式）
 * @param enabled 是否启用（如对话框打开时可临时禁用）
 */
export function useHotkeys(handlers: HotkeyMap, enabled = true): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers; // 每次 render 更新到最新，effect 里读 ref 不会过时

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const combo = normalizeCombo(e);
      const fn = handlersRef.current[combo];
      if (fn) {
        // 只拦截已注册的组合键（通常是 mod+ 或 esc），不影响普通输入
        e.preventDefault();
        e.stopPropagation();
        fn(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
