import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

// Tauri expects a fixed dev port and serves the built files from `dist`.
export default defineConfig({
  root: "ui",
  plugins: [svelte(), svelteTesting()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
  test: {
    root: ".",
    include: ["ui/src/**/*.test.ts"],
    environment: "jsdom",
    setupFiles: ["ui/src/test/setup.ts"],
    // Vitest blanks CSS files by default; the theme tests read theme.css as text.
    css: { include: [/\/ui\/src\/themes\//] },
    coverage: {
      provider: "v8",
      include: ["ui/src/**/*.{ts,svelte}"],
      exclude: [
        "ui/src/**/*.test.ts",
        "ui/src/test/**",
        "ui/src/lib/bindings/**",
        "ui/src/main.ts",
      ],
      reporter: ["text", "html"],
      // Floors, not goals: raise them as coverage grows.
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
      reportsDirectory: "coverage/ui",
    },
  },
});
