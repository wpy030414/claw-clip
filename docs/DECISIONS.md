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
- **编辑原地更新（`put`），永不改 id**——根除旧「编辑=删旧建新」的语义 bug（旧 `edited.ts` 实测确认）。
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
- 列表筛选把 `folderId` 并入 `NoteFilter`，与 keyword/tags 组合；“收藏”概念已于 ADR-023 移除。

**为什么不用嵌套 JSON 树**：IndexedDB 查询/增量更新/单文件夹重命名都更简单；树深很浅，递归组树成本可忽略。

---

## ADR-018 · 预览 / DOCX / PDF 导出共用同一份渲染结果与排版语义 ✅（PDF 实现由 ADR-038 取代）

**决策**：
- 一份 `renderMarkdown()`（markdown-it + 扩展插件 + highlight.js）输出 HTML。
- DOCX 导出把同一 HTML 交给 DOMParser → `docx` 库，并通过文档默认样式对齐预览的
  字体、字号、标题层级、引用底色、代码块与表头样式。
- PDF 导出把同一 HTML 放进离屏的 `md-preview-content`（注入预览 CSS 与浅色 token）→
  html2canvas-pro 渲染 → jsPDF 按 A4 高度切片 → 直接下载 `.pdf`，不再经过系统打印对话框。
- 「打印主题」独立面板与打印根（`#print-root`）随之移除：预览即唯一的排版来源。

**理由**：印刷类产品最怕「看到的和导出的不一样」。同源渲染 + 对齐的导出样式把差异收敛到一处；
直接下载文件也省掉了「在打印对话框里另存为 PDF」的多余步骤。

**安全**：markdown-it 现为 `html:true`，正文原始 HTML 原样输出、不做 XSS 过滤（见 ADR-033）；离屏容器只渲染本机内容。

---

## ADR-019 · PDF 回导采用 pdf.js 文本流 + 启发式重建 ✅（已知限制）

**决策**：`pdfjs-dist` 抽取文本项，按 y 坐标聚行、按字号中位数识别标题层级、按行距分段、识别项目符号；输出可继续编辑的 Markdown。

**理由与边界**：
- PDF 是排版产物，没有语义结构；任何方案都无法「真正还原」表格/图片/双栏。
- 目标定为**可编辑**而非可用版式；PRD 明确列为非目标（不保证保真）。
- 重型依赖动态 import，避免为低频功能拖慢首屏。

**后果**：扫描版 PDF（无文本层）导入为空；需要在 UI 上给出「PDF 导入仅还原文字」的预期。

---

## ADR-020 · Typora 式单主区 + 轻量 IR + 纯防抖自动保存 ✅（已被 ADR-021 取代）

**背景**：产品方向确定为「几乎和 Typora 一样」——侧栏展示文档/大纲、可收起；主区在源码与浏览模式间切换，
浏览模式仍能直接写；自动保存防抖，用户不接管。此前实现的「编辑区 + 独立预览页」与 nav rail/分栏被判定为过度设计。

**决策**：
- **布局**：桌面改为「可收侧栏（文档 / 大纲两页签）+ 单主区」，移除 nav rail 与 `M3eSplitPane`；
  移动端保留列表/编辑器整页切换与底部导航。
- **浏览模式**：不做富文本，也不做 HTML 预览；在 CodeMirror 6 上用**装饰**隐藏非当前行的 Markdown 标记、
  渲染标题/引用/列表/任务框/图片/粗斜体/删除线/高亮/行内代码/链接。文档始终是同一份源码，
  光标进入某行即还原该行，随时可写。切换模式用 `Compartment.reconfigure`，不重建文档。
- **焦点语义**：编辑器未聚焦时整篇按浏览态呈现；聚焦后仅光标所在行显示源码（Typora 行为）。
- **保存**：纯 trailing 防抖 700ms，移除手动保存按钮与 Cmd+S；切笔记/卸载立即 flush。
- **打印主题**：不再有独立设置页/预览页，入口收进导出菜单的「打印主题…」，只影响打印根与 DOCX。

**代价**：
- 不是完整 WYSIWYG：围栏代码块标记、嵌套强调、脚注等在浏览态仍显示源码（可切编辑模式查看）。
- 半受控编辑器必须在「载入完成」后才挂载（`loadedId === noteId`），否则空文档挂载后无法回灌。

---

_（后续 ADR 随 S10 验收与性能优化补充：体积预算、命令面板等。）_

---

## ADR-021 · 编辑工作区对标 markdownassistant：源码 + 实时预览 + 格式工具栏 ✅

