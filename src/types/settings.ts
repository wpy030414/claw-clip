/** 主题与编辑器偏好设置类型。 */

/** M3E scheme：auto 跟随系统，light/dark 强制。 */
export type Scheme = "auto" | "light" | "dark";
/** 解析后的实际明暗（auto → light/dark），供预览高亮主题等消费。 */
export type ResolvedScheme = "light" | "dark";
/** M3E contrast 等级。 */
export type Contrast = "standard" | "medium" | "high";
/** M3E motion 风格。 */
export type Motion = "standard" | "expressive";
export interface Settings {
  scheme: Scheme;
  /** M3E 主题 seed 色，默认对齐旧 pink / 桃粉。 */
  seedColor: string;
  contrast: Contrast;
  /** M3E density scale（0 标准，负值更紧凑）。 */
  density: number;
  motion: Motion;
  /** 编辑器字号 px。 */
  fontSize: number;
  /** 预览/打印主题 CSS（追加在内置排版样式之后；空串使用内置样式）。 */
  previewCss: string;
  /** 编辑工作区视图：仅编辑 / 编辑+预览分屏 / 仅预览。 */
  viewMode: "edit" | "split" | "preview";
}

/** 默认设置。seedColor = #FFAACC（桃粉，对齐旧 Element Plus primary=pink）。 */
export const DEFAULT_SETTINGS: Settings = {
  scheme: "auto",
  seedColor: "#FFAACC",
  contrast: "standard",
  density: 0,
  motion: "expressive",
  fontSize: 16,
  previewCss: "",
  viewMode: "split",
};
