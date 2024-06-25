import { defineStore } from "pinia";
import { ref } from "vue";

export const useThemeStore = defineStore("theme", () => {
  const isDark = ref(JSON.parse(localStorage.getItem("isDark") || "false"));

  function apply() {
    document.documentElement.classList.toggle("dark", isDark.value);
  }

  function change() {
    isDark.value = !isDark.value;
    apply();
    localStorage.setItem("isDark", JSON.stringify(isDark.value));
  }

  return { isDark, apply, change };
});
