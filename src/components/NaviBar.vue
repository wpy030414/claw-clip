<script setup lang="ts">
import { getName } from "@/router";

defineProps<{
  views: {
    icon: string;
    path: string;
  }[];
  currentView: string;
}>();
</script>

<template>
  <el-menu
    :default-active="views[0]?.path"
    mode="horizontal"
    :ellipsis="false"
    :router="true"
  >
    <el-menu-item
      v-for="v of views"
      :index="v.path"
      :style="`width: ${100 / views.length}%;`"
    >
      <el-icon><component :is="v.icon" /></el-icon>
      {{ getName(v.path) }}
    </el-menu-item>
  </el-menu>
</template>

<style scoped></style>
