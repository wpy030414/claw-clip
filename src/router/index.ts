import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "主页",
      component: () => import("@/views/Home.vue"),
    },
    {
      path: "/editor",
      name: "编辑",
      component: () => import("@/views/Editor.vue"),
    },
  ],
});

router.afterEach((to) => {
  document.title = `${to.name?.toString()} | 本地空间`;
});

export default router;
