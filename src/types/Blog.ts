export interface Blog {
  /**
   * 唯一识别码。同时也是对象创建时的时间戳，不由数据库接管。一般情况下认为具有唯一性。
   */
  id: number;

  /**
   * 博客正文。明文存储。
   */
  text: string;

  /**
   * 视频集合。元素以流形式存储。
   */
  videos: (ArrayBuffer | string)[];

  /**
   * 图片集合。元素以流形式存储。
   */
  images: (ArrayBuffer | string)[];
}
