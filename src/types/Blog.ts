export interface Blog {
  id: number;

  /**
   * 作者
   */
  author: string;

  /**
   * 博客正文
   */
  text: string;

  /**
   * 视频集合
   */
  videos: ArrayBuffer[];

  /**
   * 图片集合
   */
  images: ArrayBuffer[];

  /**
   * 对象创建时的时间
   */
  date: Date;
}

export const EMPTY_BLOG = (): Blog => {
  const d = new Date();
  return {
    id: d.getTime(),
    author: "",
    text: "",
    videos: [],
    images: [],
    date: d,
  };
};
