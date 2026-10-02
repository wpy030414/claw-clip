/**
 * Vditor 命令式封装为 React 组件（S2 核心，最高风险最高价值文件）。
 *
 * 处理全部已验证坑（方案 §5.5）：
 * 1. StrictMode 双挂载幂等：mountedRef 守卫 + cleanup destroy() + 复位
 * 2. cache.id：传 HTMLElement 时必设，隔离多笔记草稿缓存（Vditor 官方注释明写「第一参数为元素且启用缓存时必填」）
 * 3. 自托管 cdn：options.cdn / hint.emojiPath 指向 public/vditor，离线不依赖 unpkg
 * 4. 受控折中：内部 latestValueRef 为真相源，onChange 只通知（供自动保存），initialValue 仅切笔记时 setValue + 复原光标
 * 5. upload.handler：拦截图片/视频 → 写 IndexedDB blob → 返回 clawclip:// 引用
 * 6. fullscreen.index=900：与 M3E dialog(1000)/snackbar(1100) 协调 z-index
 *
 * 回调存 ref 不进依赖数组，避免父重渲染反复销毁重建编辑器。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import Vditor from "vditor";
import "vditor/dist/index.css";
import "@/styles/vditor-theme.css";
import { makeUploadHandler } from "@/hooks/useAttachment";
import { applyEditorFontVar, syncVditorTheme } from "./useVditorTheme";
import { useSettingsStore } from "@/stores/settingsStore";
import { releaseBlobUrls } from "@/data/blobStore";

/** Vditor 资源本地基址：base(/claw-clip/) + vditor → /claw-clip/vditor */
const CDN_BASE = `${import.meta.env.BASE_URL}vditor`.replace(/\/+/g, "/");

/** 命令式 API 暴露给上层（快捷键层、自动保存层）。 */
export interface VditorEditorHandle {
  getValue: () => string;
  setValue: (md: string, clearStack?: boolean) => void;
  insertValue: (v: string) => void;
  focus: () => void;
  getSelection: () => string;
  getInstance: () => Vditor | null;
  getCurrentMode: () => "sv" | "wysiwyg" | "ir" | null;
}

interface Props {
  /** 笔记 id，用作 cache.id 隔离多文档缓存。 */
  noteId: string;
  /** 初始值（已 hydrate 过附件 URL 的 markdown）。仅切笔记时回灌。 */
  initialValue: string;
  /** 输入变化回调，上层接自动保存（本组件不节流，节流在 useAutoSave）。 */
  onChange?: (value: string) => void;
  /** 字数统计回调（Vditor counter.after）。 */
  onWordCount?: (n: number) => void;
  className?: string;
  height?: string | number;
}

