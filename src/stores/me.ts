import { defineStore } from "pinia";
import { ref, watch } from "vue";

export const useMeStore = defineStore("achievement", () => {
  const you = ref(localStorage.getItem("you") || "Penyo");

  watch(you, () => localStorage.setItem("you", you.value));

  const firstCome = ref(
    (() => {
      {
        const raw = localStorage.getItem("first-come");
        if (raw) return new Date(JSON.parse(raw)).getTime();

        const current = new Date().getTime();
        localStorage.setItem("first-come", JSON.stringify(current));
        return current;
      }
    })(),
  );

  return { you, firstCome };
});
