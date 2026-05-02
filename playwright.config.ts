/**
 * Playwright configuration. The dev server is launched in
 * SUPPRESS_AUTH mode via .dev.vars (see ./e2e/global-setup.ts) so tests
 * don't have to navigate WebAuthn.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"],
    },
    {
      name: "mobile",
      use: devices["iPhone 14"],
    },
  ],
  webServer: {
    command: "npx vite --port 5173",
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Tests rely on SUPPRESS_AUTH so we don't have to dance with
      // platform-specific WebAuthn UI.
      AFK_E2E: "1",
    },
  },
});
