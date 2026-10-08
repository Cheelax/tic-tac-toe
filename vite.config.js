// Plain JavaScript, loaded natively (`--configLoader native`): the build writes nothing to node_modules,
// which the Hotpod runner mounts read only.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: dist/ works from any folder (the checks serve it at /, GitHub Pages under /<repo>/).
  base: "./",
});
