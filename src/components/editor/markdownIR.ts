/**
 * 轻量 IR（Typora-lite）：浏览模式下隐藏 Markdown 标记并渲染样式。
 *
 * 原则：
 * - **不是富文本**：文档仍是同一份 Markdown 源码，只是「光标不在的行」把 `#`/`**`/链接语法
 *   等标记用替换装饰隐藏，并给内容加样式；光标进入某行即还原该行源码，随时可写。
 * - 图片/任务框/无序列表圆点用 widget 呈现，不做双向 DOM→Markdown 转换（避免 roundtrip 丢语法）。
 * - 纯 CodeMirror 6 装饰实现，不新增渲染引擎依赖。
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { resolveBlobUrl, BLOB_URL_SCHEME } from "@/data/blobStore";

class BulletWidget extends WidgetType {
  eq(other: BulletWidget): boolean {
    return other instanceof BulletWidget;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-ir-bullet";
    span.textContent = "•";
    return span;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: TaskWidget): boolean {
    return other.checked === this.checked;
  }
  toDOM(): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.disabled = true;
    box.className = "cm-ir-task";
    return box;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.className = "cm-ir-image";
    img.alt = this.alt;
    img.loading = "lazy";
    if (this.src.startsWith(BLOB_URL_SCHEME)) {
      const id = this.src.slice(BLOB_URL_SCHEME.length);
      void resolveBlobUrl(id).then((url) => {
        if (url && img.isConnected) img.src = url;
      });
    } else {
      img.src = this.src;
    }
    return img;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 把一段文本范围标记为「已消费」，避免多个正则装饰互相重叠。 */
class Mask {
  private readonly cells: Uint8Array;
  constructor(length: number) {
    this.cells = new Uint8Array(length);
  }
  free(from: number, to: number): boolean {
    for (let i = from; i < to; i++) if (this.cells[i]) return false;
    return true;
  }
  take(from: number, to: number): void {
    for (let i = from; i < to; i++) this.cells[i] = 1;
  }
}

function hide(base: number, from: number, to: number, decos: Range<Decoration>[]): void {
  if (to > from) decos.push(Decoration.replace({}).range(base + from, base + to));
}

function inlineDecorations(
  text: string,
  base: number,
  decos: Range<Decoration>[],
): void {
  const mask = new Mask(text.length);

  // 图片：整体替换为图片 widget
  for (const m of text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!mask.free(start, end)) continue;
    mask.take(start, end);
    decos.push(
      Decoration.replace({ widget: new ImageWidget(m[2], m[1]) }).range(
        base + start,
        base + end,
      ),
    );
  }

  // 链接：[文字](url) → 只显示文字并加链接样式
  for (const m of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const start = m.index ?? 0;
    if (start > 0 && text[start - 1] === "!") continue; // 图片已处理
    const textStart = start + 1;
    const textEnd = textStart + m[1].length;
    const end = start + m[0].length;
    if (!mask.free(start, end)) continue;
    mask.take(start, end);
    hide(base, start, textStart, decos);
    hide(base, textEnd, end, decos);
    decos.push(Decoration.mark({ class: "cm-ir-link" }).range(base + textStart, base + textEnd));
  }

  // 行内代码：隐藏反引号
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!mask.free(start, end)) continue;
    mask.take(start, end);
    hide(base, start, start + 1, decos);
    hide(base, end - 1, end, decos);
    decos.push(Decoration.mark({ class: "cm-ir-code" }).range(base + start + 1, base + end - 1));
  }

  // 粗体 **x**
  for (const m of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!mask.free(start, end)) continue;
    mask.take(start, end);
    hide(base, start, start + 2, decos);
    hide(base, end - 2, end, decos);
    decos.push(Decoration.mark({ class: "cm-ir-strong" }).range(base + start + 2, base + end - 2));
  }

  // 删除线 ~~x~~
  for (const m of text.matchAll(/~~([^~\n]+)~~/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!mask.free(start, end)) continue;
    mask.take(start, end);
    hide(base, start, start + 2, decos);
    hide(base, end - 2, end, decos);
    decos.push(Decoration.mark({ class: "cm-ir-strike" }).range(base + start + 2, base + end - 2));
  }

  // 高亮 ==x==
  for (const m of text.matchAll(/==([^=\n]+)==/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!mask.free(start, end)) continue;
    mask.take(start, end);
    hide(base, start, start + 2, decos);
    hide(base, end - 2, end, decos);
    decos.push(Decoration.mark({ class: "cm-ir-mark" }).range(base + start + 2, base + end - 2));
  }

  // 斜体 *x*（避开 ** 与已消费区间）
  for (const m of text.matchAll(/(?<![*\\])\*([^*\n]+)\*(?!\*)/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!mask.free(start, end)) continue;
    mask.take(start, end);
    hide(base, start, start + 1, decos);
    hide(base, end - 1, end, decos);
    decos.push(Decoration.mark({ class: "cm-ir-em" }).range(base + start + 1, base + end - 1));
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const doc = view.state.doc;
  const head = view.state.selection.main.head;
  const seen = new Set<number>();

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (!seen.has(line.from)) {
        seen.add(line.from);
        const text = line.text;
        const base = line.from;
        // 未聚焦时整篇按「浏览」呈现；聚焦后只有光标所在行还原源码（Typora 行为）
        const active = view.hasFocus && head >= base && head <= line.to;

        // —— 行级样式 ——
        const heading = /^(#{1,6})\s+/.exec(text);
        if (heading) {
          decos.push(
            Decoration.line({ class: `cm-ir-h${heading[1].length}` }).range(base),
          );
        }
        if (/^>\s?/.test(text)) {
          decos.push(Decoration.line({ class: "cm-ir-quote" }).range(base));
        }
        const task = /^(\s*)[-*+]\s+\[([ xX])\]\s+/.exec(text);
        const bullet = /^(\s*)[-*+]\s+/.exec(text);
        if (task) {
          decos.push(Decoration.line({ class: "cm-ir-list cm-ir-task-line" }).range(base));
        } else if (bullet) {
          decos.push(Decoration.line({ class: "cm-ir-list" }).range(base));
        }

        if (!active) {
          // —— 隐藏块级标记 ——
          if (heading) hide(base, 0, heading[0].length, decos);
          const quote = /^>\s?/.exec(text);
          if (quote) hide(base, 0, quote[0].length, decos);

          if (task) {
            const indent = task[1].length;
            decos.push(
              Decoration.replace({ widget: new TaskWidget(task[2].toLowerCase() === "x") }).range(
                base + indent,
                base + task[0].length,
              ),
            );
          } else if (bullet) {
            const indent = bullet[1].length;
            decos.push(
              Decoration.replace({ widget: new BulletWidget() }).range(
                base + indent,
                base + indent + 2,
              ),
            );
          }

          // —— 行内标记 ——
          inlineDecorations(text, base, decos);
        }

        pos = line.to + 1;
      } else {
        pos = line.to + 1;
      }
    }
  }

  return Decoration.set(decos, true);
}

/** 浏览模式（轻量 IR）扩展。 */
export const markdownIRExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
