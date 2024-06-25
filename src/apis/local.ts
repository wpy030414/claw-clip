import { globalConfig } from "@/config";
import type { Blog } from "@/types/Blog";

export namespace LocalDataSource {
  const dbName = "local-zone";
  const stores = ["blogs", "stars"];
  let db: IDBDatabase;

  if (globalConfig.enableStoringLocally) {
    const request = indexedDB.open(dbName, 1);

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      for (const name of stores)
        if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath: "id" });
    };

    request.onsuccess = (e) => (db = (e.target as IDBOpenDBRequest).result);
    request.onerror = (e) =>
      console.error("Database error: ", (e.target as IDBOpenDBRequest).error);
  }

  function use() {
    return db.transaction(stores, "readwrite");
  }

  export async function uploadSingle(data: Blog) {
    return new Promise<boolean>((resolve, reject) => {
      const store = use().objectStore("blogs");
      const request = store.add(data);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(false);
    });
  }

  export async function download(
    pageSize: number,
    pageOffset: number,
    filter: (b: Blog, using?: IDBTransaction) => Promise<boolean>,
  ) {
    return new Promise<{ total: number; blogs: Blog[] }>((resolve, reject) => {
      const using = use();
      const store = using.objectStore("blogs");

      const blogs: Blog[] = [];
      let total = 0;
      let skipped = 0;
      const start = pageSize * pageOffset;

      const request = store.openCursor(null, "prev");

      request.onsuccess = async (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const blog: Blog = cursor.value;
          if (await filter(blog, using)) {
            total++;
            if (skipped < start) {
              skipped++;
              cursor.continue();
            } else if (blogs.length < pageSize) {
              blogs.push(blog);
              cursor.continue();
            } else resolve({ total, blogs });
          } else cursor.continue();
        } else resolve({ total, blogs });
      };

      request.onerror = () => reject({ total: 0, blogs: [] });
    });
  }

  export async function deleteSingle(id: number) {
    return new Promise<boolean>((resolve, reject) => {
      const store = use().objectStore("blogs");
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(false);
    });
  }

  export async function isStared(id: number, using = use()) {
    return new Promise<boolean>((resolve, reject) => {
      const store = using.objectStore("stars");
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result != undefined);
      request.onerror = () => reject(false);
    });
  }

  export async function star(id: number, enable: boolean) {
    return new Promise<boolean>((resolve, reject) => {
      const store = use().objectStore("stars");
      const request = enable ? store.add({ id: id }) : store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(false);
    });
  }
}
