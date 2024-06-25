import { defineStore } from "pinia";
import { ref } from "vue";

export const useSearchedStore = defineStore("searched", () => {
  const keyword = ref("");

  function clean() {
    keyword.value = "";
  }

  return { keyword, clean };
});
