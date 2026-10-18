/**
 * taskProgressStore 单测：单任务互斥、更新与结束。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useTaskProgressStore } from "@/stores/taskProgressStore";

beforeEach(() => {
  useTaskProgressStore.setState({ task: null });
});

describe("taskProgressStore", () => {
  it("开始时创建任务，已有任务时拒绝第二个", () => {
    const first = useTaskProgressStore.getState().begin("正在上传", 3);
    expect(first).not.toBeNull();
    expect(useTaskProgressStore.getState().task).toMatchObject({ title: "正在上传", total: 3 });

    const second = useTaskProgressStore.getState().begin("另一个任务");
    expect(second).toBeNull();
    expect(useTaskProgressStore.getState().task!.title).toBe("正在上传");
  });

  it("只接受当前任务的更新与结束", () => {
    const id = useTaskProgressStore.getState().begin("正在迁移")!;
    useTaskProgressStore.getState().update(id, { done: 2, total: 5, detail: "a.png" });
    expect(useTaskProgressStore.getState().task).toMatchObject({ done: 2, total: 5, detail: "a.png" });

    useTaskProgressStore.getState().update(id + 999, { done: 4 });
    expect(useTaskProgressStore.getState().task!.done).toBe(2);

    useTaskProgressStore.getState().end(id + 999);
    expect(useTaskProgressStore.getState().task).not.toBeNull();

    useTaskProgressStore.getState().end(id);
    expect(useTaskProgressStore.getState().task).toBeNull();
  });
});
