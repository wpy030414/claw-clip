<script setup lang="ts">
import { useAchievementStore } from "@/stores/achievement";
import { useThemeStore } from "@/stores/theme";
import {
  achievementZhCn,
  NOW,
  usedDays,
  type Achievement,
} from "@/types/Achievement";
import { hash } from "@/utils";
import { ref } from "vue";

const aStore = useAchievementStore();

const token = ref("");
hash(aStore.you, aStore.firstCome).then((s) => (token.value = s));

const a = ref({} as Achievement);
NOW().then((r) => (a.value = r));

setInterval(() => (a.value.USED_DAYS = usedDays()), 20);
</script>

<template>
  <el-card class="list-view" shadow="hover">
    <template #header>
      <p>你</p>
    </template>
    <div class="table">
      <el-text>笔名</el-text>
      <el-input v-model="aStore.you" />
      <el-text>唯一识别码</el-text>
      <el-input
        :value="token"
        type="textarea"
        disabled
        :rows="3"
        resize="none"
      />
    </div>
  </el-card>

  <el-card class="list-view" shadow="hover">
    <template #header>
      <p>生涯</p>
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
    <template #header>
      <p>设置</p>
    </template>
    <div class="option">
      <el-text size="large">夜间模式</el-text>
      <el-switch v-model="useThemeStore().isDark" />
    </div>
  </el-card>
</template>

<style scoped>
.table {
  display: grid;
  grid-template-columns: 1fr 3fr;
  grid-row-gap: 1.2rem;
}

.option {
  display: flex;

  & > *:first-child {
    flex: 999;
  }
}
</style>
