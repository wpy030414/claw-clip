import { defineStore } from "pinia";
import type { Blog } from "@/types/Blog";
import { IDB } from "@/apis";

export const useDataStore = defineStore("data", () => {
  async function load() {
    const blogs: Blog[] = [];
    for (const b of await IDB.queryAll()) blogs.push(b);
    return blogs;
  }

  function addBlog(blog: Blog) {
    IDB.add(blog);
  }

  function removeBlog(blog: Blog) {
    IDB.remove(blog);
  }

  return { load, addBlog, removeBlog };
});
