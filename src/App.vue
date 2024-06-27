<script setup lang="ts">
import TiTleBar from "@/components/TitleBar.vue";
import { useMeStore } from "@/stores/me";
import { useThemeStore } from "@/stores/theme";
import { useEditedStore } from "@/stores/edited";
import { useSearchedStore } from "@/stores/searched";
import { getName, goHome, isMainView } from "@/router";
import { onMounted } from "vue";
import { warning } from "@/utils";

useThemeStore();
const store = useEditedStore();

function handleQuitEditing() {
  if (!store.isCurrentBlank())
    warning("你将会丢失正在编辑的内容！", "丢弃", () => {
      store.setCurrentBlank();
      goHome();
    });
  else goHome();
}

function handleQuitSearching() {
  useSearchedStore().keyword = "";
  goHome();
}

onMounted(() => {
  useMeStore();
  goHome();
});
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
            }
          })()
        "
      />
    </el-header>
    <el-main class="view" :style="`--length-cut: ${isMainView() ? '2' : '1'};`">
      <RouterView />
    </el-main>
    <el-footer v-if="isMainView()">
      <el-menu
        default-active="/"
        :index="$route.path"
        mode="horizontal"
        :ellipsis="false"
        :router="true"
      >
        <el-menu-item
          class="view-tag"
          v-for="v of [
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
          :index="v.path"
        >
          <el-icon><component :is="v.icon" /></el-icon>
          {{ getName(v.path) }}
        </el-menu-item>
      </el-menu>
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

.view-tag {
  width: 25%;
}
</style>
