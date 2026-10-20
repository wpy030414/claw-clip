/**
 * 图片 → 图床的统一上传入口：复用 BlobRecord.remoteUrl 缓存，
 * 成功后将外链写回记录，供导出/快照/迁移后续复用。
 */
import type { BlobRecord } from "@/types/blob";
import { setBlobRemoteUrl } from "./blobStore";
import { dataUrlToBlob, extensionForMime } from "./imageAssets";
import { uploadToScdn, type UploadOptions } from "./imageHost";

/** 上传本地附件记录；已有 remoteUrl 时直接返回缓存。 */
export async function uploadBlobRecord(
  record: BlobRecord,
  options: UploadOptions = {},
): Promise<string> {
  if (record.remoteUrl) return record.remoteUrl;
  const file = new File([record.data], `image-${record.id}.${extensionForMime(record.mime)}`, {
    type: record.mime,
  });
  const url = await uploadToScdn(file, options);
  await setBlobRemoteUrl(record.id, url);
  return url;
}

/** 上传内联 data URL 图片。 */
export async function uploadDataImage(
  dataUrl: string,
  options: UploadOptions = {},
): Promise<string> {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) throw new Error("无法解析内联图片");
  const file = new File([blob], `inline-image.${extensionForMime(blob.type)}`, {
    type: blob.type,
  });
  return uploadToScdn(file, options);
}
