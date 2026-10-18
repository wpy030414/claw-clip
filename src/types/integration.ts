/**
 * 外部集成的共享类型（设置 store / 数据层共用，避免 data 依赖 stores）。
 */

/** 图片上传目标：本地 IndexedDB 附件 / img.scdn.io 图床。 */
export type ImageHostKind = "local" | "scdn";

/** 云同步方向（仅用于展示最近一次操作）。 */
export type SyncDirection = "push" | "pull";
