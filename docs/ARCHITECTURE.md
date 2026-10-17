# 架构文档（ARCHITECTURE）

> 鲨鱼夹 ClawClip —— 本地优先的 Markdown 工作站：文件夹树、扩展语法、可配置印刷主题、MD/DOCX/PDF 互导。
> Vite 8 + React 19.3 + TypeScript 5.9 + @m3e/react（Material 3 Web Components）+ CodeMirror 6（源码编辑）+ markdown-it（实时预览/打印/导出渲染）+ Zustand + IndexedDB。
>
> 编辑工作区对标 markdownassistant：**左源码 + 右实时预览 + 格式工具栏**，三态视图（编辑 / 分屏 / 预览）。
>
> 关键决策的「为什么」见 [DECISIONS.md](./DECISIONS.md)；本文件讲「是什么、怎么连」。

## 1. 分层总览

```
┌─────────────────────────────────────────────────────────────┐
│  pages/         路由薄壳（Notes/Editor）                      │  ← react-router data router
├─────────────────────────────────────────────────────────────┤
│  layouts/       响应式双形态外壳（AppShell→Desktop/Mobile）    │  ← 断点分派，只组合不写业务
├─────────────────────────────────────────────────────────────┤
│  features/      业务域（notes/folders/editor/preview）        │  ← 各自处理双形态表现分叉
├─────────────────────────────────────────────────────────────┤
│  components/    展示原子 + M3E 薄封装 + MarkdownEditor★       │  ← 无业务；编辑器是命令式封装
├─────────────────────────────────────────────────────────────┤
│  hooks/         业务逻辑（useMarkdownSession/useRenderedMarkdown）│ ← 双形态共享；编排 store
├─────────────────────────────────────────────────────────────┤
│  stores/        Zustand（notes/settings/ui）                  │  ← 状态真相源；notesStore 唯一碰 datasource
├─────────────────────────────────────────────────────────────┤
│  data/          数据访问层（datasource→local/remote）+ exchange│ ← 纯 TS 零 React，可单测
├─────────────────────────────────────────────────────────────┤
│  IndexedDB (claw-clip-v2)  notes / folders / blobs / meta     │  ← 本地持久化
└─────────────────────────────────────────────────────────────┘
   types/  utils/  config.ts  styles/  横跨各层
```

**依赖方向**：上层依赖下层，下层不知道上层。`data/ stores/ hooks/ utils/` **零 React 组件依赖**（hooks 用 React API 但不渲染 UI），可被 Vitest 直接单测，且被桌面/移动两套布局共享。

## 2. 数据流

### 编辑 → 落库
```
用户输入 → CodeMirror 6 updateListener（docChanged）
  → useMarkdownSession.onChange
  → debounce(700ms) → notesStore.saveActive
  → 重算派生字段（title/wordCount/excerpt/attachmentIds）
  → noteCache 同步更新（内存真相源）→ datasource.upsertNote → IndexedDB put（原地更新，不改 id）
```

### 打开 → 编辑
```
notesStore.openNote(id)
  → 优先读内存 noteCache（避免「卸载 flush 未落库 → 新实例读 IDB 旧值」竞态）
  → 未命中再读 IndexedDB
  → EditorPane 以 key={noteId} 挂载 MarkdownEditor，value 只作为初始文档
```

**编辑器是半受控的**：文档真相源在 `EditorView` 内，父级 `value` 只用于挂载/切换文档。
不做 value→doc 回流——实测回流会打断 CJK 组合输入，导致字符乱序（见 ADR-016）。

### 附件
```
选择文件 / 粘贴 / 拖入
  → saveBlob(noteId, file) → IndexedDB blobs 表 → blobId
  → 在光标处插入 ![name](clawclip://blob/<id>)
  → 正文（存储态）始终保存 clawclip:// 引用，永不落 blob: URL
```

### 实时预览 / 打印
```
Markdown 源码 → debounce(120ms) → hydrateMarkdown(clawclip:// → object URL)
  → markdown-it（html:false + GFM/脚注/定义列表/上下标/高亮/KaTeX + highlight.js）
  → HTML → 右侧预览区 / 打印根（#print-root）
```
预览区在「分屏 / 预览」视图启用；「仅编辑」视图下不渲染，导出 HTML/DOCX 时按需渲染一次（`renderForExport`）。
预览与打印**共用同一份 HTML**，因此「预览所见 = 打印所得」；打印根在屏幕上移出视口，
`@media print` 时占据整页，用户通过系统「另存为 PDF」完成 PDF 导出。

