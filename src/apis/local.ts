import { globalConfig } from "@/config";
import type { Blog } from "@/types/Blog";

export namespace LocalDataSource {
  const dbName = "local-zone";
  const storeName = "blogs";
  let db: IDBDatabase;

  if (globalConfig.enableStoringLocally) {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(storeName))
        db.createObjectStore(storeName, { keyPath: "id" });
    };

    request.onsuccess = (e) => (db = (e.target as IDBOpenDBRequest).result);

    request.onerror = (e) =>
      console.error("Database error: ", (e.target as IDBOpenDBRequest).error);
  }

  export async function uploadSingle(data: Blog) {
    data.id = data.date.getTime();
    return new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.add(data);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(false);
    });
  }

  export async function download(pageSize: number, pageOffset: number) {
    return new Promise<{ total: number; blogs: Blog[] }>((resolve, reject) => {
      const transaction = db.transaction([storeName], "readonly");
      const store = transaction.objectStore(storeName);

      const totalRequest = store.count();

      totalRequest.onsuccess = () => {
        const total = totalRequest.result;

        const blogs: Blog[] = [];
        const request = store.openCursor(null, "prev");
        let skipped = 0;
        const start = pageSize * pageOffset;

        request.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor)
            if (skipped < start) {
              skipped++;
              cursor.continue();
            } else if (blogs.length < pageSize) {
              blogs.push(cursor.value);
              cursor.continue();
            } else resolve({ total, blogs });
          else resolve({ total, blogs });
        };

        request.onerror = () => reject({ total: 0, blogs: [] });
      };

      totalRequest.onerror = () => reject({ total: 0, blogs: [] });
    });
  }

  export async function deleteSingle(id: number) {
    return new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(false);
    });
  }
}
