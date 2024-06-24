<script setup lang="ts">
import MediaPile from "@/components/MediaPile.vue";
import { ref, watch } from "vue";
import type { Blog } from "@/types/Blog";
import { deleteSingle, download } from "@/apis/datasource";

const total = ref(0);
const blogs = ref<Blog[]>([]);

const isLoading = ref(true);

const pageSize = ref(10);
const page = ref(1);

function sync() {
  download(pageSize.value, page.value - 1).then((data) => {
    total.value = data.total;
    blogs.value = data.blogs;
    isLoading.value = false;
  });
}

watch(page, sync, { immediate: true });
</script>

<template>
  <el-skeleton v-if="isLoading" :rows="5" animated />
  <el-empty v-if="!isLoading && !total" description="空空如也" />

  <el-card class="blog" v-for="b in blogs" shadow="hover">
    <p>{{ b.text }}</p>
    <MediaPile :videos="b.videos" :images="b.images" />
    <p class="date">
      {{
        new Date(b.date.getTime() + 8 * 60 * 60 * 1000)
          .toISOString()
          .replace("T", " ")
          .substring(0, 16)
      }}
      <el-button
        class="delete"
        type="danger"
        text
        size="small"
        @click="
          deleteSingle(b.id!);
          sync();
        "
      >
        <el-icon><Delete /></el-icon>
      </el-button>
    </p>
  </el-card>

  <el-pagination
    v-if="total"
    class="pager"
    layout="prev, pager, next"
    :total="total"
    v-model:pageSize="pageSize"
    v-model:currentPage="page"
  />
</template>

<style scoped>
.blog {
  border-radius: 0.6rem;
  margin-bottom: 1.8rem;

  & video,
  & img {
    margin: 1rem 0;
    width: 100%;
  }

  & .date {
    margin-top: 1rem;
    color: lightgrey;
  }

  & .delete {
    position: relative;
    bottom: 0.2rem;
    float: right;
  }
}

.pager {
  justify-content: center;
}
</style>
