# 架构决策记录（DECISIONS / ADR）

> 鲨鱼夹 ClawClip —— Vue3 → React19 重写。
> 本文件记录重写过程中的关键决策，每条含**背景 / 决策 / 理由 / 后果 / 验证**。
> 状态标记：✅ 已落地并验证 · 🔄 进行中 · ⏸ 延后。
>
> 调研数据验证于 2026-10-02；标「实测」的结论均由 E2E/单测/源码核对坐实，非文档推断。

---

## ADR-001 · 跨框架重写而非增量迁移 ✅

**背景**：原项目是 Vue 3.4 + Pinia + Element Plus 的移动端「博客/时间线记事本」，主人要求改用 Vite + React 19.3 + @m3e/react 重做，并对齐 Typora 的 Markdown 编辑能力。

**决策**：整体重写（新分支 `rewrite/react19`），不做 Vue→React 增量迁移。保留数据访问层的**接口形状**（datasource 门面 local/remote 切换），但数据模型、UI、状态方案全部重建。

**理由**：Vue SFC → React JSX、Pinia → Zustand、Element Plus → M3E 三处都是范式级替换，增量迁移的胶水成本高于重写；且产品语义要从「社交博客」收敛为「纯记事本」，本就需要重新设计数据模型。

**后果**：旧 `src/**`（.vue/stores/apis/router/views/types/assets）在 S1 全部删除；每阶段建 git 快照（`snapshot/stage-N`）保证可回退；验收后整理快照合回 main。

---

## ADR-002 · 编辑器选 Vditor（IR 模式），不用 Tiptap/Milkdown/CodeMirror ❌【已被 ADR-016 取代】

**背景**：Typora 的招牌是**即时渲染 IR**——光标不在的行渲染成富文本，光标进入某行才显出 `**`/`#` 原始标记。这是「对齐 Typora」的核心诉求。

**决策**：选 **Vditor 4.0（`mode:'ir'`）** 自封装成 React 组件。

**理由**（实测对比 5 候选）：
- Vditor 是**唯一开箱即用真 IR** 的库；Tiptap/Milkdown 是 ProseMirror 富文本 WYSIWYG，**永远看不到源码标记**（是 Notion 那种，不是 Typora 那种）；CodeMirror6 能做最忠实 IR 但大纲/公式/图表/表格全要从零造。
- Vditor 的 Markdown 完备度最高（Lute 引擎 + KaTeX/MathJax 双引擎 + Mermaid/ECharts/PlantUML 图表全家桶 + 脚注 + ToC + FrontMatter），Typora checklist 覆盖度第一。
- `upload.handler` 可拦截粘贴/拖拽文件写本地存储，天然契合 IndexedDB 附件模型。
- MIT、活跃（同团队维护思源笔记）。

**后果**：需自封装命令式 React 组件（Vditor 无官方 React 绑定），承担其全部集成坑（见 ADR-007/008/009）。

---

## ADR-003 · UI 用 @m3e/react，编辑器视觉走「方案 B 主题同步」 ✅

**背景**：主人指定 @m3e/react（Material Design 3 Web Components）做 UI。但 M3E **无任何编辑器组件，连 text-field/input 都没有**（实测：全库 137 标签零个编辑器，文本录入只有 `m3e-form-field` 容器包原生 input）。Vditor 又自带非 Material 风格的工具栏/大纲/主题——两者存在设计语言接缝。

**决策**：
- M3E 只做**外壳**（导航 nav-rail/nav-bar、分栏 split-pane、大纲 toc、工具栏、对话框、搜索、标签 chip、主题），编辑画布用 Vditor。
- 视觉接缝走**方案 B**：保留 Vditor 完整工具栏/大纲，用 CSS 重写 `.vditor-*` 消费 M3E 的 `--md-sys-color-*` token、明暗跟随 M3E scheme。（方案 A 原样并存太割裂；方案 C 用 M3E 自建工具栏驱动 Vditor API 边际收益低且脆弱。）

**理由**：方案 B 用最小工作量把两套设计语言统一到 M3 token 上，同时保留 Vditor 全部 Typora 能力。