export const VditorEditor = forwardRef<VditorEditorHandle, Props>(function VditorEditor(
  { noteId, initialValue, onChange, onWordCount, className, height = "100%" },
  ref,
) {
  const elRef = useRef<HTMLDivElement>(null);
  const vdRef = useRef<Vditor | null>(null);
  const mountedRef = useRef(false); // ★ StrictMode 幂等守卫
  const onChangeRef = useRef(onChange); // 回调存 ref，不进依赖数组
  const onWordRef = useRef(onWordCount);
  const latestValueRef = useRef(initialValue); // 内部真相源（受控折中）
  const scrollRef = useRef(0); // 滚动位置保持

  onChangeRef.current = onChange;
  onWordRef.current = onWordCount;

  const editorMode = useSettingsStore((s) => s.editorMode);
  const resolvedScheme = useSettingsStore((s) => s.resolvedScheme);
  const fontSize = useSettingsStore((s) => s.fontSize);

  // ★ 挂载 effect：依赖 noteId 与 editorMode（换文档/切模式需重建）
  useEffect(() => {
    if (!elRef.current || mountedRef.current) return; // 幂等：已挂载则跳过
    mountedRef.current = true;

    applyEditorFontVar(fontSize); // 注入 --editor-font-size 供 vditor-theme.css 消费

    const vd = new Vditor(elRef.current, {
      mode: editorMode, // 'ir' 默认，对齐 Typora 即时渲染
      height,
      value: latestValueRef.current,
      placeholder: "记录新鲜事…",
      lang: "zh_CN",
      cache: {
        id: `claw-clip-${noteId}`, // ★ 传元素必设，隔离多笔记草稿缓存
        enable: true,
      },
      cdn: CDN_BASE, // ★ 自托管，覆盖默认 unpkg
      typewriterMode: true, // 打字机模式（对齐 Typora）
      theme: resolvedScheme === "dark" ? "dark" : "classic", // 主体主题初始值
      icon: "material", // 图标风格对齐 M3E
      preview: {
        theme: {
          current: resolvedScheme === "dark" ? "dark" : "light",
          path: `${CDN_BASE}/dist/css/content-theme`, // 内容主题本地
        },
        hljs: { lineNumber: false, style: resolvedScheme === "dark" ? "native" : "github" },
        markdown: { toc: false, autoSpace: true, fixTermTypo: true }, // 中西文自动空格、术语纠正
      },
      hint: {
        emojiPath: `${CDN_BASE}/dist/images/emoji`, // ★ 唯一硬编码 CDN 的项，必须显式设本地
        emoji: { ":+1:": "👍", ":-1:": "👎", ":smile:": "😄" },
      },
      counter: {
        enable: true,
        type: "text",
        after: (len: number) => onWordRef.current?.(len),
      },
      outline: { enable: true, position: "right" }, // 方案 B：保留 Vditor 内置大纲
      toolbar: [
        "headings", "bold", "italic", "strike", "link", "list", "ordered-list", "check",
        "quote", "code", "inline-code", "table", "upload", "|",
        "edit-mode", "outline", "preview", "fullscreen", "export",
      ],
      upload: {
        handler: makeUploadHandler(() => noteId), // ★ 拦截图片/视频写 IndexedDB
        accept: "image/*,video/*",
        max: 20 * 1024 * 1024, // 20MB
      },
      fullscreen: { index: 900 }, // ★ z-index 协调，低于 M3E dialog(1000)
      after: () => {
        // after 回调：Vditor DOM 就绪
        syncVditorTheme(vd, resolvedScheme, CDN_BASE); // 应用主题（含代码高亮/内容主题）
        vd.setValue(latestValueRef.current); // 确保初值（cache 命中时覆盖）
        restoreScroll(vd, scrollRef.current);
      },
      input: (value: string) => {
        latestValueRef.current = value;
        scrollRef.current = captureScroll(vd);
        onChangeRef.current?.(value); // 通知上层（自动保存在 useAutoSave 节流）
      },
      blur: () => {
        scrollRef.current = captureScroll(vd);
      },
    });

    vdRef.current = vd;

    return () => {
      // ★ cleanup：destroy + 复位守卫（StrictMode mount→unmount→remount 安全）
      try {
        scrollRef.current = captureScroll(vd);
        vd.destroy();
      } catch {
        // 已销毁则忽略
      }
      vdRef.current = null;
      mountedRef.current = false;
      releaseBlobUrls(); // 释放 object URL 防泄漏
    };
  }, [noteId, editorMode]); // 换文档/模式才重建

  // 主题变化：不重建，只切 Vditor 主题
  useEffect(() => {
    if (vdRef.current) syncVditorTheme(vdRef.current, resolvedScheme, CDN_BASE);
  }, [resolvedScheme]);

  // 字号变化：注入 CSS 变量
  useEffect(() => {
    applyEditorFontVar(fontSize);
  }, [fontSize]);

  // 受控值：外部 initialValue 变化且与内部不同才 setValue（仅切笔记），避免打断输入
  useEffect(() => {
    if (!vdRef.current || initialValue === latestValueRef.current) return;
    const cur = captureScroll(vdRef.current);
    latestValueRef.current = initialValue;
    vdRef.current.setValue(initialValue);
    restoreScroll(vdRef.current, cur);
  }, [initialValue]);

  // 暴露命令式 API（快捷键层、自动保存层调用）
  useImperativeHandle(
    ref,
    () => ({
      getValue: () => vdRef.current?.getValue() ?? "",
      setValue: (md, clearStack) => {
        latestValueRef.current = md;
        vdRef.current?.setValue(md, clearStack);
      },
      insertValue: (v) => vdRef.current?.insertValue(v),
      focus: () => vdRef.current?.focus(),
      getSelection: () => vdRef.current?.getSelection() ?? "",
      getInstance: () => vdRef.current,
      getCurrentMode: () => vdRef.current?.getCurrentMode() ?? null,
    }),
    [],
  );

  return <div ref={elRef} className={className} data-testid="vditor-root" />;
});

/** 捕获滚动位置（切主题/setValue 后复原，避免跳动）。 */
function captureScroll(vd: Vditor | null): number {
  if (!vd) return 0;
  try {
    const scroller = document.querySelector(".vditor-content") as HTMLElement | null;
    return scroller?.scrollTop ?? 0;
  } catch {
    return 0;
  }
}

function restoreScroll(vd: Vditor | null, top: number) {
  if (!vd || !top) return;
  try {
    const scroller = document.querySelector(".vditor-content") as HTMLElement | null;
    if (scroller) scroller.scrollTop = top;
  } catch {
    // 忽略
  }
}
