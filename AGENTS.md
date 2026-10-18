# AGENTS.md

本文件是仓库级开发约定，补充产品文档，不替代它们。

## 语言

- 代码注释、文档、提交信息默认使用简体中文。
- 变量名、类型名、API 与命令使用英文。

## 工具链

- 包管理器是 **pnpm**，锁文件为 `pnpm-lock.yaml`；不要在 `package.json` 写 `packageManager` 字段。
- 构建、检查、测试统一走 **Vite+（vp）**：`vp dev` / `vp build` / `vp check` / `vp test`。
- `vp check` 是提交前的硬门禁（格式 + lint + 类型）；本地可用 `vp check --fix` 自动修复。
- 下载依赖优先使用中国境内镜像：`pnpm config set registry https://registry.npmmirror.com`。

## 结构约束

- 分层与依赖方向见 `docs/ARCHITECTURE.md` §1；`src/data`、`src/stores`、`src/hooks`、`src/utils` 不依赖 React 组件。
- 新增数据访问能力先进 `src/data/datasource` 门面，再接入 store，不要在组件里直接开 IndexedDB。
- 正文持久引用一律使用 `clawclip://blob/<id>`；`blob:` URL 不得写入 IndexedDB。

## 本地优先

- 应用是纯前端 SPA，没有自建服务端与数据库服务。
- 任何联网能力必须是可选的用户主动操作（Gist 同步、图床），离线时核心编辑与导出必须完整可用。
- 不得在构建期写入密钥；`VITE_*` 变量会进入前端产物，视为公开。

## 路径与部署

- `base` 由 `PAGES_BASE_PATH` 注入（`vite.config.ts`），代码不推断仓库名。
- HTML 用 `%BASE_URL%`，TS 用 `import.meta.env.BASE_URL`；CSS 资源用相对路径，避免手写 base 前缀。
- GitHub Pages 没有服务端重写：新增路由必须兼容 HashRouter 或构建期 `404.html` 回退。

## 测试

- 纯逻辑（data / stores / hooks / utils）必须有 Vitest 单测，使用 jsdom + fake-indexeddb。
- 影响用户可见流程的改动应补 Playwright E2E；外部网络请求在测试中用 `page.route` mock。
- 验收前至少跑通：`vp check`、`vp test run`、`pnpm run build`。

## 文档

- 行为或架构变化同步更新 `docs/ARCHITECTURE.md`；有取舍的决策追加到 `docs/DECISIONS.md`（含背景 / 决策 / 理由 / 后果 / 验证）。
- 需求变化同步 `docs/PRD.md`。

## 提交

- 遵循 Conventional Commits：type 与 scope 用英文，描述用简体中文。
- subject 不超过 72 字符，只概括改动类型；具体改动在 body 中逐条分点说明，subject 与 body 之间空一行。
- 不提交 `dist/`、`coverage/`、`test-results/` 或任何本地密钥。
