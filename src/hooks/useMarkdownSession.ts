/**
 * useMarkdownSession：编辑会话（加载正文 + 节流自动保存 + 立即保存）。
 *
 * 与旧 Vditor 桥接层的区别：
 * - 自动保存为纯 trailing 防抖，用户无需（也无法）手动接管
 * - 正文就是 Markdown 源码，**不做 hydrate/dehydrate 转换**（附件以 clawclip:// 存档，
 *   仅预览/导出时替换成 object URL），因此不存在「渲染态 URL 写进库」的问题。
 * - 卸载时立即把最新内容写回 store（内存真相源），布局切换/切笔记不会丢字。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNotesStore } from "@/stores/notesStore";
import { debounce } from "@/utils/throttle";

const AUTOSAVE_WAIT = 700;

interface Result {
  value: string;
  loading: boolean;
  onChange: (value: string) => void;
  saveNow: () => Promise<void>;
}

export function useMarkdownSession(noteId: string | null): Result {
  const openNote = useNotesStore((s) => s.openNote);
  const saveNote = useNotesStore((s) => s.saveNote);

  const [value, setValue] = useState("");
  /** 已完成载入的笔记 id：只有它等于当前 noteId 才允许渲染编辑器。 */
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const latestRef = useRef("");
  /** 已成功载入的笔记 id：保存时只写回同一条笔记，避免切笔记后串写。 */
  const loadedIdRef = useRef<string | null>(null);
  /**
   * 本会话绑定的笔记 id（EditorPane 以 key={noteId} 重挂载，实例与笔记一一对应）。
   * 防抖回调必须用它而不是 store 的 activeNote——切笔记后 activeNote 已经变了。
   */
  const sessionIdRef = useRef<string | null>(noteId);
  sessionIdRef.current = noteId;

  // 纯防抖：连续输入期间不写库，停下来 700ms 才写一次；无手动保存入口
  const throttledSave = useRef(
    debounce(() => {
      const id = sessionIdRef.current;
      if (id && loadedIdRef.current === id) {
        void saveNote(id, { content: latestRef.current });
      }
    }, AUTOSAVE_WAIT),
  ).current;

  useEffect(() => {
    if (!noteId) {
      setValue("");
      setLoadedId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      await openNote(noteId);
      if (cancelled) return;
      const content = useNotesStore.getState().activeNote?.content ?? "";
      loadedIdRef.current = noteId;
      latestRef.current = content;
      setValue(content);
      setLoadedId(noteId);
    })();

    return () => {
      cancelled = true;
      // 卸载立即落库（内存 + 异步 IDB），避免切笔记/断点切换丢最后一段输入
      throttledSave.cancel();
      if (loadedIdRef.current === noteId) {
        void saveNote(noteId, { content: latestRef.current });
      }
      loadedIdRef.current = null;
    };
  }, [noteId, openNote, throttledSave, saveNote]);

  const onChange = useCallback(
    (next: string) => {
      latestRef.current = next;
      setValue(next);
      throttledSave();
    },
    [throttledSave],
  );

  const saveNow = useCallback(async () => {
    throttledSave.cancel();
    const id = sessionIdRef.current;
    if (id) await saveNote(id, { content: latestRef.current });
  }, [throttledSave, saveNote]);

  // ★ 由 noteId / loadedId 派生 loading，而不是命令式 setLoading：
  //   openNote 命中缓存时两次 setState 可能被 React 合并，中间「loading=true」的渲染
  //   会被跳过，导致编辑器以空文档挂载后永不回灌（半受控编辑器没有 value→doc 回流）。
  const loading = noteId !== null && loadedId !== noteId;

  return { value, loading, onChange, saveNow };
}
