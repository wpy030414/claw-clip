/**
 * MarkdownToolbar：参考 markdownassistant 的格式工具栏。
 *
 * 只发出命令（MarkdownCommand），由编辑器执行；不持有文档状态。
 * 图标用自托管 Material Symbols，按钮是原生 button（避免 M3E 按钮在紧凑工具栏里的尺寸约束）。
 */
import type { MarkdownCommand } from "./markdownCommands";

interface Item {
  command: MarkdownCommand;
  label: string;
  icon?: string;
  text?: string;
}

const GROUPS: Item[][] = [
  [
    { command: "h1", label: "一级标题", text: "H1" },
    { command: "h2", label: "二级标题", text: "H2" },
    { command: "h3", label: "三级标题", text: "H3" },
  ],
  [
    { command: "bold", label: "加粗 (Ctrl/Cmd+B)", icon: "format_bold" },
    { command: "italic", label: "斜体 (Ctrl/Cmd+I)", icon: "format_italic" },
    { command: "strike", label: "删除线", icon: "strikethrough_s" },
    { command: "inlineCode", label: "行内代码", icon: "code" },
  ],
  [
    { command: "quote", label: "引用", icon: "format_quote" },
    { command: "ul", label: "无序列表", icon: "format_list_bulleted" },
    { command: "ol", label: "有序列表", icon: "format_list_numbered" },
    { command: "task", label: "任务清单", icon: "checklist" },
  ],
  [
    { command: "codeBlock", label: "代码块", icon: "data_object" },
    { command: "link", label: "链接", icon: "link" },
    { command: "image", label: "图片", icon: "image" },
    { command: "table", label: "表格", icon: "table" },
    { command: "math", label: "行内公式", icon: "functions" },
    { command: "mathBlock", label: "块级公式", icon: "superscript" },
    { command: "hr", label: "分隔线", icon: "horizontal_rule" },
  ],
];

interface Props {
  onCommand: (command: MarkdownCommand) => void;
}

export function MarkdownToolbar({ onCommand }: Props) {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Markdown 格式工具栏" data-testid="md-toolbar">
      {GROUPS.map((group, gi) => (
        <div className="editor-toolbar-group" key={gi}>
          {group.map((item) => (
            <button
              key={item.command}
              type="button"
              className="editor-tool-btn"
              data-testid={`cmd-${item.command}`}
              title={item.label}
              aria-label={item.label}
              // 保持编辑器选区：点击工具栏不抢焦点
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCommand(item.command)}
            >
              {item.text ?? (
                <span className="material-symbols-outlined" aria-hidden="true">
                  {item.icon}
                </span>
              )}
            </button>
          ))}
          {gi < GROUPS.length - 1 && <span className="editor-toolbar-sep" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}
