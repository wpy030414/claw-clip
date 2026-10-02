/**
 * 确认对话框 hook（替代旧 utils.warning 的 ElMessageBox.confirm）。
 *
 * 用 uiStore.confirmQueue 驱动 M3E dialog：调用 confirm(...) 入队一个请求，
 * ConfirmDialogHost 渲染队首，用户确认→执行 onConfirm+resolve(true)，取消→onCancel+resolve(false)。
 * onConfirm/onCancel 都挂在请求对象上（见 ConfirmRequest 类型），无需模块级注册表。
 */
import { useCallback } from "react";
import { useUiStore } from "@/stores/uiStore";

interface ConfirmOptions {
  content: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（如删除/清空），确认按钮标红。 */
  danger?: boolean;
}

/**
 * 返回一个 confirm(options, onConfirm) → Promise<boolean> 的函数。
 * resolve(true)=用户确认并已执行 onConfirm；false=取消。
 */
export function useConfirm() {
  const pushConfirm = useUiStore((s) => s.pushConfirm);

  return useCallback(
    (options: ConfirmOptions, onConfirm: () => void | Promise<void>): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        pushConfirm({
          content: options.content,
          confirmText: options.confirmText ?? "确认",
          cancelText: options.cancelText ?? "取消",
          danger: options.danger ?? false,
          onConfirm: async () => {
            await onConfirm();
            resolve(true);
          },
          onCancel: () => resolve(false),
        });
      });
    },
    [pushConfirm],
  );
}
