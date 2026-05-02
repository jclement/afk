/**
 * E2E happy path against the SUPPRESS_AUTH dev server: dashboard renders,
 * we can book a vacation and see it on the list.
 *
 * Requires that `.dev.vars` sets SUPPRESS_AUTH="true" — the playwright
 * config doesn't enforce this, but the test fails clearly if it isn't on
 * (no Header rendered → no "Book vacation" button).
 */

import { expect, test } from "@playwright/test";

test.describe("AFK dashboard", () => {
  test("loads the dashboard, books a vacation, and lists it", async ({ page }) => {
    await page.goto("/");
    // SUPPRESS_AUTH should land us on dashboard with developer user.
    await expect(page.getByRole("heading", { level: 2, name: /vacations/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: /book vacation/i }).click();
    await expect(page.getByRole("dialog", { name: /book vacation/i })).toBeVisible();

    // Default category should already be selected. Set a Mon-Fri range in 2026.
    await page.locator('input[type="date"]').first().fill("2026-06-01");
    await page.locator('input[type="date"]').nth(1).fill("2026-06-05");
    await page.getByPlaceholder("Out of Office").fill("E2E getaway");
    await page.getByRole("button", { name: /book it/i }).click();

    // Wait for the modal to close and the row to appear.
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("E2E getaway")).toBeVisible();
  });

  test("settings page renders and exposes feeds + passkeys", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
    await expect(page.getByText(/calendar feeds/i)).toBeVisible();
    await expect(page.getByText(/passkeys/i)).toBeVisible();
  });
});
