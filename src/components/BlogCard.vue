<script setup lang="ts">
import MediaPile from "@/components/MediaPile.vue";
import { ref, toRaw } from "vue";
import { deleteSingle, isStared, star } from "@/apis/datasource";
import type { Blog } from "@/types/Blog";
import { ElMessage } from "element-plus";

const props = defineProps<{
  blog: Blog;
  afterFn: {
    star: Function;
    del: Function;
  };
}>();

const stared = ref(false);
isStared(toRaw(props.blog.id)).then((r) => (stared.value = r));

function handleStar(id: number) {
  stared.value = !stared.value;
  star(id, stared.value);
  ElMessage({
    message: `已${stared.value ? "" : "取消"}收藏`,
    type: "success",
  });
  props.afterFn.star();
}

function handleDelete(id: number) {
  deleteSingle(id);
  ElMessage({
    message: "已删除",
    type: "success",
  });
  props.afterFn.del();
}
</script>

<template>
  <el-card class="list-view" shadow="hover">
    <p>{{ blog.text }}</p>
    <MediaPile :videos="blog.videos" :images="blog.images" />
    <p class="date">
      {{
        new Date(blog.date.getTime() + 8 * 60 * 60 * 1000)
          .toISOString()
          .replace("T", " ")
          .substring(0, 19)
      }}
      <el-button
        class="op"
        type="danger"
        text
        size="small"
        @click="handleDelete(blog.id)"
      >
        <el-icon><Delete /></el-icon>
      </el-button>
      <el-button
        class="op"
        type="warning"
        text
        size="small"
        @click="handleStar(blog.id)"
      >
        <el-icon><component :is="stared ? 'StarFilled' : 'Star'" /></el-icon>
      </el-button>
    </p>
  </el-card>
</template>

<style scoped>
video,
img {
  margin: 1rem 0;
  width: 100%;
}

.date {
  margin-top: 1rem;
  color: lightgrey;
}

.op {
  position: relative;
  bottom: 0.2rem;
  float: right;
}
</style>
