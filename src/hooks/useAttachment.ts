/**
 * Vditor upload.handler：拦截粘贴/拖拽的图片/视频 → 写 IndexedDB blob 表 → 返回 clawclip:// 引用。
 *
 * Vditor 4.0 upload.handler 真实签名（已从 index.d.ts 核实）：
 *   handler?(files: File[]): string | null | Promise<string> | Promise<null>
 * - 返回 string：Vditor 自动插入正文
 * - 返回 null：不插入（阻止）
 *
 * 此处按「返回 string 自动插入」实现；若 S4 E2E 验证发现不生效，改为 insertValue + return null。
 */
import { BLOB_URL_SCHEME, saveBlob } from "@/data/blobStore";

/**
 * 创建 Vditor upload.handler。
 * @param noteIdRef 返回当前笔记 id 的函数（闭包捕获 store 最新值）
 */
export function makeUploadHandler(noteIdRef: () => string) {
  const handler = async (files: File[]): Promise<string | null> => {
    const inserts: string[] = [];

    for (const file of files) {
      // 存 blob 到 IndexedDB，返回 blob id
      const blobId = await saveBlob(noteIdRef(), file);
      const url = `${BLOB_URL_SCHEME}${blobId}`;

      // 按 MIME 类型生成 Markdown 引用
      if (file.type.startsWith("image/")) {
        inserts.push(`![${file.name || "图片"}](${url})`);
      } else if (file.type.startsWith("video/")) {
        inserts.push(`<video src="${url}" controls></video>`);
      } else {
        // 非图片/视频：插入为下载链接
        inserts.push(`[${file.name}](${url})`);
      }
    }

    if (inserts.length === 0) return null;
    // 返回拼接的 Markdown 片段，Vditor 自动插入光标处
    return inserts.join("\n");
  };

  // Vditor 的 IUpload.handler 类型是 string|null|Promise<string>|Promise<null>，
  // 而 async 函数返回 Promise<string|null>（Promise 的联合 ≠ 联合的 Promise，TS 不等价）。
  // 运行时完全等价，此处类型断言收敛以匹配 Vditor 签名。
  return handler as unknown as (files: File[]) => Promise<string> | Promise<null>;
}
