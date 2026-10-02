# 架构文档（ARCHITECTURE）

> 鲨鱼夹 ClawClip —— 本地优先的 Typora 级 Markdown 记事本。
> Vite 8 + React 19.3 + TypeScript 5.9 + @m3e/react（Material 3 Web Components）+ Vditor（IR 编辑器）+ Zustand + IndexedDB。
>
> 关键决策的「为什么」见 [DECISIONS.md](./DECISIONS.md)；本文件讲「是什么、怎么连」。

## 1. 分层总览

```
┌─────────────────────────────────────────────────────────────┐
│  pages/         路由薄壳（NotesPage/StarredPage/SearchPage…）  │  ← react-router data router
├─────────────────────────────────────────────────────────────┤
│  layouts/       响应式双形态外壳（AppShell→Desktop/Mobile）    │  ← 断点分派，只组合不写业务
├─────────────────────────────────────────────────────────────┤
│  features/      业务域（notes/editor/search/tags/settings）   │  ← 各自处理双形态表现分叉
├─────────────────────────────────────────────────────────────┤
│  components/    展示原子 + M3E 薄封装 + VditorEditor★          │  ← 无业务；editor 是命令式封装
├─────────────────────────────────────────────────────────────┤
│  hooks/         业务逻辑（useNoteEditor/useNotes/useHotkeys…） │  ← 双形态共享；编排 store
├─────────────────────────────────────────────────────────────┤
│  stores/        Zustand（notes/settings/ui）                  │  ← 状态真相源；notesStore 唯一碰 datasource
├─────────────────────────────────────────────────────────────┤
│  data/          数据访问层（datasource 门面→local/remote）     │  ← 纯 TS 零 React，可单测
├─────────────────────────────────────────────────────────────┤
│  IndexedDB (claw-clip-v2)   notes / blobs / meta              │  ← 本地持久化
└─────────────────────────────────────────────────────────────┘
   types/  utils/  config.ts  styles/  横跨各层
```

**依赖方向**：上层依赖下层，下层不知道上层。`data/ stores/ hooks/ utils/` **零 React 组件依赖**（hooks 用 React API 但不渲染 UI），可被 Vitest 直接单测，且被桌面/移动两套布局共享。

## 2. 数据流

### 写入（编辑 → 落库）
```
用户输入 → Vditor input 回调
  → useNoteEditor.handleChange(渲染态 content，含 blob: URL)
  → throttle(leading+trailing) → notesStore.saveActive
  → dehydrateMarkdown(blob: → clawclip://) 转存储态
  → datasource.upsertNote → IndexedDB put（原地更新，不改 id）
```

### 读取（打开笔记 → 渲染）
```
notesStore.openNote(id) → datasource.getNote（存储态，clawclip://）
  → useNoteEditor: hydrateMarkdown(clawclip:// → blob: object URL) 转渲染态
  → VditorEditor.initialValue → Vditor.setValue 显示
```

### 附件（粘贴图片）
```
Vditor upload.handler(files)
  → saveBlob(noteId, file) → IndexedDB blobs 表 → blobId
  → resolveBlobUrl(blobId) → object URL（登记 url→id 反向映射）
  → 返回 ![](object URL) → vd.insertValue 插入正文（当场可渲染）
  → rAF 后 getValue → onChange → saveActive → dehydrate 存 clawclip://
```

**content 双形态**（关键）：`activeNote.content` 与 IndexedDB 里永远是**存储态** `clawclip://blob/<id>`；只有喂给 Vditor 显示时才是**渲染态** object URL。转换集中在 `useNoteEditor` 桥接层 + `blobStore` 的 hydrate/dehydrate。

## 3. 响应式双形态

单一 data router，`/n/:noteId` 表达「选中笔记」。`AppShell` 用 `useIsDesktop()`（`(min-width:900px)`）分派：

| | 桌面工作台（≥900px） | 移动卡片流（<900px） |
|---|---|---|
| 导航 | `M3eNavRail`（左侧竖排） | `M3eNavBar`（底部横排） |
| 主区 | `M3eSplitPane`（start=列表 / end=编辑器常驻） | 列表 or 全屏编辑器（有 noteId 则全屏） |
| 列表 | `NoteList variant="compact"` | `NoteList variant="card"` |
| 大纲 | Vditor 内置 outline（`uiStore.tocOpen` 控制） | 编辑器内 |
| 返回 | 无需（列表常驻） | `EditorPane onBack` 回列表 |

**共享**（不复制两份）：`notesStore` / `useNotes` / `useNoteEditor` / `useAttachment` / `useSearch` / `VditorEditor` / `datasource`。分叉仅在两套 Layout 的 JSX 与 `NoteList` 的 variant。

