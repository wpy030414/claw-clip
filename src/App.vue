<script setup lang="ts">
import TiTleBar from "@/components/TitleBar.vue";
import NaviBar from "@/components/NaviBar.vue";
import { useThemeStore } from "@/stores/theme";
import { useEditedStore } from "@/stores/edited";
import { useSearchedStore } from "@/stores/searched";
import { ElMessageBox } from "element-plus";
import { getName, goHome, isMainView } from "@/router";

const theme = useThemeStore();
const store = useEditedStore();

function handleQuitEditing() {
  if (!store.isCurrentBlank())
    ElMessageBox.confirm("你将会丢失正在编辑的内容", "警告", {
      confirmButtonText: "丢弃",
      cancelButtonText: "手滑了",
      type: "warning",
    }).then(() => {
      store.setCurrentBlank();
      goHome();
    });
  else goHome();
}

function handleQuitSearching() {
  useSearchedStore().clean();
  goHome();
}

theme.apply();
</script>

<template>
  <el-container>
    <el-header>
      <TiTleBar
        :title="getName()"
        :fn="
          (() => {
            switch (getName()) {
              case '主页':
                return {
                  left: {
                    name: 'Search',
                    action: () => $router.push('/search'),
                  },
                  right: {
                    name: 'Plus',
                    action: () => $router.push('/editor'),
                  },
                };
              case '搜索':
                return {
                  left: {
                    name: 'Back',
                    action: handleQuitSearching,
                  },
                };
              case '编辑':
                return {
                  left: {
                    name: 'Close',
                    action: handleQuitEditing,
                  },
                  right: {
                    name: 'Promotion',
                    action: store.handleSubmit,
                  },
                };
              case '我的':
                return {
                  left: {
                    name: theme.isDark ? 'Sunny' : 'Moon',
                    action: theme.change,
                  },
                };
            }
          })()
        "
      />
    </el-header>
    <el-main class="view" :style="`--length-cut: ${isMainView() ? '2' : '1'};`">
      <RouterView />
    </el-main>
    <el-footer v-if="isMainView()">
      <NaviBar
        :views="[
          {
            icon: 'House',
            path: '/',
          },
          {
            icon: 'Star',
            path: '/stared',
          },
          {
            icon: 'MessageBox',
            path: '/msg',
          },
          {
            icon: 'User',
            path: '/me',
          },
        ]"
        :currentView="'ss'"
      />
    </el-footer>
  </el-container>
</template>

<style scoped>
.view {
  height: calc(100vh - 60px * var(--length-cut));

  &::-webkit-scrollbar {
    width: 0px;
  }
}
</style>
