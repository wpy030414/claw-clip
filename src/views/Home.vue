<script setup lang="ts">
import { useDataStore } from "@/stores/data";
import type { Blog } from "@/types/Blog";
import { ref } from "vue";

const blogs = ref<Blog[]>();

function sync() {
  useDataStore()
    .load()
    .then((bs) => (blogs.value = bs));
}

sync();
</script>

<template>
  <div class="notice" v-if="blogs?.length == 0">空空如也</div>
  <div class="shadow" v-for="b in blogs">
    <p>{{ b.text }}</p>
    <video v-for="v in b.videos" :src="v" controls></video>
    <img v-for="i in b.images" :src="i" alt="" />
    <p class="date">
      {{
        new Date(b.id + 8 * 60 * 60 * 1000)
          .toISOString()
          .replace("T", " ")
          .substring(0, 16)
      }}
      <button
        @click="
          useDataStore().removeBlog(b);
          sync();
        "
      >
        &nbsp;x&nbsp;
      </button>
    </p>
  </div>
</template>

<style scoped>
.notice {
  color: lightgray;
  text-align: center;
}

div {
  padding: 1rem;
  border-radius: 0.35rem;
  margin-bottom: 1rem;

  & video,
  & img {
    margin: 1rem 0;
    width: 100%;
  }

  & .date {
    margin-top: 1rem;
    color: lightgrey;
  }
}
</style>