### 导入 / 导出
```
导出 MD   → 正文原文下载
导出 HTML → 预览 CSS + 代码高亮样式内嵌为单文件（公式走原生 MathML）
导出 DOCX → 渲染 HTML → DOMParser → docx 库（标题/段落/列表/表格/代码/图片）
导出 PDF  → 打印根 + 系统打印对话框
导入 MD   → File.text()
导入 DOCX → mammoth（docx→HTML）→ turndown(+gfm) → Markdown
导入 PDF  → pdf.js 抽文本 → 按字号/行距启发式重建标题与段落
```

## 3. 响应式双形态

单一 data router，`/n/:noteId` 表达「选中笔记」。`AppShell` 用 `useIsDesktop()`（`(min-width:900px)`）分派：

| | 桌面工作台（≥900px） | 移动端（<900px） |
|---|---|---|
| 导航 | **可收侧栏**：品牌行 → 等宽页签 → 行级「新建」→ 文件夹/笔记树 | 无导航栏（仅笔记一个目的地） |
| 主区 | **编辑工作区**：编辑 / 分屏 / 预览三态；默认分屏 | 笔记树 or 全屏编辑器（有 noteId 则全屏）；split 退化为编辑 |
| 列表 | 侧栏内**文件夹 + 笔记统一树**（`NoteTree`） | 同一棵 `NoteTree` |
| 大纲 | 侧栏「大纲」页签 | 编辑器内（暂不提供） |
| 返回 | 无需（侧栏常驻） | `EditorPane onBack` 回列表 |

**侧栏开关**：`DesktopLayout` 在主内容左上角渲染一个 `main-sidebar-toggle`
（`data-testid` 随状态切换 `btn-sidebar-close` / `btn-sidebar-open`）；
`Sidebar` 自身只在打开时渲染，不再内置收起按钮。顶部品牌行由三部分组成：左侧网站
logo（`public/favicon.ico`，24px；暗色主题用 `filter: invert(1)` 反相）、等宽字体的
`ClawClip` 标题、右侧 GitHub 图标（外链 `globalConfig.projectUrl`）。

**侧栏底部 bar**：`Sidebar` 在内容下方渲染 `.sidebar-footer`：左侧 `SidebarStats` 统计胶囊
（数据库图标 + 「共 x 个笔记 · xxx KB/MB/GB」），右侧 34px 方形明暗切换按钮。
`SidebarStats` 订阅 `notesStore.revision`，400ms 防抖后调用 `data/stats.getDbStats()`：
读取 notes/folders/blobs/meta 四个 store，文本记录按 JSON 的 UTF-8 字节数估算、blob 用其
`size`。`revision` 在笔记/文件夹 CRUD、导入、重置后递增，保证统计随数据变化刷新。
主题按钮读取 `settingsStore.resolvedScheme`，点击调用 `toggleScheme()`。

**笔记树行**：`NoteTree` 把「新建」行放进滚动容器作为首项，并用
`position: sticky; top: 0` 吸顶（背景与面板一致，内容不会透出）。每条笔记行是两行结构：
标题 + `relativeTime(updatedAt)`，下一行是 `NoteSummary.excerpt`（stripMarkdown 后单行、
80 字上限，CSS 再省略到一行）。同一层级内按 `updatedAt` 倒序；`saveNote` 会先比对
content/title/tags/folderId/pinned，**未发生变化时直接返回**，因此打开/关闭笔记不会刷新
`updatedAt`、也不会打乱排序。

**文件夹与拖拽**：文件夹不允许嵌套，`NoteTree` 只渲染根级文件夹（`loadFolders` 会把历史
`parentId` 归一化为 null 并落库）。文件夹行没有展开箭头，点击整行切换开合，`folder`/
`folder_open` 图标表达状态；展开即选为新建位置，重命名只通过悬停后的编辑按钮触发。
笔记行原生 `draggable`：拖到文件夹行 → `saveNote(id,{folderId})` 并自动展开；拖到树空白处
（`.note-tree-body` 自身）→ `folderId:null`。拖动已嵌套笔记时，侧栏底部浮出「移到顶层」拖放条
（绝对定位，不挤动列表），目标文件夹与空白区分别用 `data-drop-target` / `data-drop-root` 高亮。