**后果**：见 ADR-004（token 位置的架构硬约束）。M3E 是小众库（周下载 ~305、单维护者），用 `src/components/m3e/index.ts` **集中再导出**收敛 bus-factor 风险（改导入路径只改一处）。

---

## ADR-004 · M3E token 在 `<m3e-theme>` 元素上，画布必须是其后代 ✅【实测纠正调研】

**背景**：调研报告称 M3E 的 `--md-sys-color-*` token 设在 `:root`/`body`。方案 B 的前提是「light-DOM 的 Vditor 画布能 `var(--md-sys-color-*)`」，若 token 位置不对，整个方案 B 崩塌。

**决策/实测结论**：E2E 实测**推翻调研**——token 设在 **`<m3e-theme>` 元素自身**，靠 CSS 继承传给后代。在 `documentElement`/`body` 上读 `--md-sys-color-primary` 为**空**，只有 `m3e-theme` 及其子树内可读。token 确为可继承自定义属性：m3e-theme 子树内注入 light-DOM 探针能读到并 `var()` 消费成功。

**理由**：Lit 组件把 token 挂在宿主元素而非 document 根，是 shadow-DOM 库的常见做法。

**后果（架构硬约束）**：**Vditor 画布等所有需消费 token 的 light-DOM 内容，必须渲染在 `<m3e-theme>` 子树内**。故 `ThemeProvider`（包 `<m3e-theme>`）置于 React 树根，包住整个 App。`vditor-theme.css` 据此覆写 `.vditor-*`。

**验证**：`e2e/s1-smoke.spec.ts` 断言 token 可继承消费 + 明暗跟随系统。

---

## ADR-005 · 数据全新模型 Note v2，不写旧库迁移 ✅

**背景**：旧 `Blog{id:number(时间戳), author, text, videos[], images[], date}`。主人决策「全新开始」，语义收敛为纯记事本。

**决策**：换新模型 + 新库名 `claw-clip-v2`（与旧 `ClawClip` 物理隔离），**不写迁移代码**，不动旧库。

**Note v2 关键设计**（对初稿的纠正）：
- `id: string`（UUID）——不再用时间戳当 id。
- **编辑原地更新（`put`），永不改 id**——根除旧「编辑=删旧建新 + 收藏手动搬运」的语义 bug（旧 `edited.ts` 实测确认）。
- `starred` **内联字段**，不再单开 stars 表。
- 加 `wordCount`/`excerpt` **冗余字段** + 列表投影 `NoteSummary`——列表页不读 content，避免旧版「整条 Blog（含内联图片 ArrayBuffer）全进内存」的性能问题（对应旧 commit "optimize performance of loading media"）。
- 加 `attachmentIds` 反向索引——删除级联 & 导出打包用。
- `title` 显式存储、`deriveTitle` 回填（首行 H1/前 30 字），非纯派生。
- 砍掉 author/信箱/成就体系/firstCome。

**后果**：旧数据不保证可读（用户如需保留，自行用旧版导出）。附件从「内联 ArrayBuffer」改为独立 blob 表（ADR-006）。

**验证**：`src/data/__tests__/local.spec.ts` 原地 upsert 回归测试（同 id 二次 save，id 不变、只一条记录）。

---

## ADR-006 · 附件独立 blob 表 + `clawclip://blob/<id>` 协议 ✅

**背景**：旧版把 `ArrayBuffer[]` 内联进每条 Blog 文档。Markdown 图片需要 URL 引用，且内联二进制拖慢列表加载。

**决策**：
- 附件存独立 IndexedDB `blobs` 表，`data` 存 **`Blob`**（非 ArrayBuffer）——IDB 原生支持 Blob 结构化克隆，零拷贝、懒加载，不把二进制读进 JS 堆。
- 正文用自定义协议 **`clawclip://blob/<id>`** 持久引用（object URL 是运行时产物、刷新即失效，不能写进 Markdown）。
- 渲染前 `hydrateMarkdown()` 把 `clawclip://` 批量换成 object URL（`urlCache` 去重复用）；保存前 `dehydrateMarkdown()` 反解回 `clawclip://`（防 blob: URL 进库）；切笔记/卸载 `releaseBlobUrls()` revoke 防泄漏。

