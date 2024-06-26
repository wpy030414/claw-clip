<script setup lang="ts">
import Home from "@/views/Home.vue";
import { query } from "@/apis/datasource";
import { useSearchedStore } from "@/stores/searched";
</script>

<template>
  <Home :sourceGetter="query" :attached="useSearchedStore().keyword" />
</template>

<style scoped></style>
