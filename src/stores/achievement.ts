import { defineStore } from "pinia";
import { ref } from "vue";

export const useAchievementStore = defineStore("achievement", () => {
  function firstCome() {
    const raw = localStorage.getItem("first-come");
    if (raw) return;
    localStorage.setItem("first-come", JSON.stringify(new Date().getTime()));
  }

  return { firstCome };
});