文件夹本身也可 `draggable`：拖到另一文件夹行的上半/下半区，按指针位置插到其前/后
（`data-drop-position` 画插入线）；`reorderFolders()` 重排内存数组、压成连续 `order` 并回写
IndexedDB。`createFolder()` 追加到末尾，`loadFolders()` 为旧数据补齐 `order`。

**共享**：`notesStore` / `uiStore.currentFolderId` / `useMarkdownSession` / `MarkdownEditor` / `MarkdownPreview` / `datasource`。
当前选中文件夹由 `uiStore` 持有，**跨 `/n/:id` 保持**；它同时决定「新建」的归属位置。
点击文件夹行开合并选中它；收起当前选中的文件夹时，新建位置回到顶层。

## 4. 主题与印刷

```
settingsStore(scheme/seedColor/previewCss…)
  ├─→ ThemeProvider <m3e-theme> 生成 --md-sys-color-* token（token 在 m3e-theme 元素上）
  └─→ useThemeSync：auto → resolvedScheme
        └─→ 预览代码高亮在 github / github-dark 主题间切换
            + settings.previewCss 追加到内置排版样式之后（可覆盖字号/页边距/字体）
```

- 编辑器语法高亮颜色全部走 `var(--md-sys-color-*)`，明暗自动跟随。
- 预览/打印内置「书籍排版」样式（`features/preview/themes.ts`），用户可在预览工具栏的
  「打印主题」面板里追加自定义 CSS，实时生效。
- 自定义 CSS 只在本机应用内注入，不涉及远程内容；Markdown 渲染关闭原始 HTML（`html:false`）。

## 5. 编辑器封装（MarkdownEditor★）

CodeMirror 6 是命令式 API，React 封装遵循：

- **半受控**：`value` 只在挂载时进入 `EditorState.create({doc})`；切换笔记由父级 `key={noteId}` 重挂载。
  载入完成前不渲染编辑器（`loadedId === noteId`），避免以空文档挂载后无法回灌。
- **不回流**：`updateListener` 只向上通知，不把父级 state 再 dispatch 回文档（避免 CJK 组合输入乱序）。
- **分屏实时预览**：源码由 CodeMirror 渲染，右侧由 markdown-it 渲染同一份源码；预览渲染 120ms 防抖，
  连续输入不重复渲染。视图三态（编辑 / 分屏 / 预览）持久化在 `settings.viewMode`，桌面默认 `split`。
- **格式工具栏**（`MarkdownToolbar` + `markdownCommands.ts`）：工具栏只发出纯命令，纯函数把
  「文档 + 选区」映射为 CodeMirror 的 `changes`/`selection`，可脱离 DOM 单测；编辑器只负责 dispatch。
- **★ CodeMirror 必须 `root: document`**：`EditorView` 默认用 `getRoot(parent)` 定位样式根，
  而该函数会沿 `assignedSlot` 走进 `<m3e-theme>` 的 ShadowRoot。编辑器是 light-DOM 插槽内容，
  Shadow DOM 内的样式规则匹配不到它，会导致 CodeMirror 全部基础样式失效（等宽字体/行高/内边距/焦点描边）。
  显式传 `root: document` 把样式表挂到文档根（见 ADR-022）。
- **视图切换不卸载编辑器**：仅预览时源码面板用 CSS 隐藏，切回后 `requestMeasure()` 重算布局，文档与撤销历史不丢。
- **按需加载**：markdown-it/KaTeX/highlight.js 仅在需要打印/导出 HTML 时动态 import；
  Mermaid、docx、mammoth、pdfjs 均为动态 import，不进入首屏。
- **文件入口**：`paste`/`drop` 由 `EditorView.domEventHandlers` 拦截，交给上层存 blob 后插入引用。
- **保存**：纯防抖 700ms，无手动保存入口；卸载/切笔记立即 flush 到 store（内存真相源）。

## 6. 存储

IndexedDB `claw-clip-v2`（v3，与旧库物理隔离）：

| store | keyPath | 索引 | 内容 |
|---|---|---|---|
| `notes` | id | updatedAt/createdAt/tags(multiEntry)/folderId | 完整 Note（含 content、folderId） |
| `folders` | id | parentId/updatedAt | 文件夹（扁平存储 + `order` 手动排序） |
| `blobs` | id | noteId/mime | 附件 Blob（非 ArrayBuffer） |
| `meta` | key | — | schemaVersion 等 |

