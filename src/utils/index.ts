import { ElMessageBox } from "element-plus";

/**
 * 阻塞指定时长。
 */
export function sleep(mills: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, mills));
}

/**
 * 对多个对象混合散列。
 */
export async function hash(...objs: any[]) {
  const encoder = new TextEncoder();
  const data = objs.map((obj) => JSON.stringify(obj));
  const buffer = encoder.encode(data.join(","));

  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hashHex;
}

/**
 * 生成一个警告式的模态对话框。
 */
export function warning(content: string, doName: string, doAction: Function) {
  ElMessageBox.confirm(content, "警告", {
    confirmButtonText: doName,
    cancelButtonText: "手滑了",
    center: true,
    showClose: false,
    closeOnClickModal: false,
  })
    .then(() => doAction())
    .catch(() => {});
}
