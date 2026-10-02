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
  const readyRef = useRef(false); // ★ Vditor 异步就绪门闩（after 回调后才 true）
  const onChangeRef = useRef(onChange); // 回调存 ref，不进依赖数组
  const onWordRef = useRef(onWordCount);
  const latestValueRef = useRef(initialValue); // 内部真相源（受控折中）
  const scrollRef = useRef(0); // 滚动位置保持

  onChangeRef.current = onChange;
  onWordRef.current = onWordCount;

  const editorMode = useSettingsStore((s) => s.editorMode);
  const resolvedScheme = useSettingsStore((s) => s.resolvedScheme);
  const fontSize = useSettingsStore((s) => s.fontSize);

  // scheme 存 ref：after 回调异步触发时读最新值（避免闭包捕获 mount 时的旧 scheme）
  const schemeRef = useRef(resolvedScheme);
  schemeRef.current = resolvedScheme;

  // ★ 挂载 effect：依赖 noteId 与 editorMode（换文档/切模式需重建）
  useEffect(() => {
    if (!elRef.current || mountedRef.current) return; // 幂等：已挂载则跳过
    mountedRef.current = true;

    applyEditorFontVar(fontSize);

    // ★★ 实例 DOM 隔离 + 僵尸守卫（debug10 实测根因）：
    //   1) Vditor 构造后 lute 引擎**异步加载**，加载完才触发 after 渲染完整 DOM（含 file input）。
    //   2) StrictMode 下 mount(inst1)→cleanup(inst1)→mount(inst2)。若多实例共享同一 host 元素，
    //      inst1 晚触发的 after 会把 DOM 渲染进共享容器，且 destroy() 会清空整个容器、连带毁掉
    //      inst2 → 僵尸实例 + DOM 互相踩踏（上传命中僵尸 input 读空 getValue → 丢图）。
    //   修法：每个挂载创建**独立子元素** host，Vditor 只渲染进 host；cleanup 时把 host 整个从
    //   文档移除。于是 destroy/remove 只影响本实例子树，僵尸实例即使晚触发也只在**已脱离文档**
    //   的 host 上渲染，绝不出现在活 DOM、更碰不到 inst2。destroyed 标志额外拦截 upload 回调。
    let destroyed = false;
    const host = document.createElement("div");
    host.style.flex = "1";
    host.style.minHeight = "0";
    host.style.display = "flex";
    host.style.flexDirection = "column";
    elRef.current.appendChild(host);

    const vd = new Vditor(host, {
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
        // ★ handler 自己插入正文（Vditor 不用返回值插入，返回 string 会被当错误提示）
        handler: makeUploadHandler(() => noteId, (md) => {
          const vd = vdRef.current;
          if (!vd || !readyRef.current) return; // 僵尸/未就绪实例不处理（见下方 destroyed 守卫）
          // 文件对话框会夺走编辑器焦点，插入前 focus() 恢复选区，避免 insertValue 插错位置
          vd.focus();
          vd.insertValue(md);
          // ★★ insertValue 是程序化 range.insertNode，不产生 DOM input 事件，
          //   Vditor 不会触发 options.input（IR 分支还先置 preventInput=true 再 insert）。
          //   若不手动补发 onChange，「只粘贴图片不打字」就永不自动保存 → 刷新丢图。
          //   又因 IR 折叠图片节点是异步的，同步 getValue() 可能读到插入前状态，
          //   故延迟到 rAF 后（IR 渲染稳定）再取值通知上层。
          requestAnimationFrame(() => {
            if (!vdRef.current || destroyed) return; // 期间已卸载则跳过
            const value = vdRef.current.getValue();
            latestValueRef.current = value;
            scrollRef.current = captureScroll(vdRef.current);
            onChangeRef.current?.(value);
          });
        }),
        accept: "image/*,video/*",
        max: 20 * 1024 * 1024, // 20MB
      },
      fullscreen: { index: 900 }, // ★ z-index 协调，低于 M3E dialog(1000)
      after: () => {
        // ★★ 僵尸实例守卫：若本实例在 lute 异步加载期间已被 cleanup（StrictMode 双挂载），
        //   就地自我销毁并中止渲染，绝不留可交互的僵尸 DOM（含 file input）。
        if (destroyed) {
          try { vd.destroy(); } catch { /* 忽略 */ }
          return;
        }
        // after 回调：lute 异步加载完成，this.vditor 内部对象此刻才就绪
        readyRef.current = true; // ★ 门闩打开：此后 setTheme 等实例方法才可安全调用
        syncVditorTheme(vd, schemeRef.current, CDN_BASE); // 用最新 scheme（非闭包旧值）
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
      destroyed = true; // ★★ 先置僵尸标志：若 lute 尚未加载完，after 回调据此自我销毁
      try {
        scrollRef.current = captureScroll(vd);
        vd.destroy();
      } catch {
        // 已销毁/未就绪则忽略（未就绪时 destroy 无效，由下方移除 host + after 僵尸守卫兜底）
      }
      // ★★ 把本实例的独立 host 整个移出文档：即使 destroy() 对未就绪实例无效、
      //   或 after 晚触发，僵尸 DOM 也只会渲染进这个已脱离文档的节点，绝不出现在活 DOM。
      host.remove();
      vdRef.current = null;
      mountedRef.current = false;
      readyRef.current = false; // ★ 复位门闩：重建后需重新等 after
      releaseBlobUrls(); // 释放 object URL 防泄漏
    };
  }, [noteId, editorMode]); // 换文档/模式才重建

  // 主题变化：不重建，只切 Vditor 主题。
  // ★ 必须等 readyRef（lute 异步就绪）后才调 setTheme，否则 this.vditor 为 undefined 报错；
  //   未就绪时跳过——首屏主题由 after 回调里的 syncVditorTheme 兜底应用。
  useEffect(() => {
    if (vdRef.current && readyRef.current) {
      syncVditorTheme(vdRef.current, resolvedScheme, CDN_BASE);
    }
  }, [resolvedScheme]);

  // 字号变化：注入 CSS 变量
  useEffect(() => {
    applyEditorFontVar(fontSize);
  }, [fontSize]);

  // 受控值：外部 initialValue 变化且与内部不同才回灌。
  // ★ 无论 lute 是否就绪都先同步 latestValueRef（它是「该显示什么」的真相源，
  //   after 回调据此 setValue，避免异步 hydrate 早于就绪时读到旧笔记内容）；
  //   setValue 这个 DOM 调用则 gated 在 readyRef 后，未就绪时由 after 兜底。
  useEffect(() => {
    if (initialValue === latestValueRef.current) return;
    latestValueRef.current = initialValue;
    if (!vdRef.current || !readyRef.current) return; // 未就绪：after 回调会用最新 latestValueRef
    const cur = captureScroll(vdRef.current);
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
