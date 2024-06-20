<script setup lang="ts">
import type { Blog } from "@/types/Blog";

const data = defineModel<Blog>();

function handleChange(e: Event, from: "v" | "i", index: number) {
  const files = (e.target as HTMLInputElement).files;
  for (let i = 0; i < files!.length; i++) {
    const file = files![i];
    const blobUrl = URL.createObjectURL(file);
    switch (from) {
      case "v":
        data.value!.videos[index] = blobUrl;
        break;
      case "i":
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = function () {
          data.value!.images[index] = reader.result + "";
        };
        break;
    }
  }
}
</script>

<template>
  <div v-if="data" class="root">
    <textarea v-model="data.text"></textarea>
    <button @click="data.videos.push('')">添加视频</button>
    <div v-for="(_, i) in data.videos" :key="i">
      <button @click="data.videos.splice(i, 1)">&nbsp;x&nbsp;</button>
      <input type="file" @change="(e) => handleChange(e, 'v', i)" />
    </div>
    <button @click="data.images.push('')">添加图片</button>
    <div v-for="(_, i) in data.images" :key="i">
      <button @click="data.images.splice(i, 1)">&nbsp;x&nbsp;</button>
      <input type="file" @change="(e) => handleChange(e, 'i', i)" />
    </div>
  </div>
</template>

<style scoped>
.root > * {
  display: block;
  margin-bottom: 1rem;

  & button {
    margin-right: 1rem;
  }
}

textarea {
  width: calc(100% - 0.5rem * 2);
  height: calc(30vh - 0.5rem * 2);
  padding: 0.5rem;
  resize: none;
  font-size: 1rem;
}
</style>
