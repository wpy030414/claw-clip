/**
 * 全局配置。
 *
 * 语义收敛为「纯记事本」：默认本地 IndexedDB，远程数据源仅保留接口形状作可选后端。
 */
export const globalConfig = {
  appName: {
    zh: "鲨鱼夹",
    en: "ClawClip",
  },

  /** IndexedDB 库名。v2 与旧库 "ClawClip" 物理隔离，不写迁移、不动旧数据。 */
  dbName: "claw-clip-v2",
  dbVersion: 2,

  /** true=本地 IndexedDB；false=远程数据源（占位，未实现具体服务）。 */
  enableStoringLocally: true,

  dataSource: {
    addr: "http://localhost:24681/claw-clip",
  },

  storeNames: {
    notes: "notes",
    folders: "folders",
    blobs: "blobs",
    meta: "meta",
  },

  /** 列表分页页容量。 */
  pageSize: 20,
} as const;
