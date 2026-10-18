/**
 * Markdown 格式化单测：语义安全的强制校准规则 + 幂等性。
 */
import { describe, expect, it } from "vite-plus/test";
import { formatMarkdown } from "@/utils/markdownFormat";

describe("formatMarkdown 基础语法校准", () => {
  it("标题：补齐/压缩标记后的空格", () => {
    expect(formatMarkdown("#标题\n")).toBe("# 标题\n");
    expect(formatMarkdown("###    小节\n")).toBe("### 小节\n");
    expect(formatMarkdown("####### 不是标题\n")).toBe("####### 不是标题\n");
  });

  it("无序列表：* / + 统一为 -，标记后只留一个空格", () => {
    expect(formatMarkdown("*   甲\n+ 乙\n-    丙\n")).toBe("- 甲\n- 乙\n- 丙\n");
  });

  it("任务列表：[X] 统一小写，复选框后只留一个空格", () => {
    expect(formatMarkdown("- [X]   已完成\n* [ ]待办\n")).toBe("- [x] 已完成\n- [ ] 待办\n");
  });

  it("有序列表：统一标记后的空格，保留编号与分隔符", () => {
    expect(formatMarkdown("1.   甲\n2)    乙\n")).toBe("1. 甲\n2) 乙\n");
    // 不是合法列表（缺空格）时保持原样，避免改变语义
    expect(formatMarkdown("1.文本\n")).toBe("1.文本\n");
  });

  it("引用：> 后补空格，嵌套逐级展开", () => {
    expect(formatMarkdown(">引用\n>>   嵌套\n")).toBe("> 引用\n> > 嵌套\n");
  });

  it("水平分割线保持原样（不被误判为列表）", () => {
    expect(formatMarkdown("* * *\n- - -\n")).toBe("* * *\n- - -\n");
  });
});

describe("formatMarkdown 空白与换行", () => {
  it("连续空行压缩为一行，去掉文档首尾空行，结尾恰好一个换行", () => {
    expect(formatMarkdown("\n\n# 标题\n\n\n\n正文\n\n\n")).toBe("# 标题\n\n正文\n");
  });

  it("普通行尾空白去掉；两个及以上空格作为硬换行保留为两个", () => {
    expect(formatMarkdown("甲   \n乙\t \n丙    \n")).toBe("甲  \n乙\n丙  \n");
  });

  it("统一 CRLF / 去 BOM", () => {
    expect(formatMarkdown("﻿# 标题\r\n\r\n正文\r\n")).toBe("# 标题\n\n正文\n");
  });

  it("纯空白文档返回空串", () => {
    expect(formatMarkdown(" \n\t\n")).toBe("");
  });
});

describe("formatMarkdown 代码块", () => {
  it("围栏代码块内部原样保留（含列表/空行/行尾空白）", () => {
    const md = ["```md", "*   不规范的列表", "", "", ">引用", "```", ""].join("\n");
    expect(formatMarkdown(md)).toBe(md);
  });

  it("围栏行本身的尾部空白被清理，内部内容不动", () => {
    expect(formatMarkdown("```js   \nconst a = 1;   \n```\n")).toBe(
      "```js\nconst a = 1;   \n```\n",
    );
  });
});

describe("formatMarkdown 幂等", () => {
  it("二次格式化结果不变", () => {
    const source = [
      "﻿#标题",
      "",
      "",
      "*   列表",
      "- [X]   任务",
      ">>引用",
      "",
      "```",
      "  原样   ",
      "```",
      "",
      "",
    ].join("\r\n");
    const once = formatMarkdown(source);
    expect(formatMarkdown(once)).toBe(once);
  });
});
