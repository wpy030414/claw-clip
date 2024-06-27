import { defineStore } from "pinia";
import { ref } from "vue";

export const useSearchedStore = defineStore("searched", () => {
  const keyword = ref("");

  return { keyword };
});
