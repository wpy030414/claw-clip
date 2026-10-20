/**
 * useImportDocument：导入 MD / HTML / DOCX / PDF → 新建笔记 → 跳转编辑器。
 * 解析在 exchange.ts（重型依赖动态加载），本 hook 负责编排、图片落盘与提示。
 *
 * 导入文档里的图片按当前图床设置处理：
 * - DOCX 内嵌图片在解析阶段先用临时 token 占位，笔记创建后统一存 IDB 或上传图床；
 * - MD 内联 base64 一定处理，本地图片尝试读取，其它图床外链原样保留；
 * - 上传图床的图片失败时回退本地，正文写持久的 `clawclip://blob/<id>` 引用。
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toastError, toastSuccess, toastWarning } from "@/components/common/Snackbar";
import { datasource } from "@/data/datasource";
import { importDocument } from "@/data/exchange";
import {
  countImportImageCandidates,
  persistImportedImages,
  resolveImportedImage,
} from "@/data/importImages";
import { useIntegrationStore } from "@/stores/integrationStore";
import { useNotesStore } from "@/stores/notesStore";
import { useTaskProgressStore } from "@/stores/taskProgressStore";
import { useUiStore } from "@/stores/uiStore";
import { SpeedMeter } from "@/utils/speed";

interface PendingImage {
  token: string;
  blob: Blob;
}

export function useImportDocument(): (file: File) => Promise<void> {
  const navigate = useNavigate();
  const createNote = useNotesStore((s) => s.createNote);
  const openNote = useNotesStore((s) => s.openNote);
  const saveNote = useNotesStore((s) => s.saveNote);
  const remove = useNotesStore((s) => s.remove);
  const currentFolderId = useUiStore((s) => s.currentFolderId);
  const imageHost = useIntegrationStore((s) => s.imageHost);
  const recordImageUpload = useIntegrationStore((s) => s.recordImageUpload);

  return useCallback(
    async (file: File) => {
      let taskId: number | null = null;
      let noteId: string | null = null;
      try {
        toastSuccess(`正在导入 ${file.name}…`, 2000);
        const pending: PendingImage[] = [];
        const doc = await importDocument(file, {
          onImage: async (blob) => {
            const token = `clawclip-import://image/${pending.length}`;
            pending.push({ token, blob });
            return token;
          },
        });

        const candidates = pending.length + countImportImageCandidates(doc.content);
        if (imageHost === "scdn" && candidates > 0) {
          taskId = useTaskProgressStore.getState().begin("正在上传导入的图片", candidates);
          if (taskId === null) {
            toastWarning("已有图片任务正在进行，请稍后再试");
            return;
          }
        }

        const id = await createNote(currentFolderId);
        noteId = id;

        // 先处理正文里的内联/本地图片，再替换 DOCX 的临时 token：
        // 避免本地回退后的新 clawclip 引用被二次扫描、重复上传。
        const processed = await persistImportedImages(doc.content, {
          noteId: id,
          host: imageHost,
          onProgress: (progress) => {
            if (taskId !== null) {
              useTaskProgressStore.getState().update(taskId, {
                done: progress.done,
                total: candidates,
                detail: progress.detail,
              });
            }
          },
          onSpeed: (speed) => {
            if (taskId !== null) useTaskProgressStore.getState().update(taskId, { speed });
          },
          onRemoteUpload: recordImageUpload,
        });

        let content = processed.content;
        let pendingFallbacks = 0;
        const meter = new SpeedMeter();
        let done = processed.stats.total;

        for (const { token, blob } of pending) {
          if (taskId !== null) {
            useTaskProgressStore
              .getState()
              .update(taskId, { done, total: candidates, detail: "内嵌图片" });
          }
          let loaded = 0;
          const result = await resolveImportedImage(blob, id, imageHost, (nextLoaded) => {
            if (taskId !== null) {
              useTaskProgressStore
                .getState()
                .update(taskId, { speed: meter.add(Math.max(0, nextLoaded - loaded)) });
            }
            loaded = nextLoaded;
          });
          if (result.kind === "remote") {
            recordImageUpload(blob.size);
          } else if (result.error) {
            pendingFallbacks += 1;
          }
          content = content.split(token).join(result.target);
          done += 1;
          if (taskId !== null) useTaskProgressStore.getState().update(taskId, { done });
        }

        await openNote(id);
        await saveNote(id, { content, title: doc.title });

        navigate(`/n/${id}`);
        toastSuccess(`已导入「${doc.title}」`);

        const fallbacks = processed.stats.fallbacks + pendingFallbacks;
        const failed = processed.stats.failed;
        const warnings: string[] = [];
        if (fallbacks > 0) warnings.push(`${fallbacks} 张图片上传失败，已保存到本地`);
        if (failed > 0) warnings.push(`${failed} 张图片无法读取，已保留原引用`);
        if (warnings.length > 0) toastWarning(`导入完成，${warnings.join("；")}`, 6000);
      } catch (e) {
        if (noteId) {
          try {
            await remove(noteId);
            // 正文尚未落库，刚存入的图片没有引用计数；立即校准回收，避免留下孤儿
            await datasource.reconcileAttachmentRefs();
          } catch {
            /* 清理失败不覆盖原始导入错误 */
          }
        }
        toastError(`导入失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (taskId !== null) useTaskProgressStore.getState().end(taskId);
      }
    },
    [
      navigate,
      createNote,
      openNote,
      saveNote,
      remove,
      currentFolderId,
      imageHost,
      recordImageUpload,
    ],
  );
}
