# 鲨鱼夹 · ClawClip

本地优先的 Markdown 笔记工作站。所有笔记、文件夹与附件都保存在浏览器 IndexedDB 里，不上传服务器；可选接入 GitHub Gist 做手动全库快照。

## 功能

- **Markdown 工作站**：CodeMirror 6 源码编辑 + markdown-it 实时预览，编辑 / 分屏 / 预览三态切换。
- **扩展语法**：GFM 表格与任务列表、脚注、定义列表、上下标、高亮、KaTeX 公式、Mermaid 图表、GitHub 风格警报框。
- **文件夹树**：多级文件夹、拖拽归属、行内重命名、折叠与级联删除。
- **本地附件**：粘贴 / 拖入图片存 IndexedDB，正文用 `clawclip://blob/<id>` 持久引用。
- **导入导出**：Markdown / HTML / DOCX / PDF 互导；全库备份为单个 JSON。
- **存储管理**：IndexedDB 用量、附件回收、可选图床迁移与 GitHub Gist 云同步。
- **响应式双形态**：桌面分屏工作区与移动端单栏编辑共用同一套路由与状态。

## 技术栈

Vite 8（Vite+ / Rolldown）· React 19 · TypeScript 5.9 · Zustand · React Router 7 · CodeMirror 6 · markdown-it · @m3e/web（Material 3 Web Components）· IndexedDB · Vitest · Playwright。

## 快速开始

要求 Node.js ≥ 24 与 pnpm。

```bash
pnpm install
pnpm run dev        # http://localhost:24680/
```

## 常用脚本

| 命令                 | 作用                                           |
| -------------------- | ---------------------------------------------- |
| `pnpm run dev`       | 启动开发服务器（端口 24680）                   |
| `pnpm run build`     | 类型检查 + 生产构建 + 生成 SPA 回退 `404.html` |
| `pnpm run preview`   | 预览 `dist/`                                   |
| `pnpm run check`     | `vp check`：格式 + lint + 类型检查             |
| `pnpm run test:unit` | Vitest 单测                                    |
| `pnpm run test:e2e`  | Playwright E2E（自动拉起 dev server）          |

`vp check --fix` 可自动修正格式问题。

## 部署

推送到 `main` 后由 `.github/workflows/deploy.yml` 构建并发布到 GitHub Pages。

- **项目页**（`https://<user>.github.io/<repo>/`）：仓库变量 `PAGES_BASE_PATH` 留空，CI 自动取 `/<repo>/`。
- **用户页 / 自定义域**：在仓库 **Settings → Variables → Actions** 把 `PAGES_BASE_PATH` 设为 `/`。

`base` 只由该环境变量注入，代码里不写死仓库名。本地默认根路径；如需验证子路径部署：

```bash
PAGES_BASE_PATH=/claw-clip/ pnpm run dev
PAGES_BASE_PATH=/claw-clip/ pnpm run build
```

## 数据与隐私

- 笔记、文件夹、附件仅存于当前浏览器的 IndexedDB 库 `claw-clip-v2`，清除站点数据会一并删除。
- 云同步使用用户自己的 GitHub PAT（仅需 `gist` 权限），可选是否保存在本机 localStorage。
- 构建期没有任何密钥：`VITE_*` 变量会被内联进前端产物，一律视为公开。

## 目录

```
src/
├── pages/        路由页面
├── layouts/      桌面 / 移动外壳
├── features/     业务域（notes / folders / editor / preview / storage）
├── components/   展示组件与 M3E 封装
├── hooks/        业务逻辑编排
├── stores/       Zustand 状态
├── data/         数据访问层（IndexedDB / 导入导出 / 云同步 / 图床）
├── styles/       设计 token 与全局样式
└── types/ utils/ 类型与纯函数
```

依赖方向自上而下，`data / stores / hooks / utils` 不依赖 React 组件。

## 文档

- [产品需求](docs/PRD.md)
- [架构说明](docs/ARCHITECTURE.md)
- [架构决策记录](docs/DECISIONS.md)
- [开发约定](AGENTS.md)
