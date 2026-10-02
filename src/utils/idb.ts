/**
 * IndexedDB 通用 promisify 工具。
 */

/**
 * 把 IDBRequest 包装成 Promise。
 *
 * 注意：只能在**事务仍活跃**时发起请求后立即调用（同一同步块内），
 * IDB 事务在事件循环回到宏任务后会自动失活。
 */
export function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
