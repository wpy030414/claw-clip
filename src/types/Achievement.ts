import { download } from "@/apis/datasource";
import { useMeStore } from "@/stores/me";

export interface Achievement {
  /**
   * 已使用天数
   */
  USED_DAYS: number;

  /**
   * 已发布的博客篇数
   */
  PUBLICATIONS: number;

  /**
   * 已写下的字数
   */
  PUBLISHED_LETTERS: number;
}

export const achievementZhCn = [
  "已使用天数",
  "已发布的博客篇数",
  "已写下的字数",
];

export function usedDays() {
  const firstComeDate = new Date(useMeStore().firstCome);
  const delta = new Date().getTime() - firstComeDate.getTime();
  return delta / (1000.0 * 60 * 60 * 24);
}

export const NOW = async (): Promise<Achievement> => {
  const USED_DAYS = usedDays();

  const PUBLICATIONS = (await download(0, 0)).total;

  const PUBLISHED_LETTERS = await (async () => {
    let sum = 0;
    for (let p = 1, currentSize = 10; currentSize == 10; p++) {
      const { blogs } = await download(10, p - 1);
      currentSize = blogs.length;
      for (const b of blogs) sum += b.text.length;
    }
    return sum;
  })();

  return {
    USED_DAYS: USED_DAYS,
    PUBLICATIONS: PUBLICATIONS,
    PUBLISHED_LETTERS: PUBLISHED_LETTERS,
  };
};
