/**
 * 图床设置：图片上传目标（本地 IndexedDB / img.scdn.io）。
 *
 * 只影响**之后**粘贴/拖入的图片；已有附件与外链不迁移。
 */
import { formatBytes } from "@/data/stats";
import { useIntegrationStore } from "@/stores/integrationStore";
import type { ImageHostKind } from "@/types/integration";

const OPTIONS: Array<{ kind: ImageHostKind; icon: string; title: string; desc: string }> = [
  {
    kind: "local",
    icon: "database",
    title: "本地 IndexedDB（默认）",
    desc: "随笔记保存，参与本地备份与云快照；删除笔记时按引用计数回收。",
  },
  {
    kind: "scdn",
    icon: "cloud_upload",
    title: "img.scdn.io 图床",
    desc: "上传后正文写外链，不占本地空间；图片公开可读，60 天无人访问会被自动删除。",
  },
];

export function ImageHostSection() {
  const imageHost = useIntegrationStore((s) => s.imageHost);
  const count = useIntegrationStore((s) => s.imageHostCount);
  const bytes = useIntegrationStore((s) => s.imageHostBytes);
  const setImageHost = useIntegrationStore((s) => s.setImageHost);

  return (
    <section className="storage-section" data-testid="storage-image">
      <h3 className="storage-section-title">
        <span className="material-symbols-outlined" aria-hidden="true">
          image
        </span>
        图片上传目标
      </h3>

      <div className="storage-section">
        {OPTIONS.map((option) => (
          <button
            key={option.kind}
            type="button"
            className="storage-radio-card"
            data-active={imageHost === option.kind ? "true" : "false"}
            data-testid={`storage-image-host-${option.kind}`}
            onClick={() => setImageHost(option.kind)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {option.icon}
            </span>
            <span className="storage-radio-text">
              <strong>{option.title}</strong>
              <span>{option.desc}</span>
            </span>
          </button>
        ))}
      </div>

      {imageHost === "scdn" && (
        <div className="storage-warning" data-testid="storage-image-warning">
          <span className="material-symbols-outlined" aria-hidden="true">
            warning
          </span>
          <span>
            图床会在图片 60 天无人访问后自动删除；外链不参与本地引用计数，删除笔记不会删除远端图片，
            也不会进入本地备份或云快照。重要图片建议保留在本地。
          </span>
        </div>
      )}

      <p className="storage-hint">
        本机累计上传：{count} 张 · {formatBytes(bytes)}。仅统计开启图床后上传成功的图片。
      </p>
      <p className="storage-hint">
        提示：导出 HTML/PDF 时会尝试把外链图片内联为 data URL；若 CDN 不允许跨域读取，
        导出文件会保留外链（需要联网查看）。DOCX 导出会跳过无法下载的外链图片。
      </p>
    </section>
  );
}
