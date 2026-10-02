/**
 * IndexedDB 连接与事务封装。
 *
 * 库名 `claw-clip-v2`，与旧库 `ClawClip` 物理隔离（不写迁移，见方案 §5.3）。
 * 三个 store：
 * - `notes`（keyPath=id，索引 updatedAt/starred/createdAt/tags(multiEntry)）
 * - `blobs`（keyPath=id，索引 noteId/mime）
 * - `meta` （keyPath=key，存 schemaVersion/lastBackupAt 等杂项）
 */
import { globalConfig } from "@/config";
import { idbReq } from "@/utils/idb";

/** Promise 单例：避免重复 open（修正旧版 `while(!db) sleep(500)` 忙等） */
let dbPromise: Promise<IDBDatabase> | null = null;

/** 打开（或复用）数据库连接。 */
export function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(globalConfig.dbName, globalConfig.dbVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(globalConfig.storeNames.notes)) {
          const notes = db.createObjectStore(globalConfig.storeNames.notes, {
            keyPath: "id",
          });
          notes.createIndex("updatedAt", "updatedAt");
          notes.createIndex("starred", "starred");
          notes.createIndex("createdAt", "createdAt");
          notes.createIndex("tags", "tags", { multiEntry: true });
        }
        if (!db.objectStoreNames.contains(globalConfig.storeNames.blobs)) {
          const blobs = db.createObjectStore(globalConfig.storeNames.blobs, {
            keyPath: "id",
          });
          blobs.createIndex("noteId", "noteId");
          blobs.createIndex("mime", "mime");
        }
        if (!db.objectStoreNames.contains(globalConfig.storeNames.meta)) {
          db.createObjectStore(globalConfig.storeNames.meta, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () =>
        reject(new Error("IndexedDB 打开被阻塞：存在其它未关闭的旧版本连接"));
    });
  }
  return dbPromise;
}

/**
 * ⚠️ 仅供测试使用：重置 openDB 单例。
 *
 * fake-indexeddb 的 setup 会在每个用例后把 `globalThis.indexedDB` 换成全新
 * IDBFactory（等于物理删库），但本模块的 Promise 单例仍握着上一个库的连接，
 * 不重置就会「串库」。测试的 beforeEach 里必须调用本函数。
 */
export function __resetDbSingleton(): void {
  dbPromise = null;
}

/**
 * 事务封装：在单个事务里执行 fn，**oncomplete 才 resolve**（保证写入已提交），
 * abort / fn 抛错则 reject。
 *
 * fn 可以同步发起多个请求，也可以 await `idbReq(...)` 后继续在同一事务里
 * 发请求（await 恢复发生在请求 success 事件的微任务里，事务仍活跃）。
 */
export async function withTx<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => T | Promise<T>,
): Promise<T> {
  const db = await openDB();
  const names = typeof stores === "string" ? [stores] : stores;
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let result!: T;
    let settled = false;
    tx.oncomplete = () => {
      settled = true;
      resolve(result);
    };
    tx.onabort = () => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error("IndexedDB 事务被中止"));
      }
    };
    try {
      const r = fn(tx);
      if (r instanceof Promise) {
        r.then(
          (v) => {
            result = v;
          },
          (e: unknown) => {
            // fn 内部失败：主动中止事务并 reject（onabort 可能随后触发，settled 守卫防双 settle）
            try {
              tx.abort();
            } catch {
              /* 事务可能已失活，忽略 */
            }
            if (!settled) {
              settled = true;
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          },
        );
      } else {
        result = r;
      }
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* 事务可能已失活，忽略 */
      }
      if (!settled) {
        settled = true;
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
  });
}

/** 内部小工具：readonly getAll 整个 store。 */
export async function getAllOf<T>(storeName: string): Promise<T[]> {
  return withTx<T[]>(storeName, "readonly", (tx) =>
    idbReq<T[]>(tx.objectStore(storeName).getAll() as IDBRequest<T[]>),
  );
}
