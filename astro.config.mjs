import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://ripota.org",
  vite: {
    build: {
      sourcemap: true,
    },
  },
});
