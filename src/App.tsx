/**
 * App 根：ThemeProvider（M3E token）+ 路由树。
 * 响应式双形态由 AppShell 按断点分派（S5）。
 */
import { RouterProvider } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { router } from "@/router";

export function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
