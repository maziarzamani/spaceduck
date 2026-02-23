import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

import react from "@astrojs/react";

export default defineConfig({
  site: "https://spaceduck.ai",
  base: "/",

  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [react()],
});