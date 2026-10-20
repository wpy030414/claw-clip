/**
 * front matter 识别与已知字段投影单测。
 *
 * 覆盖：闭合判定、BOM/CRLF、title/tags 的各种常见写法、
 * 未知键与非法 YAML 的容错，以及剥离后的偏移。
 */
import { describe, expect, it } from "vite-plus/test";
import { parseFrontMatter, stripFrontMatter } from "@/utils/frontMatter";

const wrap = (inner: string, close = "---") => `---\n${inner}\n${close}\n# 正文\n`;

describe("识别与剥离", () => {
  it("普通文档没有 front matter", () => {
    const info = parseFrontMatter("# 标题\n\n正文");
    expect(info.present).toBe(false);
    expect(info.end).toBe(0);
    expect(stripFrontMatter("# 标题\n\n正文")).toBe("# 标题\n\n正文");
  });

  it("首行不是 --- 时不识别（允许 BOM）", () => {
    expect(parseFrontMatter("\n---\ntitle: x\n---\n").present).toBe(false);
    expect(parseFrontMatter("﻿---\ntitle: x\n---\n").present).toBe(true);
  });

  it("没有闭合分隔线时整段当普通正文", () => {
    const src = "---\ntitle: 半成品\n\n正文还在输入";
    const info = parseFrontMatter(src);
    expect(info.present).toBe(false);
    expect(info.raw).toBe("");
    expect(stripFrontMatter(src)).toBe(src);
  });

  it("支持 --- 与 ... 两种闭合分隔线", () => {
    expect(parseFrontMatter("---\ntitle: a\n---\n正文").present).toBe(true);
    expect(parseFrontMatter("---\ntitle: a\n...\n正文").present).toBe(true);
  });

  it("空区块也算存在", () => {
    const info = parseFrontMatter("---\n---\n正文");
    expect(info.present).toBe(true);
    expect(info.title).toBeNull();
    expect(info.tags).toEqual([]);
    expect(stripFrontMatter("---\n---\n正文")).toBe("正文");
  });

  it("兼容 CRLF，并按原始偏移切出正文", () => {
    const src = "---\r\ntitle: 标题\r\ntags: [a, b]\r\n---\r\n# 正文\r\n";
    const info = parseFrontMatter(src);
    expect(info.present).toBe(true);
    expect(info.title).toBe("标题");
    expect(info.tags).toEqual(["a", "b"]);
    expect(src.slice(info.end)).toBe("# 正文\r\n");
    expect(info.lineCount).toBe(4);
  });

  it("lineCount 跳过区块占用的行，end 指向区块之后", () => {
    const src = "---\ntitle: x\ntags:\n  - a\n---\n\n# 正文";
    const info = parseFrontMatter(src);
    expect(src.slice(info.end)).toBe("\n# 正文");
    expect(info.lineCount).toBe(5);
  });

  it("区块原文包含 BOM 与分隔线，便于原样保留", () => {
    const src = "﻿---\ntitle: x\n---\n正文";
    const info = parseFrontMatter(src);
    expect(info.raw).toBe("﻿---\ntitle: x\n---\n");
  });
});

describe("title 提取", () => {
  it("普通标量", () => {
    expect(parseFrontMatter(wrap("title: 我的文章")).title).toBe("我的文章");
  });

  it("双引号 / 单引号，引号内的 # 与逗号不受影响", () => {
    expect(parseFrontMatter(wrap('title: "a # b, c"')).title).toBe("a # b, c");
    expect(parseFrontMatter(wrap("title: 'it''s ok'")).title).toBe("it's ok");
  });

  it("未加引号时空白后的 # 视为注释", () => {
    expect(parseFrontMatter(wrap("title: 标题 # 备注")).title).toBe("标题");
  });

  it("块标量 title", () => {
    expect(parseFrontMatter(wrap("title: |\n  第一行\n  第二行")).title).toBe("第一行\n第二行");
  });

  it("缺失或空值返回 null", () => {
    expect(parseFrontMatter(wrap("tags: [a]")).title).toBeNull();
    expect(parseFrontMatter(wrap('title: ""')).title).toBeNull();
  });
});

describe("tags 提取", () => {
  it("行内数组（含引号与逗号）", () => {
    expect(parseFrontMatter(wrap("tags: [工作, \"机器, 学习\", '笔记']")).tags).toEqual([
      "工作",
      "机器, 学习",
      "笔记",
    ]);
  });

  it("块列表（缩进与顶格都支持）", () => {
    expect(parseFrontMatter(wrap("tags:\n  - 工作\n  - 笔记")).tags).toEqual(["工作", "笔记"]);
    expect(parseFrontMatter(wrap("tags:\n- 工作\n- 笔记")).tags).toEqual(["工作", "笔记"]);
  });

  it("逗号分隔的普通字符串", () => {
    expect(parseFrontMatter(wrap("tags: 工作, 笔记")).tags).toEqual(["工作", "笔记"]);
  });

  it("去 # 前缀、去空、保序去重", () => {
    expect(parseFrontMatter(wrap("tags: [#工作, 笔记, 工作, '']")).tags).toEqual(["工作", "笔记"]);
  });

  it("显式空数组区分「声明为空」", () => {
    const info = parseFrontMatter(wrap("tags: []"));
    expect(info.hasTags).toBe(true);
    expect(info.tags).toEqual([]);
  });

  it("没有 tags 键时不标记 hasTags", () => {
    expect(parseFrontMatter(wrap("title: x")).hasTags).toBe(false);
  });
});

describe("容错", () => {
  it("未知键、嵌套结构、注释全部忽略且不抛错", () => {
    const src = wrap(
      [
        "# 注释",
        "title: 标题",
        "author:",
        "  name: x",
        "tags: [a]",
        "description: |",
        "  # 不是标题",
        "  - 不是列表",
        "draft: true",
      ].join("\n"),
    );
    expect(() => parseFrontMatter(src)).not.toThrow();
    const info = parseFrontMatter(src);
    expect(info.title).toBe("标题");
    expect(info.tags).toEqual(["a"]);
  });

  it("非法 YAML / 未闭合引号只影响该键", () => {
    const info = parseFrontMatter(wrap('title: "未闭合\ntags: [a, b]'));
    expect(info.tags).toEqual(["a", "b"]);
  });
});
