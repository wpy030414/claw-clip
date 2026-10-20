/**
 * 全库搜索面板：M3E 风格的 Spotlight 式命令面板。
 *
 * 形态：
 * - 没有输入时只有一枚 999px 圆角的胶囊输入框；
 * - 输入后下方拉出圆角结果卡，文章为根、命中为叶；
 * - 当前打开的文章永远置顶并默认展开。
 *
 * 交互：
 * - 点击叶子 → 记住精确字符偏移 → 跳转文章 → 编辑器选中并滚动到该位置；
 * - 上下键在可见行之间移动，左右键展开/收起文章，回车触发行；
 * - 点外部或 Esc 关闭。
 *
 * 颜色、圆角与层级走 M3E token；浮层用原生 <dialog>.showModal() 进入
 * top layer，因此不能 portal 到 body（否则脱离 <m3e-theme> 的 CSS 变量作用域），
 * 同时保证能盖在「存储空间 / 主题」等已打开的 M3E modal 之上。
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useUiStore } from "@/stores/uiStore";
import { searchAllNotes, type SearchMatch, type SearchResult } from "@/data/searchAll";
import { flushActiveEditor } from "@/features/editor/activeEditor";
import "./SearchPalette.css";

/** 防抖延迟（ms）。 */
const DEBOUNCE_MS = 150;
/** 最多显示的文章数。 */
const MAX_RESULTS = 50;

/** 树中的可见行：文章根 / 命中叶子。 */
type Row =
  | { type: "article"; key: string; note: SearchResult }
  | { type: "match"; key: string; note: SearchResult; match: SearchMatch };

/**
 * 把文本按关键词切分并高亮（大小写不敏感）。
 *
 * 用 indexOf 而不是正则，避免用户输入里的正则元字符引发异常。
 */
