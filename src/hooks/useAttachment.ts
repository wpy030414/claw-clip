/**
 * Vditor upload.handler：拦截粘贴/拖拽的图片/视频 → 写 IndexedDB → 自己插入正文。
 *
 * ★★ R6 实测真相（推翻了「返回 string 自动插入」的错误假设）：
 *   Vditor 4.0 源码里 handler 返回值语义是 **validate 结果**：
 *     isValidate = await handler(files);
 *     if (typeof isValidate === "string") { vditor.tip.show(isValidate); return; }
 *   即：**返回 string = 当作错误提示弹出（tip.show），根本不插入正文**；返回 null = 成功。
 *   所以 handler 必须**自己调 insertValue() 插入** markdown，然后返回 null。
 *
 * 插入的 URL 用 **object URL**（blob:...）而非 clawclip://：Vditor 立刻渲染成 <img>，
 * 返回 clawclip:// 会当场破图；落库时由 blobStore.dehydrateMarkdown 反解回 clawclip://。
 */
import { resolveBlobUrl, saveBlob } from "@/data/blobStore";

/** 把 markdown 插入编辑器光标处的回调（由 VditorEditor 传入 vd.insertValue）。 */
export type InsertFn = (markdown: string) => void;

/**
 * 创建 Vditor upload.handler。
 * @param noteIdRef 返回当前笔记 id 的函数（闭包捕获 store 最新值）
 * @param insert    插入 markdown 的回调（handler 自己调用，不靠返回值）
 */
export function makeUploadHandler(noteIdRef: () => string, insert: InsertFn) {
  const handler = async (files: File[]): Promise<null> => {
    const inserts: string[] = [];

    for (const file of files) {
      // 存 blob 到 IndexedDB，返回 blob id
      const blobId = await saveBlob(noteIdRef(), file);
      // ★ 解析成 object URL（同时登记反向映射，供保存时 dehydrate 回 clawclip://）
      const url = await resolveBlobUrl(blobId);

      // 按 MIME 类型生成 Markdown 引用（用 object URL，当场可渲染）
      if (file.type.startsWith("image/")) {
        inserts.push(`![${file.name || "图片"}](${url})`);
      } else if (file.type.startsWith("video/")) {
        inserts.push(`<video src="${url}" controls></video>`);
      } else {
        inserts.push(`[${file.name}](${url})`);
      }
    }

    if (inserts.length > 0) {
      // ★ 自己插入正文（Vditor 不会用返回值插入）
      insert(inserts.join("\n"));
    }
    // 返回 null = 成功（返回 string 会被当错误提示弹出）
    return null;
  };

  // Vditor 的 IUpload.handler 类型是 string|null|Promise<string>|Promise<null>，
  // 我们只返回 Promise<null>（成功），类型断言收敛以匹配签名。
  return handler as unknown as (files: File[]) => Promise<null>;
}
