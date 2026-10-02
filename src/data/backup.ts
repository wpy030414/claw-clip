/**
 * 备份用 base64 编解码（二进制安全）。
 *
 * JSON 无法直接承载二进制，导出时 Blob → base64 字符串，导入时还原。
 * 编码走 `arrayBuffer() + btoa`（逐字节 charCode，含 0x00/0xFF 等非 ASCII
 * 字节也无损）；解码走 `atob + Uint8Array`。不用 FileReader 是为了少一层
 * 回调且 jsdom/Node Blob 双环境下行为一致。
 */

/** 分块大小：避免 `String.fromCharCode(...超大数组)` 爆调用栈 */
const CHUNK = 0x8000;

/** Blob → base64 字符串（不含 data: 前缀）。 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 字符串 → Blob（还原 mime）。 */
export function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
