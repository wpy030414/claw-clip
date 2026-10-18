/**
 * integrationStore 单测：默认值、PAT 记忆开关与持久化白名单。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useIntegrationStore } from "@/stores/integrationStore";

const DEFAULTS = {
  imageHost: "local" as const,
  gistToken: "",
  rememberToken: true,
  gistId: "",
  lastSyncAt: null,
  lastSyncDirection: null,
  imageHostCount: 0,
  imageHostBytes: 0,
};

function persisted(): Record<string, unknown> {
  const raw = localStorage.getItem("claw-clip-integrations");
  return raw ? (JSON.parse(raw) as { state: Record<string, unknown> }).state : {};
}

beforeEach(() => {
  localStorage.clear();
  useIntegrationStore.setState(DEFAULTS);
});

describe("integrationStore", () => {
  it("默认：本地图床、记住令牌", () => {
    const state = useIntegrationStore.getState();
    expect(state.imageHost).toBe("local");
    expect(state.rememberToken).toBe(true);
  });

  it("记住令牌时 PAT 写入 localStorage", () => {
    useIntegrationStore.getState().setGistToken("ghp_secret");
    expect(persisted().gistToken).toBe("ghp_secret");
  });

  it("取消记住会立即清除内存与 localStorage 中的 PAT", () => {
    useIntegrationStore.getState().setGistToken("ghp_secret");
    useIntegrationStore.getState().setRememberToken(false);

    expect(useIntegrationStore.getState().gistToken).toBe("");
    expect(persisted()).not.toHaveProperty("gistToken");
  });

  it("clearGist 清除 PAT 与 Gist id，但保留图床偏好", () => {
    useIntegrationStore.setState({ imageHost: "scdn", gistId: "g1" });
    useIntegrationStore.getState().setGistToken("ghp_secret");
    useIntegrationStore.getState().clearGist();

    const state = useIntegrationStore.getState();
    expect(state.gistToken).toBe("");
    expect(state.gistId).toBe("");
    expect(state.imageHost).toBe("scdn");
  });

  it("累计上传统计递增", () => {
    useIntegrationStore.getState().recordImageUpload(100);
    useIntegrationStore.getState().recordImageUpload(50);
    expect(useIntegrationStore.getState().imageHostCount).toBe(2);
    expect(useIntegrationStore.getState().imageHostBytes).toBe(150);
  });
});
