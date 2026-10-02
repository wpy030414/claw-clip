/**
 * @m3e/react 集中再导出。
 *
 * M3E 无根导出、必须走 subpath；且标签前缀是 m3e-（非 m3-）。
 * 本文件把所有用到的组件收敛到一处，将来若 subpath/命名变动只改这里（缓解 R3 bus-factor）。
 * 下列符号名均经 node_modules/@m3e/react/dist/src/*\/*.d.ts 实测核对（2026-10-02）。
 */

// —— 主题 ——
export { M3eTheme, M3eThemeIcon } from "@m3e/react/theme";

// —— 基础动作 ——
export { M3eButton } from "@m3e/react/button";
export { M3eIconButton } from "@m3e/react/icon-button";
export { M3eFab } from "@m3e/react/fab";
export { M3eIcon } from "@m3e/react/icon";

// —— 导航（响应式双形态：宽屏 nav-rail / 窄屏 nav-bar）——
// 注意：nav-rail 只有 M3eNavRail + M3eNavRailToggle；rail 内导航项复用 M3eNavItem（来自 nav-bar）。
export { M3eNavRail, M3eNavRailToggle } from "@m3e/react/nav-rail";
export { M3eNavBar, M3eNavItem } from "@m3e/react/nav-bar";

// —— 布局容器 ——
export { M3eSplitPane } from "@m3e/react/split-pane";
export { M3eToolbar } from "@m3e/react/toolbar";
export { M3eCard } from "@m3e/react/card";
export { M3eDivider } from "@m3e/react/divider";
export { M3eToc } from "@m3e/react/toc";
export { M3eTree, M3eTreeItem } from "@m3e/react/tree";

// —— 浮层 / 反馈 ——
export { M3eDialog, M3eDialogAction, M3eDialogTrigger } from "@m3e/react/dialog";
export { M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@m3e/react/menu";
export { M3eTooltip, M3eRichTooltip } from "@m3e/react/tooltip";
// Snackbar 是命令式 API：M3eSnackbar.open(text, actionLabel?, opts?)
export { M3eSnackbar } from "@m3e/react/snackbar";

// —— 表单 / 输入（M3E 无 text-field，文本录入用 M3eFormField 包原生 input）——
export { M3eFormField } from "@m3e/react/form-field";
export { M3eTextareaAutosize } from "@m3e/react/textarea-autosize";
export { M3eSwitch } from "@m3e/react/switch";
export { M3eCheckbox } from "@m3e/react/checkbox";
export { M3eSelect } from "@m3e/react/select";

// —— 搜索 / 标签 ——
export { M3eSearchBar, M3eSearchView } from "@m3e/react/search";
export { M3eChip, M3eFilterChip, M3eChipSet, M3eFilterChipSet } from "@m3e/react/chips";

// —— 列表 / 选项卡 ——
export { M3eList, M3eListItem, M3eActionList } from "@m3e/react/list";
export { M3eTabs, M3eTab, M3eTabPanel } from "@m3e/react/tabs";
