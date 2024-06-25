<script setup lang="ts">
import { useEditedStore } from "@/stores/edited";
import { ref } from "vue";

const store = useEditedStore();
const b = ref(store.current);

function handleChange(e: Event, from: "v" | "i", index: number) {
  const file = (e.target as HTMLInputElement).files![0];

  const reader = new FileReader();
  reader.onload = () => {
    switch (from) {
      case "v":
        b.value.videos[index] = reader.result as ArrayBuffer;
        break;
      case "i":
        b.value.images[index] = reader.result as ArrayBuffer;
        break;
    }
  };
  reader.readAsArrayBuffer(file);
}
</script>

<template>
  <el-text size="small">已写 {{ store.current.text.length }} 字</el-text>
  <el-input
    v-model="b.text"
    :rows="12"
    resize="none"
    type="textarea"
    placeholder="记录新鲜事..."
  />
  <el-divider />
  <el-button @click="b.videos.push({} as ArrayBuffer)">添加视频</el-button>
  <div class="file" v-for="(_, i) of b.videos" :key="i">
    <el-button @click="b.videos.splice(i, 1)" type="danger" text size="small">
      <el-icon><Delete /></el-icon>
    </el-button>
    <input type="file" @change="(e) => handleChange(e, 'v', i)" />
  </div>
  <el-divider />
  <el-button @click="b.images.push({} as ArrayBuffer)">添加图片</el-button>
  <div class="file" v-for="(_, i) of b.images" :key="i">
    <el-button @click="b.images.splice(i, 1)" type="danger" text size="small"
      ><el-icon><Delete /></el-icon
    ></el-button>
    <input type="file" @change="(e) => handleChange(e, 'i', i)" />
  </div>
</template>

<style scoped>
.file {
  margin-top: 1rem;
}

input {
  margin-left: 0.5rem;
}
</style>
