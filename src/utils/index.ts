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