**理由**：独立表让列表查询不碰二进制；`clawclip://` 让正文可持久化、可导出；Blob 省内存。

**后果**：hydrate/dehydrate 双向转换由 `useNoteEditor` 桥接层负责，`activeNote.content` 始终存 `clawclip://` 真相源。上传 handler 返回 object URL（当场可渲染），见 ADR-008。

**验证**：`blobStore.spec.ts`（hydrate/dehydrate/悬空引用/防泄漏）+ `e2e/s4-attachment.spec.ts`（上传→当场渲染→存库 clawclip://→刷新 hydrate 恢复）。

---

## ADR-007 · Vditor 资源自托管，离线不依赖 unpkg ✅

**背景**：Vditor 默认 `cdn: https://unpkg.com/vditor@<ver>`，KaTeX/Mermaid/hljs/emoji 等运行时从公网懒加载。本项目本地优先，且 unpkg 在中国境内不稳。

**决策**：`scripts/copy-vditor.mjs` 在 predev/prebuild/postinstall 把 `node_modules/vditor/dist` 拷到 `public/vditor/dist`；`options.cdn` 指向本地；**唯一硬编码 `Constants.CDN` 的 `hint.emojiPath` 必须显式设本地**（实测：其余子资源统一 `cdn + "/dist/..."` 拼接，会跟随 options.cdn）。字体同理自托管 Material Symbols（Apache-2.0）到 `public/fonts`。

**验证**（实测）：解包 vditor@4.0.0 tarball 确认 `dist` 全套 23MB 都在包内（`dist/js/` 含 katex/mermaid/highlight.js/lute/echarts/plantuml 等），运行时依赖仅 `diff-match-patch`。静态核验 24 个子资源路径本地 0 缺失。E2E 拦截 `unpkg.com` 后 IR 离线渲染成功、7 请求 0 个 unpkg。

**后果**：仓库体积 +（woff2 3.8MB + public/vditor ~23MB，后者由构建脚本生成、`.gitignore` 排除）。GitHub Pages base 路径 `/claw-clip/` 下用 `import.meta.env.BASE_URL` 拼接（CSS 里无法用它，硬编码 `/claw-clip/` 并与 vite base 保持一致）。

---

## ADR-008 · upload.handler 自己插入正文，返回 null ✅【实测推翻调研 + 假设】

**背景**：调研假设 `upload.handler` 返回 string 会被 Vditor 自动插入正文。**实测推翻**。

**决策/实测真相**：读 Vditor 4.0 源码，handler 返回值语义是 **validate 结果**：
```js
isValidate = await handler(files);
if (typeof isValidate === "string") { vditor.tip.show(isValidate); return; } // string 被当【错误提示】弹出！
```
即**返回 string = 报错提示，不插入**；返回 null = 成功。故 handler 必须**自己调 `vd.insertValue()` 插入** markdown，返回 null。

**连带发现**：`insertValue` 是程序化 `range.insertNode`，**不产生 DOM input 事件**（IR 分支还先置 `preventInput=true` 再 insert），故不触发 `options.input`。若不手动补发 `onChange`，「只粘贴图片不打字」永不自动保存 → 刷新丢图。修法：handler 内 insertValue 后，`requestAnimationFrame` 里 `getValue()` 取值并调 `onChangeRef.current?.(value)`（rAF 是等 IR 异步折叠图片节点稳定）。插入前 `vd.focus()` 恢复被文件对话框夺走的选区。

**上传 URL 用 object URL 而非 clawclip://**：Vditor 立刻把返回值渲染成 `<img src>`，返回 clawclip:// 会当场破图（无效协议）；返回 object URL 当场可见，落库时 dehydrate 回 clawclip://。

**验证**：`useAttachment.spec.ts`（handler 返回 null + 调 insert + 存 blob）+ `e2e/s4-attachment.spec.ts`。

---

## ADR-009 · VditorEditor 实例 DOM 隔离 + 僵尸守卫 ✅【S4 最难 bug，逐层实测】

