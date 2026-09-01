import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/StillOpen/",
  build: { outDir: "dist" },
  test: {
    globals: true,
    environment: "node",
  },
});
