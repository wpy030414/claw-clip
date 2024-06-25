<script setup lang="ts">
import Home from "@/views/Home.vue";
import { downloadStared } from "@/apis/datasource";
</script>

<template>
  <Home :sourceGetter="downloadStared" />
</template>

<style scoped></style>