**背景**：附件 E2E 间歇失败（~50%），IDB content 停在空串、图片丢失。

**根因**（debug 逐层实测，推翻多个错误假设）：
1. 先疑「焦点丢失/节流窗口」——改 focus + leading 节流，未根除。
2. 加实例探针，发现真相：**VditorEditor 被挂载 4 次**（StrictMode 双调用 × EditorPane `if(loading) return` early-return 卸载重挂），上传命中**已 destroy 的陈旧实例**，其 `getValue()="\n"`。
3. 深层：**Vditor lute 引擎异步加载**，构造后 `after` 回调才渲染 DOM。StrictMode 下 `mount(inst1)→cleanup(inst1)→mount(inst2)`：cleanup 调 `inst1.destroy()` 时 inst1 尚未就绪、destroy 无效；等 inst1 的 lute 加载完，`after` 仍触发，把 inst1 的 DOM（含 file input）渲染进**共享容器** → **僵尸实例**。Playwright 点到僵尸 input，读到空值。

**决策（三重修复）**：
- **实例 DOM 隔离**：每个挂载创建独立 `host` 子元素，`new Vditor(host)`；cleanup 时 `host.remove()` 整个移出文档。僵尸即使 `after` 晚触发，也只渲染进**已脱离文档**的 host，绝不出现在活 DOM、碰不到活实例。（此前「让僵尸自我 destroy」的守卫失败，正因多实例共享 DOM 时 `destroy()` 清空整个容器、连带毁掉活实例。）
- **EditorPane 不卸载画布**：移除 `if(loading) return` early-return，loading 改 **overlay 覆盖**；VditorEditor 加 `key={noteId}`，只随 noteId 变化重挂（StrictMode 应有的 2 次，不再因 loading 抖动叠加）。
- **after 僵尸守卫 + destroyed 标志**：cleanup 先置 `destroyed=true`，`after` 发现已销毁则 `vd.destroy()` 并中止渲染。

**验证**（实测）：压测 `--repeat-each=10 --workers=3` 从「24 中 4 失败」→「30/30 全绿」。

**教训**：命令式 Web 组件（异步初始化）在 React StrictMode 双挂载下，**共享 DOM + 异步 after 渲染**是僵尸实例温床；隔离每实例 DOM 子树是根治手段，比「守卫标志」更根本。

---

## ADR-010 · 状态管理 Zustand（三 store 分职） ✅

**背景**：Pinia → React 状态方案。

**决策**：Zustand 5，三 store 职责不重叠：
- `notesStore`：**唯一触碰 datasource 的地方**（数据真相源），乐观更新 + CRUD 编排。
- `settingsStore`：主题/编辑器偏好，persist localStorage（`resolvedScheme` 不持久化，运行时重算）。
- `uiStore`：瞬态 UI（断点/搜索词/过滤/命令面板/确认队列），不持久化。

**理由**：轻量、无 Provider 地狱、契合响应式双形态共享数据层。业务编排（自动保存节流、附件 URL 转换、光标保持）放 hooks 不放 store，保持 store 可单测。

**验证**：三 store 单测覆盖（乐观更新/派生字段重算/persist partialize/确认队列）。

---

## ADR-011 · 搜索用内存过滤，不引入 FTS ✅

**背景**：keyword 搜索需匹配 title+content+tags，IndexedDB 无全文检索（FTS）。

**决策**：`query.ts` 取全量 notes → 内存过滤/排序/分页 → 投影 NoteSummary。

**理由**：本地记事本量级（数百~数千条）内存过滤足够；引入 FTS（如倒排索引/MiniSearch）增加复杂度与维护面，收益不匹配。

**后果**：过滤阶段用完整 Note（keyword 要搜 content），投影只在分页切片后做，保证返回体轻量。若将来量大，可用 IDB `tags` multiEntry 索引预筛或加轻量倒排。

---

## ADR-012 · 路由用 react-router v7 data router，双形态共享单一路由 ✅

**背景**：vue-router → react-router 7。响应式双形态（桌面工作台/移动卡片流）。

