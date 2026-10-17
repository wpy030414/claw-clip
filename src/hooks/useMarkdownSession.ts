/**
 * useMarkdownSession：编辑会话（加载正文 + 节流自动保存 + 立即保存）。
 *
 * 与旧 Vditor 桥接层的区别：
 * - 正文就是 Markdown 源码，**不做 hydrate/dehydrate 转换**（附件以 clawclip:// 存档，
 *   仅预览/导出时替换成 object URL），因此不存在「渲染态 URL 写进库」的问题。
 * - 卸载时立即把最新内容写回 store（内存真相源），布局切换/切笔记不会丢字。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNotesStore } from "@/stores/notesStore";
import { throttle } from "@/utils/throttle";

const AUTOSAVE_WAIT = 600;

interface Result {
  value: string;
  loading: boolean;
  onChange: (value: string) => void;
  saveNow: () => Promise<void>;
}

export function useMarkdownSession(noteId: string | null): Result {
  const openNote = useNotesStore((s) => s.openNote);
  const saveActive = useNotesStore((s) => s.saveActive);

  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const latestRef = useRef("");
  /** 已成功载入的笔记 id：卸载时只把内容写回同一条笔记，避免串写。 */
  const loadedIdRef = useRef<string | null>(null);

  const throttledSave = useRef(
    throttle(() => {
      void saveActive({ content: latestRef.current });
    }, AUTOSAVE_WAIT),
  ).current;

  useEffect(() => {
    if (!noteId) {
      setValue("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      await openNote(noteId);
      if (cancelled) return;
      const content = useNotesStore.getState().activeNote?.content ?? "";
      loadedIdRef.current = noteId;
      latestRef.current = content;
      setValue(content);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      // 卸载立即落库（内存 + 异步 IDB），避免切笔记/断点切换丢最后一段输入
      throttledSave.cancel();
      if (loadedIdRef.current === noteId) {
        void saveActive({ content: latestRef.current });
      }
      loadedIdRef.current = null;
    };
  }, [noteId, openNote, throttledSave, saveActive]);

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
    await saveActive({ content: latestRef.current });
  }, [throttledSave, saveActive]);

  return { value, loading, onChange, saveNow };
}
