/**
 * M3E Snackbar 命令式 API 封装（简化调用）。
 *
 * M3eSnackbar.open 有 4 个重载（已从 @m3e/web Snackbar.d.ts 核实）：
 *   open(message, options?)
 *   open(message, action: string, options?)
 *   open(message, action, dismissible, options?)
 *   open(message, dismissible: boolean, options?)
 * SnackbarOptions = { duration?: number; actionCallback?: () => void; ... }
 *
 * 本模块封装常用场景，统一时长。注意：无动作时用 2 参形式（第二参不能传 undefined 占位）。
 */
import { M3eSnackbar } from "@/components/m3e";

/** 成功提示。 */
export function toastSuccess(message: string, duration = 3000): void {
  M3eSnackbar.open(message, { duration });
}

/** 错误提示。 */
export function toastError(message: string, duration = 5000): void {
  M3eSnackbar.open(message, { duration });
}

/** 警告提示。 */
export function toastWarning(message: string, duration = 4000): void {
  M3eSnackbar.open(message, { duration });
}

/** 信息提示。 */
export function toastInfo(message: string, duration = 3000): void {
  M3eSnackbar.open(message, { duration });
}

/** 带撤销动作的提示（如删除后撤销）。用 open(message, action, options) 重载。 */
export function toastWithUndo(message: string, onUndo: () => void, duration = 5000): void {
  M3eSnackbar.open(message, "撤销", {
    duration,
    actionCallback: onUndo,
  });
}

/** 通用 Snackbar（完整控制，直接透传 M3eSnackbar.open）。 */
export const toast = M3eSnackbar.open;
