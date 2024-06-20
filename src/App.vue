<script setup lang="ts">
import { ref } from "vue";
import type { Blog } from "./types/Blog";
import { useDataStore } from "./stores/data";

function getNewBlog(): Blog {
  return {
    id: new Date().getTime(),
    text: "",
    videos: [],
    images: [],
  };
}

const current = ref(getNewBlog());

function handleSubmit() {
  useDataStore().addBlog(current.value);
  current.value = getNewBlog();
}
</script>

<template>
  <header class="shadow">
    <template v-if="$route.name == '主页'">
      <p>主页</p>
    </template>
    <template v-else>
      <p>编辑</p>
      <button class="top left" @click="$router.push('/')">🔙</button>
      <button
        class="top right"
        @click="
          handleSubmit();
          $router.push('/');
        "
      >
        💾
      </button>
    </template>
  </header>
  <div class="view">
    <RouterView v-model="current" />
  </div>
  <RouterLink to="/editor">
    <button v-if="$route.name == '主页'" class="spirit shadow">+</button>
  </RouterLink>
</template>

<style scoped>
header {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 3.8rem;
  background: var(--theme-c);
  color: white;
  font-size: 1.5rem;
  text-align: center;
}

.view {
  overflow-y: auto;
  height: calc(100vh - 3.8rem - 1rem * 2);
  padding: 1rem;
}
</style>
