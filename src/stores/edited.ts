import { defineStore } from "pinia";
import { ref, toRaw } from "vue";
import { EMPTY_BLOG } from "@/types/Blog";
import { ElMessage } from "element-plus";
import { uploadSingle } from "@/apis/datasource";
import { goHome } from "@/router";

export const useEditedStore = defineStore("edited", () => {
  const current = ref(EMPTY_BLOG());

  function isCurrentBlank() {
    const c = current.value;
    return !c.text || !c.videos || !c.images;
  }

  function setCurrentBlank() {
    current.value = EMPTY_BLOG();
  }

  async function handleSubmit() {
    if (!current.value.text) {
      ElMessage({
        message: "你还什么都没有写哦",
        type: "warning",
      });
      return;
    }

    const d = new Date();
    current.value.id = d.getTime();
    current.value.date = d;

    await uploadSingle(toRaw(current.value));
    setCurrentBlank();
    ElMessage({
      message: "发布成功",
      type: "success",
    });
    goHome();
  }

  return {
    current,
    isCurrentBlank,
    setCurrentBlank,
    handleSubmit,
  };
});
