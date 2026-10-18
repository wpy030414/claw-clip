# 架构文档（ARCHITECTURE）

> 鲨鱼夹 ClawClip —— 本地优先的 Markdown 工作站：文件夹树、扩展语法、预览同源的 DOCX/PDF 导出、MD/DOCX/PDF 互导。
> Vite 8 + React 19.3 + TypeScript 5.9 + @m3e/react（Material 3 Web Components）+ CodeMirror 6（源码编辑）+ markdown-it（实时预览/导出渲染）+ docx / docx-math（原生 Word 公式）+ 浏览器打印（矢量 PDF）+ Zustand + IndexedDB。
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
  → saveBlob(noteId, file) → IndexedDB blobs 表 → blobId（refCount=0）
  → 在光标处插入 ![name](clawclip://blob/<id>)
  → 正文（存储态）始终保存 clawclip:// 引用，永不落 blob: URL
  → 保存笔记：upsertNote 在同一事务内 diff 新旧正文引用
     新增引用 +1 / 移除引用 -1，refCount 归零立即删除 blob
```

**引用计数生命周期**：`blobs.refCount` = 引用该附件的**笔记数**（同一笔记内多次引用只算 1）。
附件可被复制粘贴到其它笔记，删除笔记只递减计数、不按 `noteId` 盲删；计数归零才真正回收。
启动与导入备份后执行 `reconcileBlobRefs()`：以笔记正文为唯一真相源重算计数、修复陈旧
`attachmentIds`、清理历史孤儿与旧版本无 `refCount` 的记录（失败不阻塞启动）。

### 实时预览 / 导出
```
Markdown 源码 → debounce(120ms) → hydrateMarkdown(clawclip:// → object URL)
  → markdown-it（html:true + GFM/脚注/定义列表/上下标/高亮/KaTeX + highlight.js）
  → HTML → 右侧预览区（分屏 / 预览视图）；```mermaid 代码块由 MarkdownPreview 懒加载渲染为 SVG
```
预览区在「分屏 / 预览」视图启用；「仅编辑」视图下不渲染，导出时用**当前正文重新渲染一次**
（`renderForExport`，避免 120ms 防抖缓存导出上一版）。
预览与导出**共用同一份 HTML 与内置排版 CSS**；导出前统一经 `prepareExportHtml()` 把运行时资源
变成自包含产物：附件 `blob:`/`http(s):` → data URL，```mermaid → 内联 SVG（HTML/PDF）或 2× PNG
（DOCX）。DOCX 用 docx 库按预览语义设置字体/标题/引用/代码/表格样式；公式从 KaTeX 的 TeX
annotation 经 `docx/math::latexToMath()` 转成 Word 原生 OMML。PDF 把同一份 HTML 写进离屏
iframe 调 `print()`，由浏览器排版为 A4 矢量 PDF（文字可选中/搜索），用户在打印对话框「另存为 PDF」。

### 导入 / 导出
```
导出 MD   → 正文原文下载
导出 HTML → 预览 CSS + 浅色高亮 + Mermaid SVG + 附件 data URL 内嵌为单文件（公式走原生 MathML，强制浅色）
导出 DOCX → 渲染 HTML → 自包含预处理 → DOMParser → docx 库（公式 OMML、Mermaid PNG）
导出 PDF  → 同源 HTML（强制浅色/@page）→ 隐藏 iframe → 浏览器打印 → 另存为矢量 PDF
导入 MD   → File.text()
导入 DOCX → mammoth（docx→HTML）→ turndown(+gfm) → Markdown
导入 PDF  → pdf.js 抽文本 → 按字号/行距启发式重建标题与段落
```

## 3. 响应式双形态

单一 data router，`/n/:noteId` 表达「选中笔记」。`AppShell` 用 `useIsDesktop()`（`(min-width:900px)`）分派：

| | 桌面工作台（≥900px） | 移动端（<900px） |
|---|---|---|
| 导航 | **可收侧栏**：品牌行 → 等宽页签 → 行级「新建」→ 文件夹/笔记树 → 底部统计/明暗切换 | 首页复用侧栏内容：品牌行 → 行级「新建」→ 文件夹/笔记树 → 底部统计/明暗切换（无大纲页签） |
| 主区 | **编辑工作区**：编辑 / 分屏 / 预览三态；默认分屏 | 笔记树 or 全屏编辑器（有 noteId 则全屏）；split 退化为编辑 |
| 列表 | 侧栏内**文件夹 + 笔记统一树**（`NoteTree`） | 同一棵 `NoteTree` |
| 大纲 | 侧栏「大纲」页签 | 不提供（移动端无常驻编辑器） |
| 返回 | 无需（侧栏常驻） | `EditorPane onBack` 回列表 |

**侧栏开关**：`DesktopLayout` 在主内容左上角渲染一个 `main-sidebar-toggle`
（`data-testid` 随状态切换 `btn-sidebar-close` / `btn-sidebar-open`）；
`Sidebar` 自身只在打开时渲染，不再内置收起按钮。顶部品牌行由两部分组成：左侧等宽字体的
`ClawClip` 标题（无图标；按钮形式，点击切换显示构建期注入的 7 位 commit hash，再点回到
标题文字）、右侧 GitHub 图标（外链 `globalConfig.projectUrl`）。commit hash 由
`vite.config.ts` 在 dev/build 启动时执行 `git rev-parse --short=7 HEAD` 注入
`__APP_COMMIT__`，无 git 环境降级为 `unknown`。

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
settingsStore(scheme/seedColor…)
  ├─→ ThemeProvider <m3e-theme> 生成 --md-sys-color-* token（token 在 m3e-theme 元素上）
  └─→ useThemeSync：auto → resolvedScheme
        └─→ 预览代码高亮在 github / github-dark 主题间切换
```

- 编辑器语法高亮颜色全部走 `var(--md-sys-color-*)`，明暗自动跟随。
- 预览/导出内置「书籍排版」样式（`features/preview/themes.ts`），是 HTML/DOCX/PDF 的共同排版来源；
  不再提供独立的「打印主题」配置入口，避免预览与导出各走一套样式。
- Markdown 渲染开启原始 HTML（`html:true`），手写 HTML 原样进入预览/导出；**有意不做 XSS 过滤**（见 ADR-033）。

## 5. 编辑器封装（MarkdownEditor★）

CodeMirror 6 是命令式 API，React 封装遵循：

- **半受控**：`value` 只在挂载时进入 `EditorState.create({doc})`；切换笔记由父级 `key={noteId}` 重挂载。
  载入完成前不渲染编辑器（`loadedId === noteId`），避免以空文档挂载后无法回灌。
- **不回流**：`updateListener` 只向上通知，不把父级 state 再 dispatch 回文档（避免 CJK 组合输入乱序）。
- **分屏实时预览**：源码由 CodeMirror 渲染，右侧由 markdown-it 渲染同一份源码；预览渲染 120ms 防抖，
  连续输入不重复渲染。视图三态（编辑 / 分屏 / 预览）是 `uiStore.viewMode` 的会话内瞬态（不落 localStorage，刷新即重置），
  桌面默认 `split`、移动端默认 `edit`；仅预览模式下隐藏格式工具栏。
- **格式工具栏**（`MarkdownToolbar` + `markdownCommands.ts`）：工具栏只发出纯命令，纯函数把
  「文档 + 选区」映射为 CodeMirror 的 `changes`/`selection`，可脱离 DOM 单测；编辑器只负责 dispatch。
- **格式化**（更多菜单第一项，`utils/markdownFormat.ts`）：`formatMarkdown()` 是幂等纯函数，
  整篇强制校准标题/列表/任务/引用/有序列表的标记间距、行尾硬换行、连续空行与文末换行；
  围栏代码块内部原样保留。结果经 `MarkdownEditorHandle.replaceAll()` 整篇替换（保留撤销历史）。
- **★ CodeMirror 必须 `root: document`**：`EditorView` 默认用 `getRoot(parent)` 定位样式根，
  而该函数会沿 `assignedSlot` 走进 `<m3e-theme>` 的 ShadowRoot。编辑器是 light-DOM 插槽内容，
  Shadow DOM 内的样式规则匹配不到它，会导致 CodeMirror 全部基础样式失效（等宽字体/行高/内边距/焦点描边）。
  显式传 `root: document` 把样式表挂到文档根（见 ADR-022）。
- **行号**：CodeMirror `lineNumbers()` 常驻，gutter 透明底、等宽字，`highlightActiveLineGutter()` 让光标所在行号用 on-surface 深色加粗；行号用 flex 在 28px 行高内垂直居中。
- **Mermaid**：未命中 highlight.js 的代码块也保留 `language-*` 类，`MarkdownPreview` 据此把 ```mermaid 懒加载渲染为 SVG。
- **GitHub 警报框**：`markdownRender` 的 core 规则把 `> [!NOTE]` 等块引用改写为
  `div.md-alert.md-alert-<type>` + 标题段落；样式在共享的 `DEFAULT_PREVIEW_CSS` 里，
  预览/HTML/PDF 同源，DOCX 在 `blockChildren()` 单独处理。
- **视图切换不卸载编辑器**：仅预览时源码列收为 `0fr`、面板淡出隐藏，切回后 `requestMeasure()` 重算布局，文档与撤销历史不丢。
- **大纲跳转**：点击时用编辑器**实时正文**重解析标题位置（旧偏移会因附件插入/连续输入而落错行），
  再按当前视图选落点：编辑/分屏 → CodeMirror `scrollTo`，仅预览 → 预览面板 `scrollIntoView`
  （`features/editor/activeEditor.ts` 的导航器 + `utils/outline.ts` 的匹配）。
  两处都走**平滑滚动**（`utils/scroll.ts`）：光标/焦点立即到位，滚动在数百毫秒内完成，
  系统开启「减少动态效果」时退化为瞬时（与全局 CSS 的同名媒体查询一致）。
  落点**每帧重算**——视图切换的 260ms 列宽过渡会让换行/行高持续变化，
  一次算好的位置会偏，动画结束后还要跟随布局直到目标连续多帧不变。
- **选中与标记输入**：活动行不创建层叠上下文（否则行底色盖住 `z-index:-1` 的选择层），
  选中色固定为青色（不随主色 seed 变化）；选中后敲 `*` `_` `~` `` ` `` `$` `^` `=` 由 `wrapSelection()` 包裹并保持选中，选区两端空白（含换行）裁到标记外。
  CJK 字体无 italic 面，编辑器与预览都显式 `font-synthesis: style` 才能让中文斜体真正倾斜。
- **动效**：条件渲染的浮层统一走 `hooks/usePresence`（延迟卸载 + `data-state` 关键帧）；
  侧栏用宽度/透明度过渡，页签用滑动指示块，工具行走 grid 行高折叠，笔记新建/删除用
  entering/exiting 关键帧；明暗切换只在 320ms 窗口内为子树开启颜色过渡（见 ADR-040）。
- **按需加载**：markdown-it/KaTeX/highlight.js 仅在需要预览/导出时动态 import；
  Mermaid、docx（含 `docx/math`）、mammoth、pdfjs 均为动态 import，不进入首屏。
- **文件入口**：`paste`/`drop` 由 `EditorView.domEventHandlers` 拦截，交给上层存 blob 后插入引用。
- **保存**：纯防抖 700ms，无手动保存入口；卸载/切笔记立即 flush 到 store（内存真相源）。

## 6. 存储

IndexedDB `claw-clip-v2`（v3，与旧库物理隔离）：

| store | keyPath | 索引 | 内容 |
|---|---|---|---|
| `notes` | id | updatedAt/createdAt/tags(multiEntry)/folderId | 完整 Note（含 content、folderId） |
| `folders` | id | parentId/updatedAt | 文件夹（扁平存储 + `order` 手动排序） |
| `blobs` | id | noteId/mime | 附件 Blob（非 ArrayBuffer）+ `refCount` 引用计数 + 可选 `remoteUrl`（图床缓存） |
| `meta` | key | — | schemaVersion 等 |

`datasource.ts` 门面按 `enableStoringLocally` 切 Local/Remote（占位）。`db.ts` 提供
`openDB()` Promise 单例 + `withTx()` + `__resetDbSingleton()`；v1→v2 升级会补建 `folders`
store 与 `notes.folderId` 索引，v2→v3 删除已废弃的 `starred` 索引。侧栏笔记树通过
`listAllNotes()` 一次性取全量投影，CRUD 时增量同步；`listNotes()`/`query.ts` 的分页查询
仍保留在数据层（供单测与将来复用），当前 UI 不再使用。`loadFolders()` 会把历史嵌套文件夹
（非 null `parentId`）提升为根级并回写，保证「文件夹不嵌套」在数据层也成立。

### 6.1 存储空间与外部集成

- **统计口径**（`data/storageReport.ts`）：单只读事务读四张表；笔记/文件夹/meta 按 JSON
  UTF-8 字节估算，附件用 `size` + 元数据 JSON。附件归属以**正文引用**为真相源，共享附件在
  笔记排行中按引用笔记数均摊；总量只在 `blobs` 计一次。另列 `navigator.storage.estimate()`
  的整站用量/配额与 `usageDetails.indexedDB`，UI 明确区分三种数字。
- **图片上传目标**（`data/imageHost.ts` + `stores/integrationStore.ts`）：默认写本地
  `blobs`；切到 `img.scdn.io` 后，`EditorPane.insertFiles` 对图片调用
  `POST /api/v1.php`（multipart 字段 `image`，无鉴权，串行限流 5 次/5 秒），成功插入外链，
  失败回退 `saveBlob` 并提示。外链不参与 `clawclip://` 引用计数与水合。
- **云快照**（`data/snapshot.ts` + `data/cloudSync.ts`）：`exportAll()` 后只打包正文引用的
  附件；图片先上传图床并把快照副本里的 `clawclip://` 换成外链（结果缓存进
  `BlobRecord.remoteUrl`），本地笔记保持不变。快照超过 10MB 时按体积剔除最大的非图片附件
  （正文保留本地引用）直到达标；节点正文自身超限则拒绝推送。
- **导入/清空的写入代际**（`stores/notesStore.ts`）：导入与清空前先递增 `dataEpoch` 并
  `drainWrites()` 等待在途 upsert；`useMarkdownSession` 的防抖/卸载保存携带挂载时的
  epoch，代际不一致直接丢弃。`replaceAll()` 在单事务里清空 + 写入，避免「清空了却没写进去」。
  `EditorPage` 以 `${noteId}-${dataEpoch}` 作为编辑器 key，导入后强制重挂载读取新内容。

## 7. 测试金字塔

- **Vitest 单测**（jsdom + fake-indexeddb）：data/stores/hooks/utils，覆盖渲染管线扩展语法、
  文件夹 CRUD/排序/归一化、IDB 统计与字节格式化、DOCX 导出、导入分发、查询过滤/分页、
  自动保存与快捷键、存储报告、云快照、Gist 客户端、图床客户端、导入语义等（286 例）。
- **Playwright E2E**（chromium，dev server 带 `/claw-clip/` base，61 例）：编辑/实时预览/格式工具栏/快捷键/视图切换/
  自动保存/刷新持久化/原地编辑 id 不变/附件闭环/双形态断点切换/侧栏页签与收起/笔记树新建与归属/
  文件夹折叠与删除确认/上传导入/导出 MD/HTML/DOCX/PDF 直接下载/导出菜单精简/存储空间 dialog/
  全库备份导出导入与清空/图床与 Gist 同步（外部请求用 `page.route` mock）。
- 选择器约定：编辑区 `[data-testid="md-editor"] .cm-content`；预览 `[data-testid="md-preview"]`；
  确定性信号用 `expect.poll` / `waitForSelector`。

## 8. 构建与部署

- 包管理器 **pnpm**（lockfile 为 `pnpm-lock.yaml`；`package-lock.json` 已移除）。依赖统一用 `pnpm install --frozen-lockfile` 安装。
- Vite 8 + `@vitejs/plugin-react`，`base:'/claw-clip/'`，dev 端口 24680，`@`→src alias。
- KaTeX 字体与 Material Symbols 字体随构建产物自托管，运行时零公网 CDN 依赖。
- CI（`.github/workflows/deploy.yml`）：Node 24 + `pnpm install --frozen-lockfile` + type-check + 单测门禁 + build + `cp dist/index.html dist/404.html`（SPA fallback）→ GitHub Pages。

## 9. 关键文件索引

| 文件 | 职责 |
|---|---|
| `src/data/db.ts` / `local.ts` / `query.ts` | IndexedDB 连接、CRUD、过滤排序分页 |
| `src/data/exchange.ts` | MD/DOCX/PDF 导入导出门面（重型依赖动态加载） |
| `src/data/export/prepare.ts` | 导出自包含预处理：附件 data URL + Mermaid 渲染 |
| `src/data/export/math.ts` | KaTeX TeX → docx 原生 OMML（`docx/math`） |
| `src/data/export/html.ts` | 独立 HTML / 打印文档构建（MathML、浅色纸面、`@page`） |
| `src/data/export/print.ts` | 隐藏 iframe → 浏览器打印（矢量 PDF） |
| `src/utils/mermaid.ts` | Mermaid 渲染（预览/导出共用，输出 SVG/PNG） |
| `src/data/blobStore.ts` | 附件引用计数/回收 + `clawclip://` ⇄ object URL |
| `src/stores/notesStore.ts` | 笔记/文件夹真相源 + noteCache + 列表请求序号 |
| `src/hooks/useMarkdownSession.ts` | 编辑会话：加载、节流自动保存、卸载落库 |
| `src/hooks/useRenderedMarkdown.ts` | 按需渲染 + 附件水合 |
| `src/components/editor/MarkdownEditor.tsx` | CodeMirror 6 封装 |
| `src/features/editor/EditorPane.tsx` | 顶栏 + 工具栏 + 编辑/分屏/预览工作区 + 导出 |
| `src/components/editor/MarkdownToolbar.tsx` | 格式工具栏（只发命令） |
| `src/components/editor/markdownCommands.ts` | 命令 → CodeMirror changes/selection 的纯函数 |
| `src/utils/markdownFormat.ts` | 整篇 Markdown 格式化（幂等、代码块保护） |
| `src/features/preview/themes.ts` | 内置预览/导出排版 CSS |

## 10. 已知限制

- **移动端不分屏**：<900px 时「分屏」退化为纯编辑，预览通过顶栏切到「预览」整页查看。
- **HTML 导出使用原生 MathML**：为避免单文件依赖 KaTeX 字体，导出文档隐藏 `.katex-html`、改用 MathML；
  现代浏览器可正常显示，老旧浏览器公式退化为纯文本。Mermaid 在导出时渲染为内联 SVG，附件内联为
  data URL，因此单文件可离线打开。
- **PDF 走浏览器打印**：产物是矢量文字（可选中/搜索），但需要在系统打印对话框里选择「另存为 PDF」；
  公式显示依赖浏览器的 MathML 支持。
- **PDF 回导是启发式的**：只保证文字可编辑，不保证版式、表格、图片还原。
- **DOCX 公式**经 `docx/math::latexToMath()` 转原生 OMML；该转换器不认识的 KaTeX 扩展宏会回退为
  等宽 TeX 文本。DOCX 块级结构覆盖标题/段落/列表/表格/代码/图片，批注、目录域等复杂样式不迁移。
- **Mermaid 体积较大**（elk/cytoscape 按图类型切分为懒加载 chunk），首次渲染图表会有短暂延迟。