**决策**：`createBrowserRouter`（data router，提供 loader/action/errorElement）。**不用两套路由**，用 `/n/:noteId` 表达「选中笔记」：桌面右侧内嵌编辑器（URL 同步可刷新保持）；移动点卡片 navigate 到 `/n/:noteId` 全屏编辑，返回键回列表。`basename = import.meta.env.BASE_URL`（GitHub Pages `/claw-clip/`）。

**理由**：双形态共享同一数据层与业务 hook，只有布局 JSX 分叉；单一路由避免状态漂移。

**状态**：S5 进行中（agent 实现 layouts/pages/features）。

---

## ADR-013 · 测试策略：数据层单测 + 编辑器/M3E 走 E2E ✅

**背景**：Vditor/M3E 都是命令式 Web Component（Lit shadow DOM / 异步初始化），组件单测价值低且脆弱。

**决策**：
- **Vitest 重度单测**：data/（原地 upsert 回归、级联删、hydrate/dehydrate、搜索、备份往返、二进制安全）、stores/、hooks/、utils/。用 `fake-indexeddb/auto` + Node 原生 Blob/File（jsdom Blob 无 `arrayBuffer()`）+ `__resetDbSingleton()`（db Promise 单例防串库）。VditorEditor 用 `vi.mock('vditor')` 测**封装契约**，不测 Vditor 内部。
- **Playwright E2E**：编辑器与 M3E 交互。技巧（实测）：IR 编辑区选择器必须 scope 到 `.vditor-ir .vditor-reset`（IR 模式渲染 4 个 `.vditor-reset`，只有 `.vditor-ir` 下那个可见，否则会匹配到隐藏的 wysiwyg 容器）；M3E shadow DOM Playwright 默认可穿透；token 断言读 `m3e-theme` 元素或其后代（非 documentElement）；用确定性信号（轮询 IDB / waitForFunction textContent）替代固定 sleep。

**理由**：把「能单测的纯逻辑」和「只能真机验证的 Web Component 行为」分开，各用最合适的工具。

**验证**：单测 133 绿（S5 前）；E2E 覆盖新建/编辑/自动保存持久化/原地编辑 id 不变/附件闭环/离线/明暗/StrictMode 幂等。

---

## ADR-014 · TypeScript 锁 5.9 LTS，TS7 延后为独立里程碑 ✅

**背景**：`typescript` 的 npm `latest` 已是 7.0.2（原生 Go 重写版，版本线从 5.9 跳到 7.0，6.0 仍 beta）。本项目用小众库（M3E）+ 命令式库（Vditor），类型层面求稳 > 追新。

**决策**：锁 `typescript ~5.9.3`；`skipLibCheck:true` 规避库类型缺陷；TS7 作为独立验证里程碑延后，阻塞则回退。

**理由**：TS7 太新、类型检查行为与 5.x 有差异，生态兼容性未充分验证。

**验证**：全程 type-check 0 错误（`tsc -p tsconfig.app.json --noEmit`）。

---

## ADR-015 · Vditor API 以 d.ts 实测为准（多处纠正） ✅

**背景**：调研/plan 附录的 Vditor 用法含臆造 API，实测逐个纠正。

**实测纠正**：
- **无 `setMode()` 方法**！只有 `getCurrentMode()`。模式切换的正确做法：改 `settingsStore.editorMode` → mount effect 依赖 `[noteId, editorMode]` 触发重建。
- `setTheme(theme:"dark"|"classic", contentTheme?, codeTheme?, contentThemePath?)` 四参。
- **setTheme 时序坑**：`this.vditor` 内部对象在 lute 异步加载完（`after` 回调）才就绪，此前调 setTheme 报 `Cannot read properties of undefined (reading 'options')`。修法：`readyRef` 就绪门闩，scheme effect 未就绪则跳过，首屏由 after 里的 syncVditorTheme 兜底。
- 实例方法：getValue/setValue(md,clearStack)/insertValue(value,render)/focus/blur/getSelection/destroy/getCurrentMode/renderPreview/getHTML/clearCache。

