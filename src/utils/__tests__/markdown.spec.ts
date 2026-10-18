import { describe, expect, it } from "vite-plus/test";
import { countWords, deriveTitle, makeExcerpt } from "@/utils/markdown";

describe("deriveTitle", () => {
  it("取首个 Markdown 标题", () => {
    expect(deriveTitle("# 我的笔记\n\n正文")).toBe("我的笔记");
  });

  it("取任意级别标题（## 等）", () => {
    expect(deriveTitle("## 二级标题\n内容")).toBe("二级标题");
  });

  it("标题不在首行也能取到", () => {
    expect(deriveTitle("一些引言\n\n# 真正的标题\n")).toBe("真正的标题");
  });

  it("无标题时取首个非空行前 30 字", () => {
    expect(deriveTitle("这是没有标题的正文")).toBe("这是没有标题的正文");
  });

  it("首个非空行超长则截断到 30 字", () => {
    const long = "一".repeat(50);
    expect(deriveTitle(long)).toHaveLength(30);
  });

  it("去掉标题里的 Markdown 标记", () => {
    expect(deriveTitle("# 带 **加粗** 的标题")).toBe("带 加粗 的标题");
  });

  it("空内容返回无标题", () => {
    expect(deriveTitle("")).toBe("无标题");
    expect(deriveTitle("   \n  ")).toBe("无标题");
  });
});

describe("countWords", () => {
  it("中文按字计", () => {
    expect(countWords("你好世界")).toBe(4);
  });

  it("英文按词计", () => {
    expect(countWords("hello world foo")).toBe(3);
  });

  it("中英混合", () => {
    // "你好" 2 字 + "world" 1 词 = 3
    expect(countWords("你好 world")).toBe(3);
  });

  it("不计 Markdown 标记", () => {
    // 加粗标记不算字，只有「重要」2 字
    expect(countWords("**重要**")).toBe(2);
  });

  it("代码块内容不计入", () => {
    expect(countWords("正文\n\n```\ncode here\n```")).toBe(2);
  });

  it("clawclip:// 附件引用不计入", () => {
    // 「看图」2 字 + 「完毕」2 字 = 4，附件协议引用被剔除不计
    expect(countWords("看图 clawclip://blob/abc-123 完毕")).toBe(4);
  });

  it("空内容 0 字", () => {
    expect(countWords("")).toBe(0);
  });
});

describe("makeExcerpt", () => {
  it("去掉 Markdown 标记取纯文本", () => {
    expect(makeExcerpt("# 标题\n\n**正文**内容")).toBe("标题 正文内容");
  });

  it("超长截断到默认 80 字", () => {
    expect(makeExcerpt("字".repeat(100))).toHaveLength(80);
  });

  it("可自定义长度", () => {
    expect(makeExcerpt("字".repeat(50), 20)).toHaveLength(20);
  });

  it("压平多余空白", () => {
    expect(makeExcerpt("多个   空白\n\n换行")).toBe("多个 空白 换行");
  });
});
