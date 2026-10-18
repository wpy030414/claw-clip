/**
 * 阻塞式任务进度浮层。
 *
 * 用原生 <dialog>.showModal() 进入 top layer，因此能压在 M3E dialog 之上；
 * 不可关闭（Esc 被拦截、无关闭按钮、点击遮罩无效），任务期间注册 beforeunload，
 * 提醒用户不要刷新/关闭页面。环形进度在总数未知时显示旋转的不确定态。
 */
import { useEffect, useRef } from "react";
import { formatBytes } from "@/data/stats";
import { useTaskProgressStore } from "@/stores/taskProgressStore";

const RADIUS = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function TaskProgressOverlay() {
  const task = useTaskProgressStore((s) => s.task);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = task !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Esc 关闭 = cancel 事件；阻止后只能等任务自己结束
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const preventCancel = (event: Event) => event.preventDefault();
    dialog.addEventListener("cancel", preventCancel);
    return () => dialog.removeEventListener("cancel", preventCancel);
  }, []);

  // 无法真正阻止刷新，但可以让浏览器弹出「确定离开？」确认
  useEffect(() => {
    if (!open) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open]);

  const indeterminate = !task || task.total <= 0;
  const ratio = task && task.total > 0 ? Math.min(1, task.done / task.total) : 0;
  const offset = indeterminate ? CIRCUMFERENCE * 0.75 : CIRCUMFERENCE * (1 - ratio);

  return (
    <dialog
      ref={dialogRef}
      className="task-progress"
      data-testid="task-progress"
      aria-modal="true"
      aria-labelledby="task-progress-title"
    >
      {task && (
        <div className="task-progress-card">
          <svg
            className="task-progress-ring"
            viewBox="0 0 48 48"
            data-indeterminate={indeterminate ? "true" : "false"}
            aria-hidden="true"
          >
            <circle className="task-progress-track" cx="24" cy="24" r={RADIUS} />
            <circle
              className="task-progress-bar"
              cx="24"
              cy="24"
              r={RADIUS}
              style={{ strokeDasharray: CIRCUMFERENCE, strokeDashoffset: offset }}
            />
          </svg>
          <strong className="task-progress-title" id="task-progress-title" data-testid="task-progress-title">
            {task.title}
          </strong>
          <span className="task-progress-meta" data-testid="task-progress-meta">
            {task.speed > 0 ? `${formatBytes(task.speed)}/s` : "正在连接…"}
          </span>
          <span className="task-progress-hint">请勿刷新或关闭页面</span>
        </div>
      )}
    </dialog>
  );
}
