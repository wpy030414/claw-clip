import { describe, expect, it } from "vitest";
import { resolveOutlineTarget } from "@/utils/outline";

const shown = [
  { level: 1, text: "一级标题", pos: 0 },
  { level: 2, text: "二级标题", pos: 10 },
  { level: 2, text: "另一个标题", pos: 20 },
];

describe("resolveOutlineTarget", () => {
  it("上传附件后偏移整体后移：用实时 pos，而不是侧栏里的旧 pos", () => {
    // 文档开头插入了一段附件引用，所有 pos 都后移了 40
    const fresh = shown.map((h) => ({ ...h, pos: h.pos + 40 }));
    const resolved = resolveOutlineTarget(fresh, shown[1], 1);
    expect(resolved?.target.pos).toBe(50);
    expect(resolved?.index).toBe(1);
  });

  it("序号对不上（前面插入了新标题）：按级别 + 文本找回", () => {
    const fresh = [
      { level: 1, text: "新加的开头", pos: 0 },
      ...shown.map((h) => ({ ...h, pos: h.pos + 8 })),
    ];
    const resolved = resolveOutlineTarget(fresh, shown[2], 2);
    expect(resolved?.target.text).toBe("另一个标题");
    expect(resolved?.index).toBe(3);
  });

  it("标题文字刚被改过：同序号且同级别时仍按原位跳", () => {
    const fresh = shown.map((h, i) =>
      i === 1 ? { ...h, text: "改过的二级标题" } : h,
    );
    const resolved = resolveOutlineTarget(fresh, shown[1], 1);
    expect(resolved?.target.text).toBe("改过的二级标题");
    expect(resolved?.index).toBe(1);
  });

  it("找不到对应标题时返回 null（调用方退回旧 pos）", () => {
    const fresh = [{ level: 1, text: "完全不同的标题", pos: 0 }];
    expect(resolveOutlineTarget(fresh, shown[1], 1)).toBeNull();
    expect(resolveOutlineTarget([], shown[0], 0)).toBeNull();
  });
});
