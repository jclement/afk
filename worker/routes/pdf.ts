/**
 * PDF generation via Cloudflare Browser Rendering.
 *
 * The worker server-renders an HTML document (see lib/print-template.ts)
 * and hands it to a headless Chrome instance via @cloudflare/puppeteer
 * using `page.setContent`. The browser then exports an A4 PDF, which we
 * stream back to the client.
 *
 * Falls back to returning the source HTML with a 503-style hint when the
 * BROWSER binding isn't available (e.g. local dev without Browser Rendering
 * configured).
 */

import { Hono } from "hono";
import puppeteer from "@cloudflare/puppeteer";
import type { HonoVars } from "../types.js";
import { authedUser, requireAuth } from "../lib/auth.js";
import { err } from "../lib/responses.js";
import {
  listAllowances,
  listAllVacations,
  listCategories,
} from "../lib/store.js";
import { renderPrintHTML } from "../lib/print-template.js";

const r = new Hono<HonoVars>();

r.use("*", requireAuth);

r.get("/:year{[0-9]+}", async (c) => {
  const user = authedUser(c);
  const year = Number(c.req.param("year"));
  if (year < 1900 || year > 2200) {
    return err(c, "VALIDATION_ERROR", "Year out of range.");
  }

  const [categories, allowances, vacations] = await Promise.all([
    listCategories(c.env.DB, user.id),
    listAllowances(c.env.DB, user.id, year),
    listAllVacations(c.env.DB, user.id),
  ]);

  const html = renderPrintHTML({
    user,
    year,
    categories,
    allowances,
    vacations,
  });

  // If Browser Rendering binding isn't set up locally, fall back to HTML —
  // useful for previewing the layout without paying for Browser Rendering.
  if (!c.env.BROWSER) {
    if (c.req.query("html") === "1") {
      return c.html(html);
    }
    return err(
      c,
      "SERVICE_UNAVAILABLE",
      "Browser Rendering binding not configured. Append ?html=1 to preview the source.",
    );
  }

  try {
    const browser = await puppeteer.launch(c.env.BROWSER as never);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0mm", bottom: "0mm", left: "0mm", right: "0mm" },
    });
    await browser.close();
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="afk-${user.username}-${year}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("pdf rendering failed", e);
    return err(
      c,
      "INTERNAL_ERROR",
      `PDF rendering failed: ${(e as Error).message}`,
    );
  }
});

export default r;
