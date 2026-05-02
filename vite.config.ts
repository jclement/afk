/**
 * Vite configuration for AFK.
 *
 * Uses the Cloudflare Vite plugin so that `vite dev` runs the worker code
 * (auth, API, PDF) inside Workerd — same runtime as production — while
 * keeping HMR for the React SPA. The plugin reads bindings from
 * wrangler.toml so D1, KV and Browser Rendering "just work" locally.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "node:path";

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
    cloudflare({
      configPath: "./wrangler.toml",
      auxiliaryWorkers: [],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist/client",
    sourcemap: true,
  },
});
