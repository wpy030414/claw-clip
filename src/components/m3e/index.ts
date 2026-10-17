/**
 * @m3e/react 集中再导出（只保留当前实际使用的组件）。
 *
 * ★ 为什么按需白名单而不是全量再导出：
 *   M3E 的每个 subpath 都会在模块副作用里注册 custom element，无法被 tree-shaking 掉。
 *   全量再导出会把未使用的树/表格/日期选择器等一并打进首屏包体。新增组件时在此追加。
 *
 * M3E 无根导出、必须走 subpath；且标签前缀是 m3e-（非 m3-）。
 */

// —— 主题 ——
export { M3eTheme } from "@m3e/react/theme";

// —— 反馈（命令式 API：M3eSnackbar.open）——
export { M3eSnackbar } from "@m3e/react/snackbar";

// —— 浮层 ——
export { M3eDialog } from "@m3e/react/dialog";
