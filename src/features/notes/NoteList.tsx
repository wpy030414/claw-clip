/**
 * NoteList：笔记列表（桌面 compact / 移动 card 两种变体）。
 *
 * 只消费轻量投影 NoteSummary（不含 content），列表页不把正文读进内存。
 * 收藏按钮 stopPropagation，避免点星误触发「打开笔记」。
 */
import type { NoteSummary } from "@/types/note";
import { relativeTime } from "@/utils/time";

export type NoteListVariant = "compact" | "card";

interface Props {
  items: NoteSummary[];
  variant?: NoteListVariant;
  activeId?: string | null;
  onSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
  emptyText?: string;
}

export function NoteList({
  items,
  variant = "compact",
  activeId = null,
  onSelect,
  onToggleStar,
  emptyText,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="note-list-empty" data-testid="note-list-empty">
        {emptyText ?? "还没有笔记"}
      </div>
    );
  }

  return (
    <div className={`note-list note-list--${variant}`} data-testid="note-list">
      {items.map((n) => (
        <div
          key={n.id}
          className="note-item"
          data-testid={`note-link-${n.id}`}
          data-active={activeId === n.id ? "true" : "false"}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(n.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(n.id);
            }
          }}
        >
          <div className="note-item-main">
            <div className="note-item-title-row">
              {n.pinned && (
                <span className="material-symbols-outlined note-item-pin" aria-label="已置顶">
                  push_pin
                </span>
              )}
              <span className="note-item-title">{n.title || "无标题"}</span>
            </div>
            {n.excerpt && <div className="note-item-excerpt">{n.excerpt}</div>}
            <div className="note-item-meta">
              <span>{relativeTime(n.updatedAt)}</span>
              <span aria-hidden="true">·</span>
              <span>{n.wordCount} 字</span>
              {n.tags.length > 0 && (
                <span className="note-item-tags">
                  {n.tags.slice(0, 3).map((t) => `#${t}`).join(" ")}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="note-item-star"
            data-testid={`btn-star-${n.id}`}
            data-starred={n.starred ? "true" : "false"}
            aria-label={n.starred ? "取消收藏" : "收藏"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar(n.id);
            }}
          >
            <span className="material-symbols-outlined">
              {n.starred ? "star" : "star_border"}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
