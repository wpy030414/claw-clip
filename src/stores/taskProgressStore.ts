/**
 * 阻塞式任务进度：图片上传/迁移这类不可中断的批量操作共用。
 *
 * 同一时刻只允许一个任务（`begin` 在已有任务时返回 null），
 * 由 `TaskProgressOverlay` 以原生 <dialog>.showModal() 渲染在最顶层，
 * 禁止 Esc/遮罩关闭，并在任务期间注册 beforeunload 提醒。
 */
import { create } from "zustand";

export interface TaskProgress {
  id: number;
  /** 主文案，如「正在上传图片到图床」 */
  title: string;
  /** 次要说明，如「3 / 10 · dot.png」 */
  detail: string;
  done: number;
  /** 0 表示总数未知（环形进度条为不确定态） */
  total: number;
  /** 当前网络速度（字节/秒）；0 表示尚未测到 */
  speed: number;
}

interface TaskProgressState {
  task: TaskProgress | null;
  /** 开始一个任务；已有任务在跑时返回 null（调用方应放弃本次操作）。 */
  begin: (title: string, total?: number) => number | null;
  update: (id: number, patch: Partial<Omit<TaskProgress, "id">>) => void;
  end: (id: number) => void;
}

let nextTaskId = 1;

export const useTaskProgressStore = create<TaskProgressState>((set, get) => ({
  task: null,

  begin: (title, total = 0) => {
    if (get().task) return null;
    const id = nextTaskId;
    nextTaskId += 1;
    set({ task: { id, title, detail: "", done: 0, total, speed: 0 } });
    return id;
  },

  update: (id, patch) => {
    const task = get().task;
    if (task?.id !== id) return;
    set({ task: { ...task, ...patch } });
  },

  end: (id) => {
    if (get().task?.id !== id) return;
    set({ task: null });
  },
}));
