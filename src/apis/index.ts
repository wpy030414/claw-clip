import type { Blog } from "@/types/Blog";

export namespace IDB {
  const DB_NAME = "local-zone";
  const STORE_NAME = "blog";
  const DB_VERSION = 1;

  function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, {
            keyPath: "id",
          });
        }
      };

      request.onsuccess = (event: Event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event: Event) => {
        reject("Database error: " + (event.target as IDBOpenDBRequest).error);
      };
    });
  }

  export function add(blog: Blog): Promise<string> {
    return new Promise((resolve, reject) => {
      openDatabase()
        .then((db) => {
          const transaction = db.transaction([STORE_NAME], "readwrite");
          const store = transaction.objectStore(STORE_NAME);
          const request = store.add(JSON.stringify(blog), blog.id);

          request.onsuccess = () => {
            resolve("Data saved successfully.");
          };

          request.onerror = (event: Event) => {
            reject("Data save error: " + (event.target as IDBRequest).error);
          };
        })
        .catch(reject);
    });
  }

  export function remove(blog: Blog): Promise<string> {
    return new Promise((resolve, reject) => {
      openDatabase()
        .then((db) => {
          const transaction = db.transaction([STORE_NAME], "readwrite");
          const store = transaction.objectStore(STORE_NAME);
          const request = store.delete(blog.id);

          request.onsuccess = () => {
            resolve("Data removed successfully.");
          };

          request.onerror = (event: Event) => {
            reject("Data remove error: " + (event.target as IDBRequest).error);
          };
        })
        .catch(reject);
    });
  }

  export function queryAll(): Promise<Blog[]> {
    return new Promise((resolve, reject) => {
      openDatabase()
        .then((db) => {
          const transaction = db.transaction([STORE_NAME], "readonly");
          const store = transaction.objectStore(STORE_NAME);
          const request = store.getAll();

          request.onsuccess = (event: Event) => {
            const blogs: Blog[] = (event.target as IDBRequest).result;
            resolve(blogs.map((blog: any) => JSON.parse(blog)).reverse());
          };

          request.onerror = (event: Event) => {
            reject(
              "Data retrieval error: " + (event.target as IDBRequest).error,
            );
          };
        })
        .catch(reject);
    });
  }
}
