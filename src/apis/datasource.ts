import { globalConfig } from "@/config";
import type { Blog } from "@/types/Blog";
import { LocalDataSource } from "./local";
import { RemoteDataSource } from "./remote";

const l = globalConfig.enableStoringLocally;

/**
 * 上传指定博客。
 */
export async function uploadSingle(data: Blog) {
  const fn = l ? LocalDataSource.uploadSingle : RemoteDataSource.uploadSingle;
  return fn(data);
}

/**
 * 批量下载博客。需要指定页容量和页偏移量。
 */
export async function download(pageSize: number, pageOffset: number) {
  const fn = l ? LocalDataSource.download : RemoteDataSource.download;
  return fn(pageSize, pageOffset);
}

/**
 * 删除指定博客。
 */
export async function deleteSingle(id: number) {
  const fn = l ? LocalDataSource.deleteSingle : RemoteDataSource.deleteSingle;
  return fn(id);
}
