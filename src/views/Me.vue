<script setup lang="ts">
import { clear, download } from "@/apis/datasource";
import router, { refresh } from "@/router";
import { useAchievementStore } from "@/stores/achievement";
import { useEditedStore } from "@/stores/edited";
import { useThemeStore } from "@/stores/theme";
import {
  achievementZhCn,
  NOW,
  usedDays,
  type Achievement,
} from "@/types/Achievement";
import { hash, warning } from "@/utils";
import { ElMessage } from "element-plus";
import { ref } from "vue";

const aStore = useAchievementStore();

const token = ref("");
hash(aStore.you, aStore.firstCome).then((s) => (token.value = s));

const a = ref({} as Achievement);
NOW().then((r) => (a.value = r));

setInterval(() => (a.value.USED_DAYS = usedDays()), 20);

async function handleOutput() {
  function arrayBufferToBase64(buffer: ArrayBuffer) {
    const binary = new Uint8Array(buffer);
    let result = "";
    const length = binary.byteLength;
    for (let i = 0; i < length; i++) result += String.fromCharCode(binary[i]);
    return btoa(result);
  }

  try {
    const data = (await download(Infinity, 0)).blogs;

    if (!data || !Array.isArray(data)) throw new Error();

    const blogsWithBase64 = data.map((blog) => ({
      ...blog,
      videos: blog.videos.map(arrayBufferToBase64),
      images: blog.images.map(arrayBufferToBase64),
    }));

    const jsonContent = JSON.stringify(blogsWithBase64);
    const blob = new Blob([jsonContent], { type: "application/json" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${aStore.you}_data.json`;
    a.click();

    URL.revokeObjectURL(url);
  } catch (_) {}
}

function handleInput() {
  function base64ToBuffer(base64: string) {
    const binaryString = atob(base64);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);

    for (let i = 0; i < length; i++) bytes[i] = binaryString.charCodeAt(i);

    return bytes.buffer;
  }

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const jsonContent = e.target?.result;
        const parsedObject = JSON.parse(jsonContent as string);

        const processedObject = parsedObject.map((item: any) => ({
          ...item,
          videos: item.videos.map(base64ToBuffer),
          images: item.images.map(base64ToBuffer),
          date: new Date(item.date),
        }));

        const store = useEditedStore();
        for (const b of processedObject) {
          store.current = b;
          await store.handleSubmit({
            usingOldDate: true,
            beSilent: true,
            noGoingHome: true,
          });
        }
        ElMessage({
          message: "导入成功",
          type: "success",
        });
      } catch (_) {
        ElMessage({
          message: "导入失败",
          type: "error",
        });
      }
    };

    if (file) reader.readAsText(file);
  };

  input.click();
}

function handleReset() {
  warning(
    "该操作会清除本应用程序的全部数据，且之后永远无法恢复！你确定要这样做吗？",
    "重置",
    async () => {
      if (prompt("请输入您的笔名进行二次确认：") == aStore.you) {
        localStorage.clear();
        await clear();
        history.go(0);
      } else
        ElMessage({
          message: "输入错误，操作被取消",
          type: "error",
        });
    },
  );
}
</script>

<template>
  <el-card class="list-view-e" shadow="hover">
    <template #header>
      <p>你</p>
    </template>
    <div class="table">
      <el-text>笔名</el-text>
      <el-input v-model="aStore.you" />
      <el-text>唯一识别码</el-text>
      <el-input
        :value="token"
        type="textarea"
        disabled
        :rows="3"
        resize="none"
      />
    </div>
  </el-card>

  <el-card class="list-view-e" shadow="hover">
    <template #header>
      <p>生涯</p>
    </template>
    <el-row class="list-view-e" v-for="(s, n, i) in a">
      <el-statistic
        :title="achievementZhCn[i]"
        :value="s"
        :precision="n.includes('DAYS') ? 12 : 0"
      />
    </el-row>
  </el-card>

  <el-card shadow="hover">
    <template #header>
      <p>设置</p>
    </template>
    <div class="option">
      <el-text size="large">夜间模式</el-text>
      <el-switch v-model="useThemeStore().isDark" />
    </div>
    <el-divider />
    <div>
      <el-button @click="handleOutput">导出数据</el-button>
      <el-button
        @click="
          () => {
            warning(
              '该操作可能会覆盖你本有的数据！且非法外来文件可能会永久影响系统的稳定性！',
              '执行',
              handleInput,
            );
          }
        "
        type="danger"
        >导入数据</el-button
      >
      <el-button @click="handleReset" type="danger">重置</el-button>
    </div>
  </el-card>
</template>

<style scoped>
.table {
  display: grid;
  grid-template-columns: 1fr 3fr;
  grid-row-gap: 1.2rem;
}

.option {
  display: flex;

  & > *:first-child {
    flex: 999;
  }
}
</style>
