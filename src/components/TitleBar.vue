<script setup lang="ts">
import { useSearchedStore } from "@/stores/searched";

defineProps<{
  title: string;
  fn?: {
    left?: {
      name: string;
      action: Function;
    };
    right?: {
      name: string;
      action: Function;
    };
  };
}>();
</script>

<template>
  <div>
    <el-button v-if="fn?.left" class="bt left" circle @click="fn.left.action"
      ><el-icon><component :is="fn.left.name" /></el-icon
    ></el-button>
    <el-text v-if="title != '搜索'" size="large">{{ title }}</el-text>
    <template v-else>
      <span class="input">
        <el-input
          v-model="useSearchedStore().keyword"
          placeholder="搜索博客的关键字..."
          clearable
        />
      </span>
    </template>
    <el-button v-if="fn?.right" class="bt right" circle @click="fn.right.action"
      ><el-icon><component :is="fn.right.name" /></el-icon
    ></el-button>
  </div>
</template>

<style scoped>
div {
  position: relative;
  display: flex;
  justify-content: center;
  height: 100%;

  & > .bt {
    position: absolute;
    top: calc(50% - 1rem);

    &.left {
      left: 0;
    }

    &.right {
      right: 0;
    }
  }

  & .input {
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: calc(100% - 2rem * 2 * 1.5);

    & > * {
      height: 2rem;
    }
  }
}
</style>