## 4. 主题（方案 B）

```
settingsStore(scheme/seedColor/…) ──┬──→ ThemeProvider <m3e-theme>
                                    │      └─ 在 m3e-theme 元素上生成 --md-sys-color-* token
                                    │         （实测：token 不在 :root/body，画布须为其后代）
                                    └──→ useThemeSync：auto 解析成 resolvedScheme
                                           └─ syncVditorTheme 切 Vditor 内置主题
                                              + vditor-theme.css 用 token 覆写 .vditor-*
```
明暗切换：token 值随 `<m3e-theme scheme>` 动态重算 → `vditor-theme.css` 的 `var(--md-sys-color-*)` 天然跟随；Vditor 内置 preview/代码高亮主题由 `setTheme` 切换（受 `readyRef` 门闩保护，见 ADR-009/015）。

## 5. 命令式组件封装（VditorEditor★）

Vditor 是命令式类（`new Vditor(el, options)`），在 React 19 StrictMode 下封装的**已验证约束**（详见 ADR-009）：
- **实例 DOM 隔离**：每挂载创建独立 `host` 子元素，cleanup 时 `host.remove()`——防 lute 异步 `after` 渲染出僵尸实例。
- **幂等守卫** `mountedRef` + cleanup `destroy()` + 复位。
- **就绪门闩** `readyRef`：lute 异步加载完（`after`）才允许 `setTheme`/`setValue`。
- **受控折中**：`latestValueRef` 为内部真相源，`initialValue` 仅切笔记时回灌 + 复原光标/滚动，避免打断输入。
- 回调存 `ref`（`onChangeRef`/`schemeRef`）不进依赖数组，避免父重渲染反复重建。

## 6. 存储

IndexedDB `claw-clip-v2`（与旧库物理隔离）：

| store | keyPath | 索引 | 内容 |
|---|---|---|---|
| `notes` | id | updatedAt/starred/createdAt/tags(multiEntry) | 完整 Note（含 content） |
| `blobs` | id | noteId/mime | 附件 Blob（非 ArrayBuffer） |
| `meta` | key | — | schemaVersion 等 |

`datasource.ts` 门面按 `enableStoringLocally` 切 Local（IndexedDB）/ Remote（占位未实现）。`db.ts` 提供 `openDB()` Promise 单例 + `withTx()` 事务封装（oncomplete 才 resolve）+ `__resetDbSingleton()`（测试防串库）。

## 7. 测试金字塔

- **Vitest 单测**（jsdom + fake-indexeddb + Node Blob/File）：data/stores/hooks/utils 纯逻辑。133+ 用例，含旧「编辑=删旧建新」bug 回归。
- **Playwright E2E**（chromium，跑 dev server 带 `/claw-clip/` base）：编辑器与 M3E 交互。覆盖新建/编辑/自动保存持久化/原地编辑 id 不变/附件闭环/离线自托管/明暗/StrictMode 幂等/响应式断点。
- 选择器约定（实测）：IR 编辑区 `.vditor-ir .vditor-reset`；token 读 `m3e-theme` 或其后代；用确定性信号（轮询 IDB / waitForFunction）替代固定 sleep。

## 8. 构建与部署

- Vite 8 + `@vitejs/plugin-react`，`base:'/claw-clip/'`，dev 端口 24680，`@`→src alias。
- `scripts/copy-vditor.mjs`：predev/prebuild/postinstall 拷 `vditor/dist`→`public/vditor/dist`（离线自托管，见 ADR-007）。
- CI（`.github/workflows/deploy.yml`）：Node 24 + `npm ci` + type-check + 单测门禁 + build + `cp dist/index.html dist/404.html`（SPA fallback）→ GitHub Pages。

## 9. 关键文件索引

| 文件 | 职责 |
|---|---|
| `src/components/editor/VditorEditor.tsx` | ★ 最高风险最高价值：Vditor 命令式封装（ADR-009 全部坑） |
| `src/hooks/useNoteEditor.ts` | 编辑会话桥接：hydrate/dehydrate + 节流自动保存 |
| `src/data/local.ts` | LocalDataSource：原地 upsert（修正旧 bug）+ 级联删 |
| `src/data/blobStore.ts` | 附件 blob + clawclip://↔objectURL 双向映射 |
| `src/stores/notesStore.ts` | 数据真相源，乐观更新 + CRUD |
| `src/styles/vditor-theme.css` | 方案 B：token 覆写 .vditor-* |
| `src/hooks/useThemeSync.ts` | 方案 B 明暗解析引擎 |
| `src/layouts/AppShell.tsx` | 响应式双形态分派 |
| `src/components/m3e/index.ts` | M3E 集中再导出（收敛 bus-factor） |
