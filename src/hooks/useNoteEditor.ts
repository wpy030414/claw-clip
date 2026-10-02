/**
 * useNoteEditor：编辑会话桥接层（S4 核心）。
 *
 * 打通「Vditor 编辑器」与「notesStore 数据层」，处理两种 content 形态的双向转换：
 * - **存储态**（IndexedDB / activeNote.content）：clawclip://blob/<id> 真相源，可持久化
 * - **渲染态**（Vditor 显示）：object URL（blob:mock/...），运行时产物、刷新即失效
 *
 * 转换链：
 * - 载入编辑器（hydrate）：存储态 → 渲染态（clawclip:// 换成 object URL）
 * - 保存落库（dehydrate）：渲染态 → 存储态（object URL 换回 clawclip://，防止把 blob: URL 存进库）
 *
 * 自动保存：input → 节流 800ms → saveActive；失焦/切笔记/Cmd+S 立即 flush。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNotesStore } from "@/stores/notesStore";
import { dehydrateMarkdown, hydrateMarkdown, releaseBlobUrls } from "@/data/blobStore";
import { throttle } from "@/utils/throttle";

const AUTOSAVE_WAIT = 800;

interface UseNoteEditorResult {
  /** 喂给 VditorEditor 的 initialValue（已 hydrate 的渲染态）。 */
  editorValue: string;
  /** 正在载入（hydrate 中）。 */
  loading: boolean;
  /** Vditor input 回调：节流自动保存。 */
  handleChange: (renderedContent: string) => void;
  /** 立即保存（Cmd+S / 失焦 / 切笔记前 flush）。 */
  saveNow: () => Promise<void>;
}

/**
 * 打开一条笔记进入编辑态：hydrate content 供 Vditor 显示，并注册自动保存。
 * @param noteId 要编辑的笔记 id（null 则不载入）
 */
export function useNoteEditor(noteId: string | null): UseNoteEditorResult {
  const openNote = useNotesStore((s) => s.openNote);
  const saveActive = useNotesStore((s) => s.saveActive);

  const [editorValue, setEditorValue] = useState("");
  const [loading, setLoading] = useState(false);

  // 节流自动保存：input 后 800ms 存一次（dehydrate 回存储态）
  const throttledSave = useRef(
    throttle((rendered: string) => {
      void saveActive({ content: dehydrateMarkdown(rendered) });
    }, AUTOSAVE_WAIT),
  ).current;

  // 记录最新渲染态 content，供 flush/saveNow 用
  const latestRenderedRef = useRef("");

  // 载入笔记：取存储态 → hydrate 成渲染态（resolveBlobUrl 内部自动登记反向映射）
  useEffect(() => {
    if (!noteId) {
      setEditorValue("");
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      await openNote(noteId);
      // openNote 后 activeNote.content 是存储态（clawclip://），需 hydrate
      const stored = useNotesStore.getState().activeNote?.content ?? "";

      // hydrateMarkdown 内部调 resolveBlobUrl，自动登记 url→id 反向映射
      const rendered = await hydrateMarkdown(stored);
      if (!cancelled) {
        latestRenderedRef.current = rendered;
        setEditorValue(rendered);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // 切笔记/卸载：释放 object URL 防泄漏（同时清空双向映射），flush 未保存内容
      throttledSave.flush();
      releaseBlobUrls();
    };
  }, [noteId, openNote, throttledSave]);

  const handleChange = useCallback(
    (renderedContent: string) => {
      latestRenderedRef.current = renderedContent;
      throttledSave(renderedContent); // 节流自动保存
    },
    [throttledSave],
  );

  const saveNow = useCallback(async () => {
    throttledSave.cancel(); // 取消挂起的节流调用，改为立即存
    const rendered = latestRenderedRef.current;
    await saveActive({ content: dehydrateMarkdown(rendered) });
  }, [throttledSave, saveActive]);

  // activeNote 变化（如外部 saveActive 后）不直接回灌 editorValue，
  // 避免打断输入；editorValue 只在切笔记时重置。

  return { editorValue, loading, handleChange, saveNow };
}