function highlightText(text: string, keyword: string): ReactNode {
  const kw = keyword.trim();
  if (!kw) return text;

  const lowerText = text.toLowerCase();
  const lowerKw = kw.toLowerCase();
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = lowerText.indexOf(lowerKw, cursor);

  while (index >= 0) {
    if (index > cursor) nodes.push(text.slice(cursor, index));
    nodes.push(<mark key={`${index}-${lowerKw}`}>{text.slice(index, index + kw.length)}</mark>);
    cursor = index + kw.length;
    index = lowerText.indexOf(lowerKw, cursor);
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length > 0 ? nodes : text;
}

/** 命中叶子的图标。 */
function matchIcon(match: SearchMatch): string {
  if (match.kind === "title") return "title";
  if (match.kind === "tag") return "label";
  return match.inHeading ? "segment" : "subject";
}

export function SearchPalette() {
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const setSearchJump = useUiStore((s) => s.setSearchJump);
  const navigate = useNavigate();
  const routeMatch = useMatch("/n/:noteId");
  const currentNoteId = routeMatch?.params.noteId ?? null;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  /** 递增令牌：用于丢弃关闭面板后才返回的过期搜索结果。 */
  const searchTokenRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);

  const [query, setQuery] = useState("");
  /** 结果对应的关键词（防抖期间 query 可能已变化，高亮以它为准）。 */
  const [resultQuery, setResultQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const clearTimer = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // 关闭并清理状态
  const close = useCallback(() => {
    searchTokenRef.current += 1;
    clearTimer();
    setOpen(false);
    setQuery("");
    setResultQuery("");
    setResults([]);
    setSearching(false);
    setExpanded(new Set());
    setSelectedIndex(-1);
  }, [clearTimer, setOpen]);

  // 全局 Ctrl/Cmd+F 拦截
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
        if (useUiStore.getState().searchOpen) {
          inputRef.current?.select();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [setOpen]);

  // 组件卸载时清掉未触发的防抖
  useEffect(() => clearTimer, [clearTimer]);

  // 打开时进入 top layer 并自动聚焦输入框
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // 搜索逻辑（防抖）
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const term = e.target.value;
    setQuery(term);

    clearTimer();
    const token = ++searchTokenRef.current;

    if (!term.trim()) {
      setResults([]);
      setResultQuery("");
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceTimerRef.current = window.setTimeout(async () => {
      debounceTimerRef.current = null;
      try {
        // 当前文章可能有尚未落库的输入；先 flush，保证偏移与编辑器正文一致
        await flushActiveEditor().catch(() => undefined);
        const res = await searchAllNotes(term, { currentNoteId });
        if (searchTokenRef.current !== token) return;
        setResults(res.slice(0, MAX_RESULTS));
        setResultQuery(term.trim());
      } catch {
        if (searchTokenRef.current !== token) return;
        setResults([]);
        setResultQuery(term.trim());
      } finally {
        if (searchTokenRef.current === token) setSearching(false);
      }
    }, DEBOUNCE_MS);
  };

  // 新一轮结果：当前文章（若命中）或第一篇默认展开
  useEffect(() => {
    if (results.length === 0) {
      setExpanded(new Set());
      setSelectedIndex(-1);
      return;
    }
    const preferred =
      currentNoteId && results.some((r) => r.id === currentNoteId) ? currentNoteId : results[0].id;
    setExpanded(new Set([preferred]));
    setSelectedIndex(-1);
  }, [results, currentNoteId]);

  // 可见行：文章根 + 已展开文章的命中叶子
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const note of results) {
      out.push({ type: "article", key: `a:${note.id}`, note });
      if (!expanded.has(note.id)) continue;
      note.matches.forEach((match, index) => {
        out.push({ type: "match", key: `m:${note.id}:${index}`, note, match });
      });
    }
    return out;
  }, [results, expanded]);

  const totalMatches = useMemo(
    () => results.reduce((sum, note) => sum + note.matchCount, 0),
    [results],
  );

  // 展开/收起后选中项可能越界，收回最后一行
  useEffect(() => {
    setSelectedIndex((index) => (index >= rows.length ? rows.length - 1 : index));
  }, [rows.length]);

  // 键盘选中项滚动到可视区域
  useEffect(() => {
    if (selectedIndex < 0) return;
    rowRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const toggleArticle = useCallback((noteId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  /** 打开某条命中：先记下精确偏移，再关闭面板并跳转。 */
  const activateMatch = useCallback(
    (note: SearchResult, match: SearchMatch) => {
      const from = match.offset ?? 0;
      // 标题/标签命中没有正文偏移：跳到文章顶部，不选正文
      const to = match.offset === null ? 0 : from + match.length;
      setSearchJump({ noteId: note.id, from, to });
      close();
      navigate(`/n/${note.id}`, { replace: note.id === currentNoteId });
    },
    [close, currentNoteId, navigate, setSearchJump],
  );

  // 键盘导航：焦点始终留在输入框，树行只做可视化选中
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const row = rows[selectedIndex];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, rows.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, -1));
        break;
      case "ArrowRight":
        e.preventDefault();
        if (row?.type === "article") {
          if (!expanded.has(row.note.id)) toggleArticle(row.note.id);
          else if (selectedIndex + 1 < rows.length) setSelectedIndex(selectedIndex + 1);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (row?.type === "match") {
          // 回到父文章根
          for (let i = selectedIndex - 1; i >= 0; i--) {
            if (rows[i].type === "article") {
              setSelectedIndex(i);
              break;
            }
          }
        } else if (row?.type === "article" && expanded.has(row.note.id)) {
          toggleArticle(row.note.id);
        }
        break;
      case "Enter":
        e.preventDefault();
        if (row?.type === "article") toggleArticle(row.note.id);
        else if (row?.type === "match") activateMatch(row.note, row.match);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        // 面板只有输入框一个可聚焦元素，Tab 不应把焦点丢到背景页面
        e.preventDefault();
        break;
    }
  };

  if (!open) return null;

  const trimmedQuery = query.trim();
  const showResults = trimmedQuery.length > 0;
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : undefined;

  return (
    <dialog
      ref={dialogRef}
      className="search-palette-overlay"
      aria-label="全库搜索"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`search-palette${showResults ? " search-palette--expanded" : ""}`}
        data-testid="search-palette"
        onKeyDown={handleKeyDown}
      >
        <div className="search-palette__field">
          <span
            className="material-symbols-outlined search-palette__search-icon"
            aria-hidden="true"
          >
            search
          </span>
          <input
            ref={inputRef}
            type="text"
            className="search-palette__input"
            placeholder="搜索全库文章…"
            aria-label="搜索全库文章"
            role="combobox"
            aria-expanded={showResults}
            aria-autocomplete="list"
            aria-controls={showResults ? "search-palette-results" : undefined}
            aria-activedescendant={
              selectedRow ? `search-palette-row-${selectedRow.key}` : undefined
            }
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={handleInputChange}
          />
          {searching ? (
            <span className="search-palette__spinner" role="status" aria-label="搜索中" />
          ) : results.length > 0 ? (
            <span className="search-palette__count">
              找到 {results.length} 篇 · {totalMatches} 处
            </span>
          ) : null}
        </div>

        {showResults && (
          <div
            className="search-palette__results"
            id="search-palette-results"
            role="tree"
            aria-label="搜索结果"
            data-testid="search-results"
          >
            {searching && results.length === 0 && (
              <div className="search-palette__message" role="status">
                搜索中…
              </div>
            )}

            {!searching && results.length === 0 && (
              <div className="search-palette__message">未找到匹配的文章</div>
            )}

            {rows.map((row, index) => {
              const selected = selectedIndex === index;
              const common = {
                id: `search-palette-row-${row.key}`,
                ref: (el: HTMLDivElement | null) => {
                  rowRefs.current[index] = el;
                },
                "data-selected": selected ? "true" : undefined,
                onMouseDown: (e: ReactMouseEvent) => e.preventDefault(),
              };

              if (row.type === "article") {
                const isExpanded = expanded.has(row.note.id);
                const isCurrent = row.note.id === currentNoteId;
                return (
                  <Fragment key={row.key}>
                    <div
                      {...common}
                      className={`search-palette__row search-palette__article${
                        selected ? " search-palette__row--selected" : ""
                      }`}
                      role="treeitem"
                      aria-level={1}
                      aria-expanded={isExpanded}
                      aria-selected={selected}
                      onClick={() => toggleArticle(row.note.id)}
                    >
                      <span
                        className="material-symbols-outlined search-palette__article-icon"
                        aria-hidden="true"
                      >
                        article
                      </span>
                      <span className="search-palette__article-body">
                        <span className="search-palette__article-title">
                          {highlightText(row.note.title, resultQuery)}
                          {isCurrent && <span className="search-palette__current">当前</span>}
                        </span>
                        <span className="search-palette__article-meta">
                          <span>{row.note.matchCount} 处匹配</span>
                          {row.note.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="search-palette__tag">
                              #{tag}
                            </span>
                          ))}
                        </span>
                      </span>
                      <span
                        className="material-symbols-outlined search-palette__chevron"
                        data-expanded={isExpanded}
                        aria-hidden="true"
                      >
                        expand_more
                      </span>
                    </div>
                  </Fragment>
                );
              }

              return (
                <div
                  key={row.key}
                  {...common}
                  className={`search-palette__row search-palette__match${
                    selected ? " search-palette__row--selected" : ""
                  }`}
                  role="treeitem"
                  aria-level={2}
                  aria-selected={selected}
                  onClick={() => activateMatch(row.note, row.match)}
                >
                  <span
                    className="material-symbols-outlined search-palette__match-icon"
                    aria-hidden="true"
                  >
                    {matchIcon(row.match)}
                  </span>
                  <span className="search-palette__match-text">
                    {row.match.kind === "title" && (
                      <>标题：{highlightText(row.note.title, resultQuery)}</>
                    )}
                    {row.match.kind === "tag" && (
                      <>标签：#{highlightText(row.match.text, resultQuery)}</>
                    )}
                    {row.match.kind === "content" && (
                      <span
                        className="search-palette__snippet"
                        dangerouslySetInnerHTML={{ __html: row.match.snippet }}
                      />
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </dialog>
  );
}
