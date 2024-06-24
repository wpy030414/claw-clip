<script setup lang="ts">
import NaviBar from "@/components/NaviBar.vue";
import { useEditedStore } from "@/stores/edited";
import { ElMessageBox } from "element-plus";
import { goHome } from "@/router";

const store = useEditedStore();

function handleQuit() {
  if (!store.isCurrentBlank())
    ElMessageBox.confirm("你将会丢失正在编辑的内容", "警告", {
      confirmButtonText: "放弃",
      cancelButtonText: "手滑了",
      type: "warning",
    }).then(() => {
      store.setCurrentBlank();
      goHome();
    });
  else goHome();
}
</script>

<template>
  <el-container>
    <el-header>
      <navi-bar
        v-if="$route.name == '主页'"
        :rightFn="{
          name: 'Plus',
          action: () => $router.push('/editor'),
        }"
        title="主页"
      />
      <navi-bar
        v-if="$route.name == '编辑'"
        :leftFn="{
          name: 'Close',
          action: handleQuit,
        }"
        :rightFn="{
          name: 'Promotion',
          action: useEditedStore().handleSubmit,
        }"
        title="编辑"
      />
    </el-header>
    <el-main class="view">
      <RouterView />
    </el-main>
  </el-container>
</template>

<style scoped>
.view {
  overflow-y: auto;
  height: calc(100vh - 60px);

  &::-webkit-scrollbar {
    width: 8px;
    background-color: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: #eee;
  }
}
</style>
