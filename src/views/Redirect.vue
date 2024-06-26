<script setup lang="ts">
import router from "@/router";

router.push(router.currentRoute.value.query.to as string);
</script>

<template></template>

<style scoped></style>