**背景**：ADR-020 交付的「轻量 IR 浏览模式」在实际使用中被判定为设计失败：IR 只覆盖常见语法，
公式 / 围栏代码块 / 表格 / 脚注在浏览态仍是源码；同时顶栏因 `editor.css` 从未被 import 而折行、
编辑器没有版心、CodeMirror 基础样式全部失效（见 ADR-022）。对照组
[markdownassistant.com](https://www.markdownassistant.com/zh/) 的核心体验更简单也更完整：
左源码、右实时预览、顶部格式工具栏、导出 MD/HTML/PDF、大纲与明暗主题。

**决策**：
- **放弃轻量 IR**（删除 `markdownIR.ts`），改为三态视图：`edit` / `split` / `preview`；
  桌面默认分屏，移动端默认编辑（`split` 在窄屏退化为 `edit`）。视图选择为会话内瞬态（见 ADR-039，不再持久化）。
- **实时预览**：复用既有 markdown-it 管线（KaTeX / highlight.js / Mermaid），
  随输入 120ms 防抖渲染；预览与打印、DOCX/HTML 导出共用同一份 HTML。
- **格式工具栏**：标题 H1–H3、粗体、斜体、删除线、行内代码、引用、无序/有序/任务列表、
  代码块、链接、图片、表格、行内/块级公式、分隔线。命令实现为纯函数
  （`markdownCommands.ts`），工具栏与编辑器解耦，可直接单测。
- **顶栏收敛**：标题与保存状态、三态视图切换、更多菜单（导出/附件/主题/明暗/删除）；收藏已移除（ADR-023）。
- **新增 HTML 导出**：单文件、内嵌预览主题与代码高亮；公式改用 KaTeX 同时输出的原生 MathML，
  避免导出文件依赖 KaTeX 字体或 CDN。

**理由**：
- 源码 + 实时预览的语义最简单：不存在「浏览态还能不能写」「当前行标记何时显隐」这类边缘状态，
  用户永远知道文档真相在哪。
- markdown-it 管线已经是项目内唯一渲染真相源，实时预览只是把它接到第二个容器，不引入新依赖。
- 工具栏命令是纯函数，测试成本低；E2E 覆盖「加粗 → 标题 → 预览同步」。
- HTML 导出补齐了「带走」闭环，且与预览同源，避免「预览一套、导出另一套」。

**后果**：
- 失去 Typora 式「光标所在行显源码、其余行渲染」的观感；换来确定、可测、与导出完全同源的预览。
- 移动端无法左右分屏，预览改为整页切换；这是窄屏的合理退化，不是能力缺失。
- 首屏仍不加载 markdown-it：只有进入分屏/预览或导出时才动态 import。
- `settings.viewMode` 曾进入 localStorage 持久化（ADR-039 已改为会话内瞬态；旧值留在存储里，不再读取）。

**验证**：`pnpm run test:unit` 161 例（新增 `markdownCommands.spec.ts` 16 例）；
`pnpm run test:e2e` 27 例（新增工具栏 / 快捷键 / 视图切换 / HTML 导出 4 例），全绿。

---

## ADR-022 · CodeMirror 6 在 `<m3e-theme>` 下必须显式 `root: document` ✅【实测】

**背景**：重新实现编辑工作区时发现 CodeMirror 的**全部基础样式**都没生效：正文不是等宽字体、
没有内边距与行高、编辑器高度异常、存在蓝色焦点描边。检查 `document.head` 找不到任何
`.cm-scroller` / `.cm-content` 规则，`document` 上也没有 `style-mod` 的 StyleSet 符号。

**根因**：`EditorView` 构造时 `this._root = config.root || getRoot(config.parent) || document`；
`getRoot(node)` 的实现是：

```js
while (node) {
  if (node.nodeType === 9 || (node.nodeType === 11 && node.host)) return node;
  node = node.assignedSlot || node.parentNode;
}
```

我们的 App 渲染在 `<m3e-theme>` 的 light DOM 中，而 `m3e-theme` 的 ShadowRoot 里有 `<slot>`。
从编辑器宿主向上走时，`node.assignedSlot` 会指进 `<m3e-theme>` 的 ShadowRoot，
于是 `getRoot` 返回 **ShadowRoot**。`style-mod` 把 CodeMirror 的样式表 adopt 到该 ShadowRoot，
但编辑器 DOM 是 light DOM 插槽内容，Shadow DOM 内的规则**不会应用到 slotted content**，
所以样式全部失效。这是「Shadow DOM 样式作用域」与「Web Component 插槽」的交互陷阱，
不是 M3E 的 bug，也不是 CodeMirror 的 bug。

**决策**：创建 `EditorView` 时显式传 `root: document`，让样式表挂到文档根。

**验证**（实测）：
- 修复前 `.cm-content` 计算样式为 `padding: 0px`、`font-family: Roboto...`；
  修复后为 `padding: 28px 36px`、`font-family: ui-monospace...`。
- `document` 上出现 CodeMirror 的样式 `<style>`；编辑器焦点描边消失（由主题 `&.cm-focused { outline: none }` 接管）。
- E2E 的编辑、预览、附件水合全部通过。

**经验**：任何在 Shadow DOM 宿主内渲染、但自身位于 light DOM 的第三方 UI 库，
都要检查它如何定位「样式根」。命令式库默认 `getRootNode()` / `assignedSlot` 的行为在插槽场景下
会把样式放进错误的树。

---

## ADR-023 · 取消收藏 + 侧栏文件夹/笔记统一树 + 「+」收敛创建入口 ✅

**背景**：收藏（starred）与文件夹树并存后出现两套组织语义：收藏页在扁平列表里筛星标，
文件夹树只列文件夹、笔记仍在下方独立列表。用户要求「取消收藏笔记的概念」，并让侧栏
以树状同时呈现文件夹与笔记，把「创建文件夹 / 新建笔记 / 上传笔记」全部收敛到「笔记」
标题行右侧的「+」。

**决策**：
- **删除收藏概念**：`Note.starred`/`NoteFilter.starred`/`listMode="starred"`/`/starred` 路由、
  `toggleStar`/`setStarred` 数据接口、列表与编辑器星标按钮一并移除；IndexedDB 版本升到 v3，
  升级时删除遗留的 `starred` 索引（字段本身无需迁移）。
- **统一树**：`NoteTree` 把 `folders`（按 `parentId`）与 `treeNotes`（全部 `NoteSummary`）按
  层级组合；文件夹在前、笔记按 `updatedAt` 倒序；根目录笔记与根级文件夹同级。
- **单一创建入口**：「+」打开 M3E dialog，内含新建文件夹 / 新建笔记 / 上传笔记三项；
  当前选中的文件夹决定新建归属（`uiStore.currentFolderId`，null = 根目录）。
- **树数据独立于列表**：`notesStore.treeNotes` 由 `datasource.listAllNotes()` 一次性加载，
  CRUD 时增量同步（ADR-024 已整体移除搜索与 `summaries` 列表态）。
- **切笔记不串写**：新增 `saveNote(id, patch)`，编辑会话的防抖与卸载落库都绑定自己载入的
  笔记 id；`saveActive` 退化为 `saveNote(activeNoteId, patch)` 的薄封装。此前旧会话的延迟
  保存会写进切换后的 `activeNote`，从编辑器里「+ 新建」时会把 A 的正文串到 B（回归测试见
  `notesStore.spec.ts` 与 `s4-editor-data.spec.ts`）。

**理由**：树是文件管理器的自然心智模型，文件夹与笔记同屏才能表达「归属」；把创建动作收进
一个入口消除散布在标题行、文件夹行、FAB 的多套按钮，移动端也只需一个入口。收藏与文件夹
是重叠的组织手段，保留前者只会让「笔记在哪」出现两个答案。

**后果**：旧数据中的 `starred` 字段被忽略但不删除（无损）；桌面侧栏不再有扁平笔记列表。
（搜索页与 `NoteList` 已在 ADR-024 中移除。）

**验证**：`pnpm run type-check` 零错误；`pnpm run test:unit` 160 例全绿；
`pnpm run test:e2e` 全绿（覆盖「+」对话框、笔记树归属新建、文件夹展开/选中、搜索与大纲）。

---

## ADR-024 · 侧栏收敛：移除搜索、去掉标题行/根目录行、开关移到主区顶栏 ✅

**背景**：ADR-023 落地后侧栏仍有冗余层级：顶部「笔记/搜索」切换、独立的「笔记」标题行
（带重复的「+」）、树内的「根目录」行，以及内置在侧栏里的收起按钮。用户要求侧栏从上到下
只保留：文档/大纲页签（居中）→ 行级新建按钮 → 文件夹/笔记树，并移除搜索功能；侧栏控制
按钮改到主内容顶栏左侧。

**决策**：
- **移除搜索**：删除 `/search` 路由、`SearchPage`、移动端底部导航（`Nav.tsx`/`M3eNavBar`）、
  `uiStore.listMode`/`keyword` 与 `setFilter` 残留；扁平列表组件 `NoteList` 一并删除。
  `notesStore` 不再维护 `summaries/total/loading/load`，只保留 `treeNotes` 作为侧栏投影。
- **侧栏顺序**：`Sidebar` 只渲染文档/大纲页签；文档页签下是 `NoteTree`，其顶部有一行
  「新建」（`btn-new`）打开 M3E dialog，下面是文件夹/笔记树。（ADR-028 增加了品牌行并改为
  等宽页签。）
- **去掉标题行与根目录行**：不再有「笔记」标题和独立「+」；根目录不单独展示。（ADR-027
  起文件夹整行点击开合，收起当前选中文件夹时新建位置回到顶层。）
- **侧栏开关**：`DesktopLayout` 在 `.desktop-main` 左上角渲染固定按钮（随状态切换
  `btn-sidebar-close`/`btn-sidebar-open`）；`Sidebar` 关闭时直接不渲染。桌面编辑顶栏
  左侧留出 54px 避让按钮。
- **根级笔记缩进**：根级笔记只做 4px 轻微偏移，文件夹子项缩进 20px，避免根级笔记被误读成
  上方展开文件夹的子项。

**理由**：只有一个列表语义时，搜索页与底部导航都没有目的地；侧栏的页签、新建、树三段式
比「标题行 + 工具栏 + 树」更接近文件管理器的心智模型。把收起按钮放到主区顶栏，侧栏本身
可以完全交给内容，不再有一条常驻的工具行。

**后果**：移动端不再有底部导航（返回编辑器使用返回按钮）；`NoteList`/`NoteListPane` 的扁平
列表样式与 `--navbar-height` token 被移除；`listNotes()`/`query.ts` 仍留在数据层。

**验证**：`pnpm run type-check` 零错误；`pnpm run test:unit` 155 例全绿；
`pnpm run test:e2e` 28 例全绿；视觉截图确认页签居中、行级新建、树层级与主区开关位置。

---

## ADR-025 · 笔记行展示三要素 + 新建行并入树并吸顶 ✅

**背景**：侧栏收敛后，笔记行只显示标题，缺少上下文；「新建」行位于滚动容器之外，
与文件夹/笔记列表分成两块。

**决策**：
- **笔记行两行结构**：第一行 `标题 + relativeTime(updatedAt)`，第二行 `NoteSummary.excerpt`
  单行省略。摘要复用保存时写入的 `excerpt`（`stripMarkdown` + 空白折叠 + 80 字上限），
  不额外读取正文；渲染前剥掉 excerpt 开头与标题重复的部分（`notePreview`），避免
  「标题」在行内出现两次。悬停 `title` 同时给出完整标题与预览。
- **新建行并入树**：把「新建」行移入 `.note-tree-body` 作为首个子项，用包裹层
  `position: sticky; top: 0` 强制吸顶；包裹层背景与侧栏面板同色，避免滚动内容透出。
- **统一行距**：新建行、文件夹行、笔记行、行内编辑行共用 `.tree-row` 的 8px 纵向 padding，
  相邻行之间统一留 4px 间隙（`.note-tree-body > * + *`）；新建行包裹层的底部 padding 与
  间隙同宽，吸顶背景能盖住滚动内容。

**理由**：侧栏是唯一的导航面，标题不足以区分同名/相似笔记，预览与时间能显著提高定位效率；
「新建」与列表同组后视觉上属于同一个列表，吸顶又保证长列表滚动时入口始终可达。

**后果**：笔记行高度约 52px，长列表可滚动区域变长；`NoteSummary` 无需新增字段。

**验证**：`pnpm run type-check` 零错误；`pnpm run test:unit` 155 例全绿；
`pnpm run test:e2e` 29 例全绿（新增「标题 + 预览 + 时间」行信息用例）；
截图确认长列表滚动后「新建」行仍固定在顶部。

---

## ADR-026 · 文件排序按真实修改时间倒序；打开笔记不算修改 ✅

**背景**：笔记树按 `updatedAt` 倒序展示。但编辑会话在卸载/防抖时会无条件调用保存，
`saveNote` 也每次把 `updatedAt = Date.now()`；结果只是打开一篇笔记再离开，就会把它顶到
列表最前面，排序被「浏览行为」污染。

**决策**：
- **保存前做真实变更检测**：`saveNote(id, patch)` 先算出 content/title/tags/folderId/pinned
  的最终值，与缓存中的 Note 逐项比较；全部相同则直接返回，不写库、不刷新 `updatedAt`。
- **标题只在必要时派生**：仅当正文真实变化时才 `deriveTitle(content)`；无改动的保存保留
  原标题，避免手动/导入标题被打开动作改回正文派生值。
- **排序**：`NoteTree` 在同一层级（根目录 / 每个文件夹）内按 `updatedAt` 倒序；文件夹本身
  仍按名称排序。创建/真实编辑会刷新 `updatedAt` 并自然上浮。

**理由**：「最后修改时间」应表达内容层面的变更；打开、切换视图、浏览都不应改变顺序。
变更检测放在 store 层，所有保存入口（防抖、卸载 flush、导入、快捷键）自动受益。

**后果**：保存路径多一次字段比较（纯内存，成本可忽略）；noteCache 未命中时仍会先读一次
IDB 再比较。旧数据的 `updatedAt` 保持原样，不做迁移。

**验证**：`pnpm run test:unit` 159 例全绿（新增同内容不刷新、真实变更刷新、手动标题保留、
openNote 不刷新 4 例）；`pnpm run test:e2e` 30 例全绿（新增「仅打开不改变排序」回归）；
`pnpm run type-check` / `pnpm run build` 通过。

---

## ADR-027 · 文件夹单层化 + 整行开合 + 笔记拖拽 ✅

**背景**：树里的文件夹仍带独立展开箭头、双击名称可重命名、允许任意嵌套；新建 dialog 还有
右上角关闭按钮和底部「取消」。用户要求文件夹只保留状态图标、整行点击开合、重命名必须显式
按钮、禁止嵌套，并支持把笔记拖入/拖出文件夹。

**决策**：
- **去箭头、整行开合**：删除 `.tree-twisty` 与名称按钮，文件夹行本身承担 `role="button"`；
  单击切换开合，`folder` / `folder_open` 图标即状态。展开时把该文件夹设为新建位置；收起
  当前选中文件夹时新建位置回到顶层。
- **重命名显式化**：移除 `onDoubleClick`；只有悬停后出现的编辑按钮（`folder-rename-*`）
  能进入行内重命名，双击名称不再触发。
- **禁止嵌套**：`createFolder(name)` 固定 `parentId=null`；`loadFolders()` 把历史嵌套文件夹
  统一提升为根级并回写；`NoteTree` 只做「根级文件夹 → 其笔记 → 根级笔记」的扁平渲染。
- **dialog 收敛**：`M3eDialog` 去掉 `dismissible`（无右上角 X）与 actions slot（无底部取消）；
  保留 Esc / 点击遮罩关闭。文件夹选项文案说明「在根部创建（文件夹不支持嵌套）」。
- **笔记拖拽**：笔记行原生 `draggable`；文件夹行作为 drop target，树空白区作为「移出到顶层」
  drop target。落地统一走 `saveNote(id,{folderId})`，因此拖拽属于真实改动，会刷新
  `updatedAt` 并参与排序。拖动嵌套笔记时，侧栏底部浮出「移到顶层」拖放条（绝对定位，
  不挤动列表），树空白处也可作为移出目标。

**理由**：文件夹图标本身已表达开合状态，额外箭头是重复信息；整行点击是文件管理器的常规
交互。文件夹只保留一层后，树的缩进、删除语义和新建位置都更简单，拖拽也只有「进/出」两种。
创建 dialog 只保留三个动作，减少无意义按钮。

**后果**：历史嵌套文件夹被扁平化（数据回写，笔记归属不变）；删除文件夹不再级联看不见的
子文件夹。HTML5 拖拽在桌面可用，触屏设备暂不支持拖拽（仍可通过新建位置选择归属）。

**验证**：`pnpm run type-check` 零错误；`pnpm run test:unit` 160 例全绿（新增嵌套文件夹
归一化用例）；`pnpm run test:e2e` 32 例全绿（新增整行开合、双击不重命名、显式重命名、
不可嵌套、dialog 无关闭按钮、拖入/拖出文件夹）；截图确认图标状态与新 dialog 外观。

---

## ADR-028 · 侧栏品牌行 + GitHub 图标 + 等宽页签 ✅

**背景**：侧栏顶部直接从文档/大纲页签开始，缺少产品标识；页签按内容宽度居中，视觉上不像
一条完整的顶部导航。

**决策**：
- 在侧栏最上方增加 `.sidebar-brand` 行：左侧 `ClawClip` 文字（取 `globalConfig.appName.en`），
  右侧 GitHub 品牌 SVG 图标；整行 `min-height: 56px`，与主内容顶栏同高。
- GitHub 图标是 `<a target="_blank" rel="noopener noreferrer">`，地址取
  `globalConfig.projectUrl`（`https://github.com/wpy030414/claw-clip`）。
- 文档/大纲页签改为 `display:flex` + 每个按钮 `flex:1`，等宽铺满侧栏一行；选中态仍是
  M3E secondary-container 圆角块。

**理由**：品牌行让侧栏有明确的起点，并与主区顶栏形成水平对齐；等宽页签的可点击面积更大、
两个页签权重一致，也避免页签随文字长度变化而游移。

**后果**：侧栏顶部固定占用 56px；GitHub 图标依赖外链，点击会在新标签页打开项目主页。

**验证**：`pnpm run type-check` / `pnpm run build` 通过；`pnpm run test:unit` 160 例、
`pnpm run test:e2e` 32 例全绿（E2E 断言品牌文字、GitHub href/target 与两个页签等宽）。

---

## ADR-029 · 文件夹支持拖拽手动排序，顺序持久化 ✅

**背景**：文件夹此前按名称排序，用户无法按自己的使用频率/习惯调整顺序。

**决策**：
- `Folder` 增加可选 `order?: number`；`loadFolders()` 把旧数据按现有顺序/名称兜底排序后
  压成连续 `0..n-1` 并回写，之后按 `order` 升序展示。
- `createFolder()` 取现有最大 order + 1，追加到末尾（不再按名称插入）。
- 文件夹行原生 `draggable`：拖到另一文件夹行的上半区 → 插到其前，下半区 → 插到其后；
  `data-drop-position` 用 inset 阴影画插入线，被拖行半透明。
- 新增 `reorderFolders(sourceId, targetId, after)`：在内存数组中移除/插入，重算连续 order，
  只把 order 变化的文件夹 upsert 回 IndexedDB。
- 同时支持两种拖拽：拖**笔记**到文件夹 = 移入；拖**文件夹**到文件夹 = 排序，用独立
  dataTransfer 类型与 ref 区分，互不干扰。

**理由**：文件夹数量通常不多，手动顺序比名称排序更符合个人工作流；order 放在文件夹记录内，
不需要额外的排序表或 meta 配置，备份/导入天然携带。

**后果**：新建文件夹固定追加到末尾；删除文件夹后 order 可能出现空洞，下次加载会自动压缩。
旧数据首次加载会写回一次 order，属于无损归一化。

**验证**：`pnpm run type-check` / `pnpm run build` 通过；`pnpm run test:unit` 162 例全绿
（新增创建追加、重排持久化、旧数据补 order 用例）；`pnpm run test:e2e` 33 例全绿
（新增拖拽文件夹排序 + 刷新后顺序保持）。

---

## ADR-030 · 品牌名等宽字体 + 侧栏底部 IDB 数据统计 ✅

**背景**：侧栏顶部品牌名与正文使用同一非等宽字体；侧栏也缺少「本应用到底存了多少数据」的
直观反馈。

**决策**：
- `.sidebar-brand-name` 优先使用等宽字体栈
  `ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`。
- 侧栏底部新增 `SidebarStats`：显示「共 x 个笔记，xxx KB/MB/GB」。
- 新增 `data/stats.ts`：`getDbStats()` 读取本应用四个 store（notes/folders/blobs/meta），
  文本记录按 JSON UTF-8 字节数估算，blob 按其 `size` 计入；不把 Blob 本体序列化。
  大小统一按 KB/MB/GB 展示（最小单位 KB）。
- `notesStore` 增加 `revision`：笔记/文件夹 CRUD、导入、重置后递增；`SidebarStats` 监听
  该值并 400ms 防抖重算，避免连续保存时反复全表扫描。

**理由**：等宽字体让产品名更像「工作台标识」；统计数据能帮助用户判断本地数据规模。
基于自家 store 统计比 `navigator.storage.estimate()` 更贴近「本应用」，后者是整站 origin
用量，会混入同源其它页面。

**后果**：统计值是数据载荷的近似值，不含 IndexedDB 存储开销与索引体积；大附件只计 Blob
字节数。统计仅在桌面侧栏展示（移动端无侧栏）。

**验证**：`pnpm run type-check` / `pnpm run build` 通过；`pnpm run test:unit` 165 例全绿
（新增 formatBytes、getDbStats、revision 用例）；`pnpm run test:e2e` 33 例全绿
（断言初始「共 0 个笔记」与新建后「共 1 个笔记 + KB/MB/GB」）。

（ADR-031 已把这条统计升级为底部 bar，并在右侧加入明暗切换。）

---

## ADR-031 · 侧栏底部 bar：统计胶囊 + 方形明暗切换 ✅

**背景**：统计最初只是一行裸文本，贴在侧栏底部，缺少层次；明暗切换只藏在编辑器「更多」
菜单里，侧栏没有快捷入口。

**决策**：
- 底部改为 `.sidebar-footer` 横条：`display:flex`、上下 padding、顶部 outline 分隔线。
- 左侧 `.sidebar-stats` 做成圆角胶囊（`surface-container-high` 背景）：数据库图标 +
  「共 x 个笔记」+ 弱化圆点 + 高亮尺寸；数字使用 `tabular-nums`。
- 右侧 `.sidebar-theme-toggle` 是 34×34 的方形按钮（10px 圆角、outline 描边、
  `surface-container-high` 背景），图标随实际主题取反：浅色显示月亮、深色显示太阳。
  点击调用 `settingsStore.toggleScheme()`，与编辑器菜单的明暗切换共用同一份状态。
- 整个 footer `flex-shrink:0`，不参与笔记树滚动；`SidebarStats` 的统计逻辑保持不变。

**理由**：底部是常驻区域，适合放「只读状态 + 低风险快捷操作」。胶囊与方形按钮形成
「信息块 + 控制块」的节奏，既有设计感又不抢笔记树的内容注意力。

**后果**：底部 bar 高度约 52px；移动端没有侧栏，因此不展示该 bar；主题切换同时影响
M3E token、编辑器与预览。

**验证**：`pnpm run type-check` 通过；`pnpm run test:unit` 165 例、`pnpm run test:e2e` 33 例
全绿（E2E 断言底部 bar 可见、主题按钮可见且点击后图标变化）；浅色/深色截图确认胶囊、
方形按钮与顶部边框的视觉层次。

---

## ADR-032 · 侧栏品牌行加入网站 logo（已废弃，见 ADR-035）

**背景**：品牌行只有等宽文字 `ClawClip` 和 GitHub 图标，缺少与网站 favicon 一致的视觉标识。

**决策**：
- 在标题左侧加入 `<img className="sidebar-logo" src={import.meta.env.BASE_URL + "favicon.ico"}>`，
  24×24、`object-fit: contain`，作为装饰性图片（`alt=""`）。
- favicon 是单色黑标；暗色主题下通过 `data-dark` + `filter: invert(1)` 反相为白色，
  无需额外维护两套 logo 资源。
- 品牌行结构改为「logo + 等宽标题」的 `.sidebar-brand-main`，右侧 GitHub 图标位置不变。

**理由**：直接复用站点 favicon，保证浏览器标签页与侧栏品牌一致；单色反相比再做一套暗色
logo 更简单，也不会引入额外请求之外的资源。

**后果**：logo 依赖 `public/favicon.ico` 与 Vite `BASE_URL`；若将来替换 favicon，侧栏自动同步。
在深色主题下反相的黑色像素会变白；favicon 的透明通道保持不变。

**验证**：`pnpm run type-check` 通过；`pnpm run test:unit` 165 例、`pnpm run test:e2e` 33 例
全绿（E2E 断言 logo 可见、src 指向 favicon，并随主题切换 `data-dark`）；浅色/深色截图确认
logo、等宽标题与底部 bar 的视觉关系。


---

## ADR-033 · 编辑器支持手写 HTML，不做 XSS 过滤 ✅

**背景**：Markdown 管线此前设置 `html:false`，笔记正文里的原始 HTML 一律被转义，
用户无法在文档中直接写 HTML（自定义布局、`<details>`、带 class 的容器等）。

**决策**：
- markdown-it 改为 `html:true`，原始 HTML 原样进入预览、HTML 导出与 PDF 渲染。
- 不引入 DOMPurify/sanitize-html，也不过滤 `script` 标签或事件属性。

**理由**：本应用是纯本地、单用户、无服务端的编辑器，笔记是用户自己的内容，渲染结果只在
本人浏览器内呈现；过滤会破坏用户手写 HTML 的语义与能力。

**风险与边界**：
- 导入**不可信**的 `.md` / `.docx` / `.pdf` 后，预览中的内联事件（如 `onerror`）可能执行；
  这是用户明确要求并接受的取舍。
- `innerHTML` 插入的 `<script>` 通常不会执行，但事件属性会；不要把该渲染结果嵌入任何
  多用户或远程上下文。
- 若将来接入共享/多人协作，必须在这条边界外重新引入 sanitize。

**验证**：单测断言手写 HTML 与事件属性原样保留；E2E 断言带 `style` 的 `<div>` 与 `<details>`
在预览中真实生效。

---

## ADR-034 · 附件引用计数：无笔记引用即自动回收 ✅

**背景**：附件原本用 `BlobRecord.noteId` 做删除级联，只有「删除笔记」才会清附件。
两条路径会长期泄漏 IDB 空间：① 用户从正文删掉图片引用但笔记还在；② 复制粘贴
`clawclip://` 引用到另一条笔记后，删除原笔记会把共享附件一起删掉（其它笔记裂图）。
仓库体积与 IndexedDB 占用都需要可回收的附件生命周期。

**决策**：
- `BlobRecord` 新增 `refCount`，语义是**引用该附件的笔记数**；同一笔记内多处引用只算 1。
- `LocalDataSource.upsertNote` 在 notes+blobs 的**同一 readwrite 事务**里比对新旧正文引用
  差集：新增 +1、移除 -1；`deleteNote` 在删除笔记的同一事务里递减其全部引用。
- 计数归零立刻删除 blob，并 revoke 缓存 object URL；`noteId` 降级为溯源字段，不再参与删除判定。
- `reconcileBlobRefs()` 以笔记正文为唯一真相源全量校准：重算 `refCount`、修复陈旧
  `attachmentIds`、回收零引用 blob 与旧版本缺失计数的记录。启动引导（渲染前）与
  `importAll()` 后各执行一次；失败不阻塞启动。
- `attachmentIds` 在 `upsertNote` 中由正文重新反填，避免调用方传入陈旧索引污染计数。

**理由**：引用计数把「附件生命周期」与「单条笔记的归属」解耦，复制粘贴、多笔记共享、
正文撤销编辑都能得到正确结果；事务内更新避免笔记与计数不一致。全量 reconcile 兼作
旧库迁移（无需 bump DB 版本）与异常残留的兜底。

**后果**：`upsertNote` / `deleteNote` 事务范围扩大到 notes+blobs，写入略有开销（可忽略）；
启动时多一次全库扫描（笔记量级小）。`saveBlob` 先以 `refCount=0` 落库，若用户在自动保存
前异常退出，下次启动 reconcile 会把它当孤儿回收。

**验证**：`blobStore.spec.ts`（正文提取/校准/旧记录补计数/孤儿回收）、
`local.spec.ts`（移除引用即回收、跨笔记共享不误删、同笔记重复引用只计一次、
导入后重算）、`e2e/s4-attachment.spec.ts`（删除笔记后 blobs store 自动归零）。

---

## ADR-035 · 侧栏标题去掉图标，点击切换显示 commit hash ✅

**背景**：ADR-032 在品牌行标题左侧加入了 favicon 图标。标题本身只是静态文字，
用户希望标题不携带图标，并能在需要时快速确认当前运行的是哪一次提交。

**决策**：
- 移除 `sidebar-logo` 图片及其 `data-dark` 反相 CSS，品牌行只保留等宽 `ClawClip`
  标题与右侧 GitHub 图标。
- 标题改为 `<button data-testid="sidebar-title">`：首次点击显示当前 commit hash 的
  前七位（`data-mode="commit"`），再次点击回到标题文字（`data-mode="title"`）。
- `vite.config.ts` 在 dev/build 启动时执行 `git rev-parse --short=7 HEAD`，通过
  `define` 注入 `__APP_COMMIT__`；`env.d.ts` 声明全局类型并纳入 `tsconfig.app.json`
  的 include。无 git 环境或命令失败时降级为 `unknown`。
- 切换状态只存在组件内存中，不写 URL / localStorage；刷新后回到标题。

**理由**：hash 与该构建产物一一对应，构建期注入无需运行时网络请求、无 GitHub API
限流；按钮语义自带键盘可访问性与焦点样式。标题保持单行省略，hash 同样为等宽 7 位，
不会撑破品牌行。

**后果**：显示的 hash 是**构建时**的 HEAD，而非远端最新提交；页面刷新/重新构建后
才更新。若将来需要实时远端 HEAD，应另接 API 并处理限流与离线回退。

**验证**：`pnpm run type-check` 通过；`pnpm run test:unit` 174 例、
`pnpm run test:e2e` 39 例全绿（E2E 断言 `sidebar-logo` 不存在、点击标题显示
`[0-9a-f]{7}` 或 `unknown`、再点回到 `ClawClip`）。

---

## ADR-036 · 更多菜单新增「格式化」：整篇 Markdown 强制校准 ✅

**背景**：导入的 Markdown 常带有不统一的标题/列表标记间距、连续空行与缺失的
文末换行；手工整理成本高，且不同来源的写法让源码看起来杂乱。需要一键校准。

**决策**：
- 顶栏「更多」菜单**第一项**加入「格式化」（`data-testid="menu-format"`），作用于整篇文档，
  不依赖当前选区。
- 新增纯函数 `src/utils/markdownFormat.ts::formatMarkdown()`，幂等，只做语义安全校准：
  BOM/CRLF 归一、行尾空白（≥2 空格硬换行保留为 2）、ATX 标题间距、无序列表统一 `-`、
  任务列表 `[X]`→`[x]`、有序列表分隔符后间距、引用 `>` 逐级补空格、连续空行压缩为 1、
  文末恰好 1 个换行。**围栏代码块内部原样保留**，表格、强调符号、有序列表编号不重排。
- `MarkdownEditorHandle` 新增 `replaceAll()`：整篇 dispatch 替换并保留撤销历史，
  光标停在原偏移（截断到新文档长度）。格式化走既有自动保存链路，无需额外落库。
- 无改动时提示「格式已符合规范」，有改动时提示「已格式化」（Snackbar）。

**理由**：不引入 Prettier 等重型格式化依赖，避免其对表格/换行/强调的激进重排改变
用户语义；手写规则可单测、可解释、可幂等。菜单第一项符合「高频编辑动作优先」的排序。

**后果**：`#标题`（CommonMark 中本不是标题）会被补空格而变成标题；`1.文本` 因不是合法
列表保持原样。格式化不会修复语法错误，只统一格式。

**验证**：`src/utils/__tests__/markdownFormat.spec.ts` 13 例（各规则 + 幂等 + 代码块保护）；
`e2e/s7-toolbar.spec.ts` 断言格式化是菜单第一项，且标题/列表/任务/引用与预览同步更新。

---

## ADR-037 · 删除笔记改用 M3E dialog；移动端首页复用桌面侧栏 ✅

**背景**：① 删除笔记用 `window.confirm`，与文件夹删除的 M3E dialog 不一致，移动端观感也割裂；
② 移动端首页此前只渲染 `NoteTree`，缺少桌面侧栏的品牌行、GitHub 入口、IDB 统计与明暗切换，
两套形态的功能差距过大。

**决策**：
- 删除笔记改为 `M3eDialog`：菜单点击只打开确认框（`delete-note-dialog`），
  取消/确认分别走 `delete-note-cancel` / `delete-note-confirm`；确认后执行 `remove(noteId)`
  并离开已失效路由。文案明确「仅回收只被该笔记引用的附件」（共享附件按引用计数保留）。
- 从 `Sidebar` 抽出 `SidebarBody`（品牌行 + 页签 + `NoteTree`/`OutlinePane` + 底部 bar）。
  桌面 `Sidebar` 保留“可收起”外壳；移动端首页 `NoteListPane` 直接渲染 `SidebarBody`。
- 移动端不展示大纲页签（`showOutline={false}`）：移动端没有常驻编辑器，返回首页时大纲
  已卸载；共享的 `sidebarTab` 即使停在大纲，移动端也始终渲染文档树。
- 移动端首页保留品牌行（标题/commit 切换 + GitHub）、行级「新建」、文件夹/笔记树、
  IDB 统计与方形明暗切换。

**理由**：同一份 `SidebarBody` 保证两种形态的功能与视觉一致，避免复制 UI；移动端只按
“无编辑器”这一真实约束裁掉大纲页签。M3E dialog 与文件夹删除共用 `.confirm-dialog`
样式和交互范式，减少浏览器原生弹窗带来的阻断感。

**后果**：移动端首页高度结构变为「品牌行 + 树 + 底部 bar」，树的滚动区仍为中间 flex 区；
桌面与移动共享 `sidebarTab` 状态，但移动端强制文档页签。删除笔记不再触发原生 `dialog`
事件，E2E 需点击 M3E 按钮。

**验证**：`pnpm run type-check` 通过；E2E `s4-attachment` 断言删除走 M3E 确认并回收附件；
`s5-shell` 在 390×844 断言品牌行/GitHub/笔记树/统计/明暗切换可见且 `tab-outline` 不存在。

---

## ADR-038 · 导出保真：HTML 自包含、DOCX 原生公式、PDF 矢量打印 ✅

**背景**：三条导出链路各自偷懒：HTML 里 Mermaid 仍是代码块、附件是页面一关就失效的
`blob:` URL；DOCX 把 KaTeX 的 MathML/HTML/TeX 三份内容当普通文本递归，Word 公式乱码，
Mermaid 退化成代码，图片被固定成 480×320；PDF 用 html2canvas 整页截图 + jsPDF 切片，
产物是不可选中/搜索的图片，分页还会从段落中间切断。用户要求三种格式都能「带走后成立」。

**决策**：
- **共用自包含预处理** `prepareExportHtml()`：解析导出副本 → 附件 `blob:`/`http(s):`
  经 `blobToBase64()` 转 data URL → Mermaid 渲染。只处理导出副本，预览仍用 object URL。
- **HTML**：Mermaid 渲染为内联 SVG（`utils/mermaid.ts`，与预览共用同一套逻辑），
  附件内联为 data URL，公式继续走 KaTeX 的原生 MathML；**产物强制浅色主题**，
  不跟随阅读者的系统深色偏好，避免白底/纸面上低对比度。单文件离线可看。
- **DOCX**：从 KaTeX 的 `annotation[encoding="application/x-tex"]` 取原始 TeX，交给
  `docx@9.11.0` 的 **`docx/math::latexToMath()`** 转成 Word 原生 OMML（分式/根式/上下标/
  求和/积分/函数/重音/矩阵/`\text` 均支持，Word 内可点击编辑）；不认识的命令回退 TeX 文本。
  Mermaid 以 `htmlLabels: false` 渲染后经 canvas 转 2× PNG 嵌入；图片按 naturalWidth/Height
  等比缩放到 480×640 以内。`latexToMath` 比手写 MathML→OMML 映射完整得多，且零新增依赖。
- **PDF**：同源 HTML → 隐藏 iframe（794px 桌面宽度）→ `contentWindow.print()`。打印文档
  `buildHtmlDocument(..., { print: true })` 强制浅色 token、只注入浅色高亮、追加
  `@page { size:A4; margin:16mm 15mm }` 与 `break-after/break-inside` 规则，并用
  `print-color-adjust: exact` 保留代码/表头底色。产物是矢量文字、内联 SVG 图表与原生公式；
  代价是系统打印对话框，用户需选择「另存为 PDF」。
- **导出前重渲染**：`renderForExport()` 不再复用预览缓存（120ms 防抖期间 `ready` 仍为
  true，会导出上一版），每次用当前正文重新渲染并等待 `document.fonts.ready`。
- 移除 `html2canvas-pro` / `jspdf` 依赖与旧的 `htmlToPdf()` 光栅路径。

**理由**：浏览器端要同时满足「中文、矢量文字、正确分页、离线自托管」，打印是唯一不需要
内嵌数 MB CJK 字体、也不需要服务端渲染的方案；DOCX 的 `docx/math` 让公式成为真正的 Word
对象而不是图片；Mermaid/附件在导出副本上物化，才能保证文件离开应用后仍然完整。

**后果**：PDF 不再是「点一下直接下载」，需要经过系统打印对话框（已写入 PRD/已知限制）。
`latexToMath` 不支持的 KaTeX 扩展宏会退化为等宽 TeX 文本。导出长文档时 Mermaid/图片
物化需要一点时间；Mermaid 渲染使用 `htmlLabels: false`，与预览的 HTML 标签版本观感略有差异。

**验证**：`exchange.spec.ts` 覆盖附件 data URL、Mermaid 替换、打印文档 `@page`/浅色 token、
`katexToMath` 的分式/根式/重音/矩阵，并用 JSZip 断言 DOCX 的 `word/document.xml` 含
`<m:oMath>`/`<m:f>` 且不含 `application/x-tex`；E2E 覆盖 HTML（`<svg>`、无 `blob:`）、
附件内联（`data:image/png`）、DOCX（含公式与 Mermaid）与 PDF（`clawclip:pdf-print` 事件、
无 download）。

---

## ADR-039 · 视图模式改为会话内瞬态；仅预览时隐藏格式工具栏 ✅

**背景**：ADR-021 把视图三态写进 `settings.viewMode` 并持久化到 localStorage。结果是用户在桌面切到
「仅编辑」后，这个选择会跨刷新/跨设备偏好一直保留，回到页面时拿不到默认工作区；同时移动端默认值
（`split` 在窄屏退化）只存在于运行时代码里，与「桌面分屏、移动仅编辑」的期望语义混在一起。
另外仅预览模式下没有任何可写的源码，顶部的格式工具栏点击后无目标可作用（只能把界面强制拉回编辑），
纯属噪音。

**决策**：
- **视图改为瞬态**：`viewMode` 从 `Settings` / localStorage 移入 `uiStore`，默认 `null` 表示「未手动选择」，
  由 `defaultViewMode(isDesktop)` 解析（桌面 `split`、移动 `edit`）。刷新页面即回到默认值；
  SPA 内切笔记、开合侧栏仍保留本次手动选择。
- **不落 sessionStorage**：`sessionStorage` 会跨刷新存活，与「刷新重置」的语义相反；用模块内的
  zustand 状态即可满足「同一次页面生命周期内记住」。
- **仅预览隐藏工具栏**：`effectiveView === "preview"` 时不渲染 `MarkdownToolbar`，编辑/分屏照常显示。
  工具栏命令在预览态仍保留兜底（切回默认视图后再执行），避免快捷键或残留入口导致「点了没反应」。

**理由**：视图是「这一次怎么看」的工作态，不是「我这个人偏好怎么看」的配置；默认值应当每次进入都成立，
手动切换只服务于当前会话。工具栏的可见性同理应当跟随可编辑性，而不是常驻。

**后果**：用户无法再通过设置永久固定某个视图；旧 localStorage 中的 `viewMode` 字段会被忽略（无迁移成本）。
E2E 增加「刷新后重置」「移动端默认仅编辑且无分屏入口」「预览态无工具栏」三条断言。

**验证**：`uiStore.spec.ts` 覆盖默认值解析、手动选择与不落 localStorage；`e2e/s7-toolbar.spec.ts`
覆盖桌面分屏默认、刷新重置、移动端默认与预览态工具栏隐藏。

---

## ADR-040 · 界面动效：状态过渡而不是装饰动画 ✅

**背景**：界面里所有状态切换都是硬切：侧栏展开/收起直接挂载/卸载、页签内容整块替换、
切文档时主区瞬间换内容、明暗主题颜色跳变、笔记新建/删除行凭空出现/消失、
编辑器「更多」菜单与仅预览时的工具行也是瞬间显隐。用户要求补齐这些过渡。

**决策**：
- **统一的「退场保持」机制**：新增 `hooks/usePresence(visible, exitMs)`，把「是否挂载」与
  「进入/退场状态」拆开。条件渲染的元素在关闭后延迟 `exitMs` 卸载，期间渲染
  `data-state="closing"` 播放退出关键帧。用于侧栏、更多菜单、预览面板。
- **侧栏**：`flex-basis/width/opacity` 过渡；内部内容固定 288px，动画期间只裁剪不重排；
  打开时用 `@starting-style` 从 0 宽淡入。收起动画结束才卸载 DOM。
- **页签**：选中底块改为绝对定位的 `.sidebar-tabs-indicator` 平移（220ms）；
  内容区包一层 `key={activeTab}` 的 `.sidebar-panel`，切换时淡入 + 上移。
- **切换文档**：EditorPane 以 `key=noteId` 重挂载，根节点做 200ms 淡入。
- **明暗主题**：`useThemeTransition` 在 scheme/resolvedScheme 变化时（启动 400ms 后）
  给 `<html>` 打 `data-theme-transition`，`global.css` 只为这段时间对子树开启颜色过渡，
  结束后移除；不使用常驻 `*` 过渡，避免拖慢悬停与输入。
- **仅预览/视图切换**：工作区固定两列 grid，用 `1fr 0fr` 过渡列宽；源码面板不再
  `display:none`，改为透明度 + `visibility`（切回不丢 CodeMirror 文档与撤销历史）。
- **工具行**：常驻在 `grid-template-rows: 1fr → 0fr` 的槽里做高度折叠，
  仅预览时 `data-hidden="true"` + `inert`，出现与消失都连续。
- **更多菜单**：进入 `translateY(-6px) + scale(.96) → 原位`，退出反向；
  退场期间 `pointer-events:none`，避免点击正在消失的菜单项。
- **笔记新建/删除**：`NoteTree` 记录首帧 id 集合，之后新增的 id 播 260ms 入场；
  删除时按上一版分组计算原组内索引，保留 240ms ghost 原位播放退场，再移除。
- **减少动态效果**：`prefers-reduced-motion: reduce` 下把所有动画/过渡压到 1ms。

**理由**：这些过渡表达的是因果关系（谁出现了、谁让位了），不是装饰；用 CSS 关键帧 +
一个小 presence hook 即可覆盖，不引入动画库。列宽/高度过渡让主区与工具行"让位"连续，
比淡入淡出更能说明布局变化。

**后果**：删除笔记后 ghost 会额外存在 240ms（不可点击、`aria-hidden`），
E2E 的「预览时工具行不存在」改为断言 `md-toolbar-slot[data-hidden]` 与可见性；
`@starting-style` 在旧浏览器上退化为无入场动画，功能不受影响。

---

## ADR-041 · 文件拖入侧栏：文档页签直接导入并打开 ✅

**背景**：导入入口此前只有「+」对话框里的「上传笔记」（系统文件选择器），桌面端把
`.md` / `.docx` / `.pdf` 从文件管理器拖进应用是最自然的动作，但应用没有任何自定义拖放处理，
浏览器会直接用文件替换当前页面，把未落库的编辑状态顶掉。

**决策**：
- **投放目标**：`NoteTree`（只在侧栏「文档」页签渲染）。文件悬停时整块树区域显示虚线高亮
  遮罩「松开以导入并打开 · Markdown / DOCX / PDF」；「大纲」页签不接收文件。
- **白名单单一来源**：`exchange.ts` 导出 `IMPORT_EXTENSIONS / IMPORT_ACCEPT /
  isImportableFile()`，「上传笔记」的 `accept` 与拖放过滤共用，避免两处名单漂移。
- **复用导入链路**：每个文件调用 `useImportDocument`，与「上传笔记」完全一致——
  `importDocument()` 解析 → 新建笔记（归属当前选中文件夹）→ 保存正文 → 跳转编辑器。
  多文件按顺序导入，最后打开的笔记留在编辑器。
- **与树内拖拽共存**：仅当 `dataTransfer.types` 含 `Files` 时走导入；内部笔记/文件夹拖拽
  保持原有移动/排序语义。笔记行与文件夹行对文件拖拽不再 `stopPropagation`，冒泡到树容器统一处理。
- **全局兜底**：`AppShell` 在 window 上对 `Files` 拖拽统一 `preventDefault()`，
  保证拖到大纲页签、编辑器空白处等无处理区域时不会让浏览器打开文件。
- **交互提示**：白名单外的文件在 drop 时提示「仅支持 Markdown / DOCX / PDF 文件」，
  合法的继续导入。

**理由**：导入本质是「新建笔记 + 写入正文」，与既有 hook 完全同构，不需要新解析路径；
投放目标限定在文档页签，语义清晰且与「在哪个文件夹下新建」的既有上下文一致。

**后果**：拖入导入落在当前选中文件夹（与「上传笔记」相同）；PDF 仍受启发式还原限制（见 PRD）。
E2E 覆盖「树区域拖入 md → 新建并打开」与「拖到已有笔记行上冒泡导入」两条路径。

---

## ADR-042 · 文件夹操作收进三点 popover，重命名改为行内确认 ✅

**背景**：文件夹行悬停时直接露出「编辑 / 删除」两个按钮，删除还能被误触；同时重命名只能靠
Enter 或失焦结束，鼠标用户没有明确的确认/取消出口。行内两个常驻语义动作也让窄侧栏更拥挤。

**决策**：
- **三点按钮 + popover**：文件夹行悬停/聚焦时只显示 `more_horiz`，点击弹出 176px 菜单
  （重命名 / 删除，删除为危险色）。菜单用 `createPortal` 挂到 `.app-shell`：
  既继承 `m3e-theme` 的 CSS token，又避开 `.sidebar-panel` 入场动画 `transform` 建立的
  fixed 包含块（否则 `position: fixed` 会相对面板定位而错位）。
- **定位**：按按钮 `getBoundingClientRect()` 做固定定位，右对齐并夹在视口内；
  下方空间不足时向上翻。菜单打开期间窗口 resize / 任意滚动（capture）即关闭，
  避免固定坐标与滚动内容脱节；Esc 与点击遮罩同样关闭。
- **重命名**：菜单项触发后，行内输入框右侧出现 `check`（确认）与 `close`（取消）；
  三点按钮不再渲染。按钮 `onMouseDown` 阻止默认，避免输入框 blur 抢先提交；
  确认/取消结束后三点按钮回归。重命名期间整行 `draggable=false`，防止拖走。
- **删除**：菜单项仅负责关闭菜单并打开既有 M3E 二次确认 dialog，动作语义不变；弹窗关闭后回归。

**理由**：三点菜单把低频破坏性操作收进一层明确的意图确认，行本身恢复为「选择/开合」；
行内 ✓/✕ 给鼠标用户与触屏用户明确的结束路径，同时保留 Enter / Esc / 失焦的键盘习惯。

**后果**：E2E 需要先打开菜单再点重命名/删除；新增断言覆盖「菜单两项」「重命名态隐藏三点」
「✓ 落库」「✕ 不落库并恢复」。菜单为固定定位，打开后滚动会自动关闭（可接受）。


---

## ADR-043 · 大纲跳转：以当前视图为落点，并即时重解析目标位置 ✅

**背景**：两个相互独立的问题让「点大纲跳标题」不够可靠：
1. 侧栏大纲由 `value` 防抖 120ms 派生，跳转却直接用条目里的旧 `pos`（字符偏移）。
   期间只要正文变长（粘贴、连续输入，尤其是上传附件插入的
   `![名称](clawclip://blob/…)` 引用），所有标题偏移都会整体后移，点击就落到错行——
   概率不高但很显眼；
2. 跳转无条件 `editor.scrollTo()`。仅预览模式下源码列收为 `0fr` 且不可见，
   焦点和光标被塞进看不见的地方，预览面板纹丝不动。

**决策**：
- **点击时重解析**：`OutlinePane` 在点击时取编辑器**实时正文**（`getActiveEditorValue()`，
  不是 React state），同步跑一次 `extractOutline()`，再用 `resolveOutlineTarget()`
  按「序号 → 级别+文本 → 同序号同级别」三级校验找回对应标题，用新的 `pos` 跳转。
  解析失败才退回旧 `pos`。此时 markdownRender 早已加载，无额外体积代价。
- **落点跟随视图**：`activeEditor` 模块增加「导航器」注册位。`EditorPane` 按当前
  `effectiveView` 注册策略：编辑 / 分屏 → CodeMirror `scrollTo(pos)`（保留聚焦与光标）；
  仅预览 → 在预览 DOM 里按「级别+文本」找 `h*`（手写 HTML 的标题可能打乱序号，
  序号仅作兜底）并 `scrollIntoView({ block: "start" })`，**不**把焦点塞进隐藏编辑器。
- **预览防抖补偿**：预览 HTML 同样 120ms 防抖。找不到目标时把跳转挂起，
  等下一次 `html` 提交后再补跳一次，避免「点了没反应」。

**理由**：大纲是「位置索引」，正文才是位置的真相源；任何缓存的偏移都只能是提示，
不能当作权威。落点则是「用户此刻在看什么」的直接映射——在哪里看，就滚哪里。

**后果**：跳转从一次同步调用变成一次动态 import + 解析（模块已缓存，实际同步完成）；
预览端依赖 `.md-preview-content` 内的标题节点，若正文尚未渲染会延迟到下一次渲染。

**验证**：`utils/__tests__/outline.spec.ts` 覆盖偏移后移、插入新标题、标题改名、找不到
四种情形；E2E 覆盖「分屏下跳转后活动行就是目标标题」「仅预览下预览面板滚动且标题贴顶、
源码编辑器不获焦」。

---

## ADR-044 · 选中态压过活动行底色；选中后敲标记自动包裹 ✅

**背景**：
1. 光标行高亮用 `.cm-activeLine::before` 铺满整行全宽，为了压住正文/行号，给
   `.cm-activeLine` 加了 `z-index: 0`。这会让每一行都成为层叠上下文，
   而 CodeMirror 的选择层（`.cm-selectionLayer`）是 `z-index: -1`——
   于是活动行的不透明底色直接盖住选中背景，「选中了却看不出来」。
2. 选中文字后敲 `*`、`$` 等字符，浏览器默认行为是**替换**选区。用户的心智是
   「给这段字加斜体/公式」，而不是「用星号覆盖这段话」。

**决策**：
- **把行底色压到选择层之下**：`.cm-activeLine` 只保留 `position: relative`
  （定位 `::before` 所需），不再设 `z-index`（否则整行成为层叠上下文，行底色被锁在
  选择层之上）；`::before` 的 `z-index` 取 `-100`。CodeMirror 给各 layer 写的是
  内联 `-1 - 层序`（实测选择层为 `-2`），固定 `-1` 仍然会盖住选中态；
  `-100` 确保行底色排在选择层之下，同时仍高于滚动容器背景，正文文字绘制在最上层。
- **选中色固定为青色**（`rgba(0,188,212,.34)`，焦点态 + 1px 内描边，失焦 22%）：
  主色是可被用户改成任意 seed 的变量（默认桃粉），与同样带主色倾向的
  `surface-container-high` 行底色同属暖色，只差明度；青色与明暗两种表面都能拉开
  色相。变量定义在 `.editor-source-pane`（editor.css），CodeMirror 主题只消费
  `var(--editor-selection-*)`。CodeMirror 自带主题的
  `.cm-scroller > .cm-selectionLayer` 选择器优先级更高，用重复类名提权覆盖，
  而不是依赖样式注入顺序。
- **敲标记包裹选区（单一拦截点）**：统一在 `EditorView.inputHandler` 里按「实际落进
  文档的字符」拦截（单选区、非组合输入、非空选区），用纯函数 `wrapSelection()` 在
  选区两侧插入同一标记，**并保持内文仍选中**。**只挂这一个拦截点**：曾经额外挂
  `keydown` 做即时拦截，但部分环境（英文键盘/输入法）`preventDefault()` 之后仍会再
  派发一次 `input`，两条路径各包一次——敲一下 `*` 直接变成 `**…**`（粗体），中文输入法
  因为 keydown 被吞反而只加一层。现在一次按键只加一层：`*` 斜体、`**` 粗体、
  `***` 粗斜体；`~`→`~~`、`=`→`==`、`$`→`$$` 同理，`^` 一次即得 `^上标^`。
  非标记字符仍走默认输入（替换选区）。
- **中文斜体要显式开启合成**：PingFang SC 等 CJK 字体不带 italic 面，Chrome 在字体族
  没有斜体面时默认**不会**为 CJK 合成倾斜——`font-style: italic` 的计算值正确、编辑器
  与预览里的中文却纹丝不动，只有 `*` 这类拉丁字符（回退到 Menlo Italic）看起来是斜的。
  因此在编辑器 `.cm-content` 与预览 `.md-preview-content em` 上都显式声明
  `font-synthesis: style`，让回退字体也走合成倾斜。
- **标记必须紧贴文字**：`wrapSelection()` 先把选区两端的空白（含换行）裁到标记外。
  Markdown 的强调/高亮/上下标都要求标记紧邻文字，`* 文字 *` 或
  `*文字` + 换行 + `*` 在预览里只会原样显示标记——三击选整行、双击选词常把行尾空白
  一起选进来，这正是「标记识别到了却没渲染」的根因。
- **输入法兼容**：中文输入法在中文标点模式下会插入全角 `＊＿～｀＄＾＝`，
  而英文键盘插入半角。输入层统一用 `markerFromInput()` 把两者归一为 Markdown 需要的
  半角标记，英文/中文输入法行为一致；`view.composing` 为真时不动，避免打断正在进行的
  组合输入。

**理由**：行底色是「我在哪」，选中是「我要操作什么」，后者必须更醒目；
标记包裹是 Markdown 编辑器最基础的肌肉记忆，保留选区则让「同一段文字连续加标记」
（斜体→加粗、加粗→公式）变成自然的组合动作。

**后果**：选中区域内的文字会蒙上一层青色调，但文字本身绘制在叠色之上，
可读性不受影响；青色不随主色 seed 变化。`Shift+*` 等组合键、多选区与 IME 组合过程不拦截。
不再能「选中文字后直接输入一个字面量 `*`」，需要先取消选区或输入后撤销。

**验证**：`markdownCommands.spec.ts` 覆盖 `*`/`$`/`~`/`` ` ``/`_`/`^`/`=` 包裹、
连敲升级、空选区与纯空白选区不改动、两端空白/换行裁到标记外、全角标记归一；
E2E 覆盖「敲 `*` 得到 `*hello*` 且内文仍选中」「连敲逐层加标记：`*`→斜体、
`**`→粗体、`***`→粗斜体（预览分别为 `<em>`/`<strong>`/`<em><strong>`）」
「`$` 嵌套在内侧」「选入行尾换行后斜体仍在预览渲染」「`^` 渲染为 `<sup>`、
`==` 渲染为 `<mark>`」「编辑器与预览的 CJK 斜体都显式开启 `font-synthesis: style`」「输入法插入全角 `＊` 同样包裹且落库为半角」
「活动行不创建层叠上下文、行底色 z-index 低于选择层、选中色为青色且带透明度」。

---

## ADR-045 · 支持 GitHub 风格警报框（> [!NOTE] 等） ✅

**背景**：GitHub 的 alert 语法（`> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` /
`[!CAUTION]`）在 README、issue 与笔记中已经相当常见。导入这类 Markdown 时，预览只会把它
渲染成普通引用，`[!NOTE]` 原样显示，既不好看也不符合原文语义。

**决策**：
- **自建 core 规则，不引入依赖**：在 `inline` 之后重写 token 流——找到块引用第一段开头的
  标记，把 `blockquote_open/close` 的 tag 改成 `div` 并挂 `md-alert md-alert-<type>`，
  再插入一个 `md-alert-title` 段落（标题文案取类型名 `Note` / `Tip` / …）。
- **只认第一段开头**：普通引用、以及出现在后续段落里的 `[!NOTE]` 都不改写；嵌套引用用
  深度计数找配对的关闭 token。标记大小写不敏感；`[!TIP] 正文` 这种同一行写法也支持。
- **标记独占首行时**删掉空的首段，只留标题；同一行有正文时重解析剩余 inline 内容。
- **样式与导出同源**：警报框 CSS 写进 `DEFAULT_PREVIEW_CSS`，预览、HTML 导出与 PDF 打印
  自动一致。左侧 4px 色条 + 同色系 9% 浅底 + 圆点标题；颜色用语义色（蓝/绿/紫/黄/红），
  不跟随主色 seed，标题文字仍用 on-surface 保证对比度。
- **DOCX 单独走分支**：`blockChildren()` 识别 `.md-alert`，标题渲染为加粗语义色段落并带
  左侧色条，正文按普通块递归（列表、图片等不丢）；mammoth 反向导入时退化为普通段落，
  内容完整。

**后果**：标题文案固定为英文（与 GitHub 一致），不做自定义标题；标记行在预览/导出中消失；
编辑器源码里仍显示原始标记（没有额外语法高亮）。非 GitHub 的 alert 方言（如 `[!DANGER]`）
不会被识别。

**验证**：`markdownRender.spec.ts` 覆盖五种类型、同一行正文、空正文、多段正文、
普通引用与后续段落不被误判、大小写不敏感；E2E 覆盖预览容器/标题/类型色条与
DOCX 往返导出后正文与标题仍在。