`datasource.ts` 门面按 `enableStoringLocally` 切 Local/Remote（占位）。`db.ts` 提供
`openDB()` Promise 单例 + `withTx()` + `__resetDbSingleton()`；v1→v2 升级会补建 `folders`
store 与 `notes.folderId` 索引，v2→v3 删除已废弃的 `starred` 索引。侧栏笔记树通过
`listAllNotes()` 一次性取全量投影，CRUD 时增量同步；`listNotes()`/`query.ts` 的分页查询
仍保留在数据层（供单测与将来复用），当前 UI 不再使用。`loadFolders()` 会把历史嵌套文件夹
（非 null `parentId`）提升为根级并回写，保证「文件夹不嵌套」在数据层也成立。

## 7. 测试金字塔

- **Vitest 单测**（jsdom + fake-indexeddb）：data/stores/hooks/utils，覆盖渲染管线扩展语法、
  文件夹 CRUD/排序/归一化、IDB 统计与字节格式化、DOCX 导出、导入分发、查询过滤/分页、
  自动保存与快捷键等（165 例）。
- **Playwright E2E**（chromium，dev server 带 `/claw-clip/` base，33 例）：编辑/实时预览/格式工具栏/快捷键/视图切换/
  自动保存/刷新持久化/原地编辑 id 不变/附件闭环/双形态断点切换/侧栏页签与收起/笔记树新建与归属/
  文件夹折叠/上传导入/导出 MD/HTML/DOCX/PDF/打印主题。
- 选择器约定：编辑区 `[data-testid="md-editor"] .cm-content`；预览 `[data-testid="md-preview"]`
  （打印根为 `md-preview-print`，避免重复）；确定性信号用 `expect.poll` / `waitForSelector`。

## 8. 构建与部署

- 包管理器 **pnpm**（lockfile 为 `pnpm-lock.yaml`；`package-lock.json` 已移除）。依赖统一用 `pnpm install --frozen-lockfile` 安装。
- Vite 8 + `@vitejs/plugin-react`，`base:'/claw-clip/'`，dev 端口 24680，`@`→src alias。
- KaTeX 字体与 Material Symbols 字体随构建产物自托管，运行时零公网 CDN 依赖。
- CI（`.github/workflows/deploy.yml`）：Node 24 + `pnpm install --frozen-lockfile` + type-check + 单测门禁 + build + `cp dist/index.html dist/404.html`（SPA fallback）→ GitHub Pages。

## 9. 关键文件索引

| 文件 | 职责 |
|---|---|
| `src/data/db.ts` / `local.ts` / `query.ts` | IndexedDB 连接、CRUD、过滤排序分页 |
| `src/data/exchange.ts` | MD/DOCX/PDF 导入导出（重型依赖动态加载） |
| `src/data/blobStore.ts` | 附件 blob + `clawclip://` ⇄ object URL |
| `src/stores/notesStore.ts` | 笔记/文件夹真相源 + noteCache + 列表请求序号 |
| `src/hooks/useMarkdownSession.ts` | 编辑会话：加载、节流自动保存、卸载落库 |
| `src/hooks/useRenderedMarkdown.ts` | 按需渲染 + 附件水合 |
| `src/components/editor/MarkdownEditor.tsx` | CodeMirror 6 封装 |
| `src/features/editor/EditorPane.tsx` | 顶栏 + 工具栏 + 编辑/分屏/预览工作区 + 导出 + 打印根 |
| `src/components/editor/MarkdownToolbar.tsx` | 格式工具栏（只发命令） |
| `src/components/editor/markdownCommands.ts` | 命令 → CodeMirror changes/selection 的纯函数 |
| `src/features/preview/themes.ts` | 内置印刷排版 + 自定义 CSS 合成 |

## 10. 已知限制

- **移动端不分屏**：<900px 时「分屏」退化为纯编辑，预览通过顶栏切到「预览」整页查看。
- **HTML 导出使用原生 MathML**：为避免单文件依赖 KaTeX 字体，导出文档隐藏 `.katex-html`、改用 MathML；
  现代浏览器可正常显示，老旧浏览器公式退化为纯文本。Mermaid 图表在导出 HTML 中保留为代码块。
- **PDF 回导是启发式的**：只保证文字可编辑，不保证版式、表格、图片还原。
- **DOCX 导出**覆盖常见块级结构（标题/段落/列表/表格/代码/图片），复杂样式（批注、目录域）不迁移。
- **Mermaid 体积较大**（elk/cytoscape 按图类型切分为懒加载 chunk），首次渲染图表会有短暂延迟。
