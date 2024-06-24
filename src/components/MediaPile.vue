<script setup lang="ts">
defineProps<{
  videos: ArrayBuffer[];
  images: ArrayBuffer[];
}>();

function bufferReader(ab: ArrayBuffer, type: "video/mp4" | "image/jpeg") {
  return URL.createObjectURL(new Blob([ab], { type: type }));
}
</script>

<template>
  <video
    v-for="v in videos"
    :src="bufferReader(v, 'video/mp4')"
    controls
  ></video>
  <img v-for="i in images" :src="bufferReader(i, 'image/jpeg')" alt="" />
</template>

<style scoped>
video,
img {
  width: 100%;

  &:first-of-type {
    margin-top: 1rem;
  }
}
</style>
