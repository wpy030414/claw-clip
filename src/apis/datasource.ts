import { globalConfig } from "@/config";
import type { Blog } from "@/types/Blog";
import { LocalDataSource } from "@/apis/local";
import { RemoteDataSource } from "@/apis/remote";

const l = globalConfig.enableStoringLocally;

/**
 * 上传指定博客。
 */
export async function uploadSingle(data: Blog): Promise<boolean> {
  const fn = l ? LocalDataSource.uploadSingle : RemoteDataSource.uploadSingle;
  return fn(data);
}

/**
 * 批量下载博客。需要指定页容量和页偏移量。
 */
export async function download(
  pageSize: number,
  pageOffset: number,
  filter: (b: Blog, attached?: any) => Promise<boolean> = async () => true,
): Promise<{ total: number; blogs: Blog[] }> {
  const fn = l ? LocalDataSource.download : RemoteDataSource.download;
  return fn(pageSize, pageOffset, filter);
}

/**
 * 批量下载已收藏的博客。需要指定页容量和页偏移量。
 */
export async function downloadStared(
  pageSize: number,
  pageOffset: number,
): Promise<{ total: number; blogs: Blog[] }> {
  return download(pageSize, pageOffset, (b, u) => isStared(b.id, u));
}

/**
 * 根据关键词查询博客。
 */
export async function query(
  pageSize: number,
  pageOffset: number,
  keyword: string,
): Promise<{ total: number; blogs: Blog[] }> {
  if (!keyword) return { total: 0, blogs: [] };
  return download(pageSize, pageOffset, async (b) => b.text.includes(keyword));
}

/**
 * 删除指定博客。
 */
export async function deleteSingle(id: number): Promise<boolean> {
  const fn = l ? LocalDataSource.deleteSingle : RemoteDataSource.deleteSingle;
  if (await fn(id))
    if (await isStared(id)) return star(id, false);
    else return true;
  return false;
}

/**
 * 检查指定博客是否已被收藏。
 */
export async function isStared(
  id: number,
  u?: IDBTransaction,
): Promise<boolean> {
  const fn = l ? LocalDataSource.isStared : RemoteDataSource.isStared;
  return fn(id, u);
}

/**
 * 收藏博客。
 */
export async function star(id: number, enable: boolean): Promise<boolean> {
  const fn = l ? LocalDataSource.star : RemoteDataSource.star;
  return fn(id, enable);
}
