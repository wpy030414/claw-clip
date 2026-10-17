# 架构文档（ARCHITECTURE）

> 鲨鱼夹 ClawClip —— 本地优先的 Markdown 工作站：文件夹树、扩展语法、可配置印刷主题、MD/DOCX/PDF 互导。
> Vite 8 + React 19.3 + TypeScript 5.9 + @m3e/react（Material 3 Web Components）+ CodeMirror 6（源码编辑 + 轻量 IR）+ markdown-it（打印/导出渲染）+ Zustand + IndexedDB。
>
> 关键决策的「为什么」见 [DECISIONS.md](./DECISIONS.md)；本文件讲「是什么、怎么连」。

## 1. 分层总览

```
┌─────────────────────────────────────────────────────────────┐
│  pages/         路由薄壳（Notes/Starred/Search/Editor…）      │  ← react-router data router
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

### 预览 / 打印
```
Markdown 源码 → hydrateMarkdown(clawclip:// → object URL)
  → markdown-it（html:false + GFM/脚注/定义列表/上下标/高亮/KaTeX + highlight.js）
  → HTML → 预览区 / 打印根（#print-root）
```
预览与打印**共用同一份 HTML**，因此「预览所见 = 打印所得」；打印根在屏幕上移出视口，
`@media print` 时占据整页，用户通过系统「另存为 PDF」完成 PDF 导出。

### 导入 / 导出
```
导出 MD   → 正文原文下载
导出 DOCX → 渲染 HTML → DOMParser → docx 库（标题/段落/列表/表格/代码/图片）
导出 PDF  → 打印根 + 系统打印对话框
导入 MD   → File.text()
导入 DOCX → mammoth（docx→HTML）→ turndown(+gfm) → Markdown
导入 PDF  → pdf.js 抽文本 → 按字号/行距启发式重建标题与段落
```

## 3. 响应式双形态

单一 data router，`/n/:noteId` 表达「选中笔记」。`AppShell` 用 `useIsDesktop()`（`(min-width:900px)`）分派：

| | 桌面工作台（≥900px） | 移动卡片流（<900px） |
|---|---|---|
| 导航 | **可收侧栏**（文档/大纲页签；不设 nav rail） | `M3eNavBar`（底部横排） |
| 主区 | **单栏**：列表在侧栏，主区只放编辑器 | 列表 or 全屏编辑器（有 noteId 则全屏） |
| 列表 | 侧栏内文件夹树 + `NoteList variant="compact"` | `NoteList variant="card"` + 文件夹树 |
| 大纲 | 侧栏「大纲」页签 | 编辑器内（暂不提供） |
| 返回 | 无需（侧栏常驻） | `EditorPane onBack` 回列表 |

**共享**：`notesStore` / `uiStore.listMode` / `useMarkdownSession` / `MarkdownEditor` / `MarkdownPreview` / `datasource`。
列表筛选（笔记/收藏/搜索 + 当前文件夹）由 `uiStore` 持有，**跨 `/n/:id` 保持**，返回列表不丢筛选。

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
- **轻量 IR**（`markdownIR.ts`）：浏览模式下用 CodeMirror 装饰隐藏非当前行的 `#`/`**`/链接等标记，
  标题/引用/列表/图片/任务框直接渲染样式；光标进入某行即还原该行源码，**仍可直接写**。
  未聚焦时整篇按浏览态呈现。切换模式用 `Compartment.reconfigure` 热切换，不重建文档、不丢撤销历史。
- **按需加载**：markdown-it/KaTeX/highlight.js 仅在需要打印/导出 HTML 时动态 import；
  Mermaid、docx、mammoth、pdfjs 均为动态 import，不进入首屏。
- **文件入口**：`paste`/`drop` 由 `EditorView.domEventHandlers` 拦截，交给上层存 blob 后插入引用。
- **保存**：纯防抖 700ms，无手动保存入口；卸载/切笔记立即 flush 到 store（内存真相源）。

## 6. 存储

IndexedDB `claw-clip-v2`（v2，与旧库物理隔离）：

| store | keyPath | 索引 | 内容 |
|---|---|---|---|
| `notes` | id | updatedAt/starred/createdAt/tags(multiEntry)/folderId | 完整 Note（含 content、folderId） |
| `folders` | id | parentId/updatedAt | 文件夹（扁平存储，UI 递归组树） |
| `blobs` | id | noteId/mime | 附件 Blob（非 ArrayBuffer） |
| `meta` | key | — | schemaVersion 等 |

`datasource.ts` 门面按 `enableStoringLocally` 切 Local/Remote（占位）。`db.ts` 提供
`openDB()` Promise 单例 + `withTx()` + `__resetDbSingleton()`；v1→v2 升级会补建 `folders`
store 与 `notes.folderId` 索引。列表查询带请求序号，过滤条件快速切换时丢弃过期响应。

## 7. 测试金字塔

- **Vitest 单测**（jsdom + fake-indexeddb）：data/stores/hooks/utils，覆盖渲染管线扩展语法、
  文件夹 CRUD 与级联删除、DOCX 导出、导入分发、查询过滤/分页、自动保存与快捷键等（145 例）。
- **Playwright E2E**（chromium，dev server 带 `/claw-clip/` base，23 例）：编辑/浏览 IR/自动保存/刷新持久化/
  原地编辑 id 不变/附件闭环/双形态断点切换/侧栏大纲与收起/文件夹/导入/导出 MD/DOCX/PDF/打印主题。
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
| `src/features/editor/EditorPane.tsx` | 顶栏 + 编辑/预览 + 导出 + 打印根 |
| `src/features/preview/themes.ts` | 内置印刷排版 + 自定义 CSS 合成 |

## 10. 已知限制

- **轻量 IR 覆盖常见语法**：标题/引用/列表/任务框/图片/粗斜体/删除线/高亮/行内代码/链接；
  围栏代码块标记、嵌套强调、脚注等在浏览模式下仍以源码呈现（可切到编辑模式查看原文）。
- **PDF 回导是启发式的**：只保证文字可编辑，不保证版式、表格、图片还原。
- **DOCX 导出**覆盖常见块级结构（标题/段落/列表/表格/代码/图片），复杂样式（批注、目录域）不迁移。
- **Mermaid 体积较大**（elk/cytoscape 按图类型切分为懒加载 chunk），首次渲染图表会有短暂延迟。
