import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vitest config for component-level tests.
 *
 * Tests live under `test/` and target React components in isolation.
 * Real Dexie via `fake-indexeddb` so we exercise the wrapper's
 * applyLocal + enqueueAction paths without standing up a real IDB.
 * Mocking is scoped to network-side concerns: server actions are
 * mocked per-test; client components (SignaturePad, PhotoUpload) are
 * mocked when their internals would require canvas/file APIs that
 * jsdom doesn't supply.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: true,
    css: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
