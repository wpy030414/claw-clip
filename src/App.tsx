/**
 * S1 阶段 Hello World：验证 M3E 主题 token 生效 + 明暗跟随系统。
 * 后续阶段替换为 RouterProvider + AppShell。
 */
import { M3eTheme, M3eButton, M3eSnackbar } from "@/components/m3e";

export function App() {
  return (
    <M3eTheme
      color="#FFAACC"
      scheme="auto"
      variant="expressive"
      contrast="standard"
      density={0}
      motion="expressive"
    >
      <div style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h1 style={{ color: "var(--md-sys-color-primary)" }}>
          鲨鱼夹 | ClawClip — React 重写 S1
        </h1>
        <p style={{ color: "var(--md-sys-color-on-surface-variant)" }}>
          M3E 主题已挂载。明暗跟随系统偏好。
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <M3eButton variant="filled" onClick={() => M3eSnackbar.open("主题验证成功", "好的")}>
            填充按钮
          </M3eButton>
          <M3eButton variant="outlined" onClick={() => M3eSnackbar.open(" outlined 按钮", "关闭")}>
            描边按钮
          </M3eButton>
        </div>
        <div
          style={{
            marginTop: "1rem",
            padding: "1rem",
            background: "var(--md-sys-color-surface-container)",
            borderRadius: "12px",
            color: "var(--md-sys-color-on-surface)",
          }}
        >
          此块消费 <code>--md-sys-color-*</code> token，验证方案 B 技术前提（light-DOM 可继承 M3E token）。
        </div>
      </div>
    </M3eTheme>
  );
}
