/**
 * Vitest configuration for AFK.
 *
 * Uses the v4 plugin-based shape of @cloudflare/vitest-pool-workers
 * (`cloudflareTest({...})`). Tests run inside the Workers runtime with a
 * fresh in-memory D1 + KV per test file.
 */

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-04-30",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        kvNamespaces: ["KV"],
        bindings: {
          RP_ID: "localhost",
          RP_NAME: "AFK Test",
          APP_ORIGIN: "http://localhost:5173",
          APP_VERSION: "test",
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  test: {
    include: ["worker/**/*.test.ts", "shared/**/*.test.ts"],
  },
});
