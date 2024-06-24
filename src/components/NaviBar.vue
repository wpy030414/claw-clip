<script setup lang="ts">
defineProps<{
  leftFn?: {
    name: string;
    action: Function;
  };
  rightFn?: {
    name: string;
    action: Function;
  };
  title: string;
}>();
</script>

<template>
  <div>
    <el-button v-if="leftFn" class="bt left" circle @click="leftFn.action"
      ><el-icon><component :is="leftFn.name" /></el-icon
    ></el-button>
    <el-text size="large" v-text="title"></el-text>
    <el-button v-if="rightFn" class="bt right" circle @click="rightFn.action"
      ><el-icon><component :is="rightFn.name" /></el-icon
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
      left: 1.5vw;
    }

    &.right {
      right: 1.5vw;
    }
  }
}
</style>