**教训**：小众/命令式库的 API **必须读 `.d.ts` 与源码核实**，不臆造。M3E 同理（ADR-003 集中再导出 + CEM manifest `custom-elements.json` 提取属性/事件/slot）。

---

## ADR-016 · 移除 Vditor，改用 CodeMirror 6 源码编辑 + 独立预览 ✅

**背景**：Vditor 的 IR 模式虽然还原 Typora 手感，但带来三重负担：包体大（首屏 ~1.4MB）、命令式生命周期坑多（ADR-007/008/009/015 全在填它的坑）、与「文件夹 + 导入导出 + 可配置印刷预览」的新方向耦合过重。

**决策**：
- 编辑内核换 **CodeMirror 6**（`@codemirror/lang-markdown` + 自定义 HighlightStyle，颜色走 M3E token）。
- 放弃「即时渲染 IR」，改为**编辑/预览双视图**：源码编辑，预览由独立 markdown-it 管线渲染。
- 渲染管线（markdown-it / KaTeX / highlight.js）**按需动态 import**，不进入首屏；Mermaid 进一步按图类型拆分懒加载。

**实测约束**：
- **编辑器必须半受控**：`value` 只作为挂载初始文档，父级 state 不回流到 `EditorView`。回流会打断 CJK 组合输入，产生字符乱序（Playwright 可稳定复现）。
- 切换笔记用 `key={noteId}` 重挂载，而不是 dispatch 替换文档。
- Playwright `keyboard.type` 输入中文会乱序（CM6 组合输入模拟问题），E2E 统一用 `keyboard.insertText`。

**代价**：失去 IR 的「边写边排版」体验；换来更小的首屏、可控的渲染语义，以及预览/打印完全同源。

---

## ADR-017 · 文件夹树数据模型：独立 folders store + notes.folderId ✅

**决策**：
- `folders` 独立 object store（`id/name/parentId/timestamps`），扁平存储，UI 递归组树。
- `notes.folderId?: string | null`；`null`/缺失 = 根目录。旧笔记升级后自然落入根目录，无需迁移脚本。
- 删除文件夹为**级联删除**（子孙文件夹 + 其下笔记 + 附件），UI 二次确认。
- 列表筛选把 `folderId` 并入 `NoteFilter`，与 keyword/starred/tags 组合。

**为什么不用嵌套 JSON 树**：IndexedDB 查询/增量更新/单文件夹重命名都更简单；树深很浅，递归组树成本可忽略。

---

## ADR-018 · 预览 / 打印 / DOCX 导出共用同一份渲染结果 ✅

**决策**：
- 一份 `renderMarkdown()`（markdown-it + 扩展插件 + highlight.js）输出 HTML。
- 预览区与隐藏的 `#print-root` 共用同一 HTML；`@media print` 只显示打印根，用户通过系统「另存为 PDF」导出。
- DOCX 导出把同一 HTML 交给 DOMParser → `docx` 库，避免「预览一种排版、导出另一种排版」。

**理由**：印刷类产品最怕「看到的和导出的不一样」。同源渲染把差异收敛到 CSS，用户改预览主题 CSS 即可同时影响打印。

**安全**：markdown-it `html:false`，正文原始 HTML 一律转义；自定义 CSS 只注入本机应用，不接受远程内容。

---

## ADR-019 · PDF 回导采用 pdf.js 文本流 + 启发式重建 ✅（已知限制）

**决策**：`pdfjs-dist` 抽取文本项，按 y 坐标聚行、按字号中位数识别标题层级、按行距分段、识别项目符号；输出可继续编辑的 Markdown。

**理由与边界**：
- PDF 是排版产物，没有语义结构；任何方案都无法「真正还原」表格/图片/双栏。
- 目标定为**可编辑**而非可用版式；PRD 明确列为非目标（不保证保真）。
- 重型依赖动态 import，避免为低频功能拖慢首屏。

**后果**：扫描版 PDF（无文本层）导入为空；需要在 UI 上给出「PDF 导入仅还原文字」的预期。

---

_（后续 ADR 随 S10 验收与性能优化补充：体积预算、命令面板、设置页等。）_
