<script setup lang="ts">
import { ref, toRaw } from "vue";
import { deleteSingle, isStared, star } from "@/apis/datasource";
import type { Blog } from "@/types/Blog";
import { ElMessage } from "element-plus";
import { useEditedStore } from "@/stores/edited";
import router from "@/router";
import { warning } from "@/utils";

const props = defineProps<{
  blog: Blog;
  afterFn: {
    star: Function;
    del: Function;
  };
}>();

function bufferReader(ab: ArrayBuffer, type: "video/mp4" | "image/jpeg") {
  return URL.createObjectURL(new Blob([ab], { type: type }));
}

function handleAlter() {
  router.push("/editor");
  useEditedStore().current = props.blog;
}

function handleDelete() {
  warning("你确定要删除这条博客吗？", "删除", () => {
    deleteSingle(props.blog.id);
    ElMessage({
      message: "已删除",
      type: "success",
    });
    props.afterFn.del();
  });
}

const stared = ref(false);
isStared(toRaw(props.blog.id)).then((r) => (stared.value = r));

function handleStar() {
  stared.value = !stared.value;
  star(props.blog.id, stared.value);
  ElMessage({
    message: `已${stared.value ? "" : "取消"}收藏`,
    type: "success",
  });
  props.afterFn.star();
}
</script>

<template>
  <el-card class="list-view-e" shadow="hover">
    <template #header>
      <el-text>@{{ blog.author }}</el-text>
      <el-button class="op" text size="small" @click="handleDelete">
        <el-icon><Delete /></el-icon>
      </el-button>
      <el-button class="op" text size="small" @click="handleAlter">
        <el-icon><EditPen /></el-icon>
      </el-button>
    </template>

    <p v-for="p in blog.text.split('\n')">{{ p }}</p>
    <video
      v-for="v of blog.videos"
      :src="bufferReader(v, 'video/mp4')"
      controls
    ></video>
    <img v-for="i of blog.images" :src="bufferReader(i, 'image/jpeg')" alt="" />

    <template #footer>
      <el-text type="info">
        最后编辑于
        {{
          new Date(blog.date.getTime() + 8 * 60 * 60 * 1000)
            .toISOString()
            .replace("T", " ")
            .substring(0, 19)
        }}
      </el-text>

      <el-button
        class="op"
        type="warning"
        text
        size="small"
        @click="handleStar"
      >
        <el-icon><component :is="stared ? 'StarFilled' : 'Star'" /></el-icon>
      </el-button>
    </template>
  </el-card>
</template>

<style scoped>
video,
img {
  width: 100%;

  &:first-of-type {
    margin-top: 1rem;
  }
}

.op {
  position: relative;
  bottom: 0.2rem;
  float: right;
}
</style>
