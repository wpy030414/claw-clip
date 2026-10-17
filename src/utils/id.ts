/**
 * id 生成：包装 crypto.randomUUID()。
 *
 * UUID v4 作笔记/附件主键（不再用时间戳当 id —— 旧版 Blog 的 id=Date.now()
 * 导致「编辑=删旧建新」的语义 bug）。
 */

/** 时间戳前缀长度控制：降级 id 依然全局基本唯一且可按字典序粗略排序 */
function fallbackId(): string {
  // 降级方案：毫秒时间戳(36 进制) + 随机串。非标准 UUID，仅作兜底。
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** 生成新 id。crypto.randomUUID 不可用（旧浏览器/非安全上下文）时降级为时间戳+随机串。 */
export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // 某些环境访问 crypto 属性本身可能抛错，吞掉走降级
  }
  return fallbackId();
}
