/**
 * 网络速度估算：滑动窗口内的字节增量 / 时间增量。
 *
 * 上传（XHR upload.onprogress）与下载（ReadableStream）都按块调用 `add()`，
 * 速度取最近 `windowMs` 内的平均，避免单个块抖动导致数字乱跳。
 */
export interface SpeedSample {
  at: number;
  bytes: number;
}

export class SpeedMeter {
  private samples: SpeedSample[] = [];
  private total = 0;

  constructor(private readonly windowMs = 2000) {}

  /** 累加本次新增的字节数，返回当前估算速度（字节/秒）。 */
  add(bytes: number, at = Date.now()): number {
    if (bytes <= 0) return this.speed(at);
    this.total += bytes;
    this.samples.push({ at, bytes: this.total });

    const cutoff = at - this.windowMs;
    while (this.samples.length > 2 && this.samples[0].at < cutoff) this.samples.shift();
    return this.speed(at);
  }

  /** 当前估算速度；样本不足或时间跨度为 0 时返回 0。 */
  speed(at = Date.now()): number {
    // 长时间没有新数据：视为 0，避免限流等待期间一直显示上一个速度
    const latest = this.samples[this.samples.length - 1];
    if (!latest || at - latest.at > this.windowMs) return 0;
    // 让窗口随时间推移自然过期
    while (this.samples.length > 2 && this.samples[0].at < at - this.windowMs) {
      this.samples.shift();
    }
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const seconds = (last.at - first.at) / 1000;
    if (seconds <= 0) return 0;
    return Math.max(0, (last.bytes - first.bytes) / seconds);
  }

  reset(): void {
    this.samples = [];
    this.total = 0;
  }
}
