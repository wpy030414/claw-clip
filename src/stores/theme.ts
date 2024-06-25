import { defineStore } from "pinia";
import { ref, watch } from "vue";

export const useThemeStore = defineStore("theme", () => {
  const isDark = ref(JSON.parse(localStorage.getItem("isDark") || "false"));

  watch(isDark, apply, { immediate: true });

  function apply() {
    document.documentElement.classList.toggle("dark", isDark.value);
    localStorage.setItem("isDark", JSON.stringify(isDark.value));
  }

  return { isDark, apply };
});
