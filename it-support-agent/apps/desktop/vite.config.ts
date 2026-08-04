import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Config Vite standard pour Tauri : port fixe attendu par tauri.conf.json,
// et on ignore le watch de src-tauri pour éviter les rebuilds en boucle.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
