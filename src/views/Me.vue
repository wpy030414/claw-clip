<script setup lang="ts">
import { useThemeStore } from "@/stores/theme";
import {
  achievementZhCn,
  NOW,
  usedDays,
  type Achievement,
} from "@/types/Achievement";
import { ref } from "vue";

const a = ref({} as Achievement);
NOW().then((r) => (a.value = r));

setInterval(() => (a.value.USED_DAYS = usedDays()), 20);
</script>

<template>
  <el-card class="list-view" shadow="hover">
    <template #header>
      <p>统计数据</p>
    </template>
    <el-row class="list-view" v-for="(s, n, i) in a">
      <el-statistic
        :title="achievementZhCn[i]"
        :value="s"
        :precision="n.includes('DAYS') ? 12 : 0"
      />
    </el-row>
  </el-card>
  <el-card class="list-view" shadow="hover">
    <div class="option">
      <el-text size="large">夜间模式</el-text>
      <el-switch v-model="useThemeStore().isDark" />
    </div>
  </el-card>
</template>

<style scoped>
.option {
  display: flex;

  & > *:first-child {
    flex: 999;
  }
}
</style>
