/**
 * 时间格式化（替代旧版 `date.getTime() + 8h` 硬编码东八区的 hack）。
 * 全部用本地时区，符合「本地优先」。
 */

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / 具体日期。 */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 0) return formatDateTime(ts); // 未来时间（时钟偏差）直接显示绝对时间
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day === 1) return "昨天";
  if (day < 7) return `${day} 天前`;
  return formatDate(ts);
}

/** 绝对日期时间：YYYY-MM-DD HH:mm（本地时区）。 */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

/** 绝对日期：YYYY-MM-DD。 */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
