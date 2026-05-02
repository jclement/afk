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
import { listAllowances, listAllVacations, listCategories } from "../lib/store.js";
import { renderPrintHTML } from "../lib/print-template.js";

const r = new Hono<HonoVars>();

r.use("*", requireAuth);

r.get("/:year{[0-9]+}", async (c) => {
  const user = authedUser(c);
  const year = Number(c.req.param("year"));
  // The path regex already filters non-numeric, but `Number("999999999999...")`
  // can still produce a non-finite or unreasonable value — the integer guard
  // closes that gap before the year flows into D1 and date math.
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
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

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch(c.env.BROWSER as never);
    const page = await browser.newPage();
    // Defense in depth: the template ships zero scripts; disabling JS in the
    // page makes sure a future template change can't be exploited via
    // user-controlled HTML to make outbound network calls or run code.
    await page.setJavaScriptEnabled(false);
    // `waitUntil: "load"` is enough — there are no external resources to wait
    // on (system fonts only, no images). `networkidle0` would just wait the
    // default 500ms idle timer for nothing. 15s ceiling so a misbehaving
    // template can't hang the worker until the platform CPU cap.
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      // Margin set in @page in the template (see print-template.ts). Don't
      // override here — Puppeteer's `margin` option wins over `@page`, and
      // setting it to 0 here was clipping the page to the paper edge.
      displayHeaderFooter: true,
      headerTemplate:
        '<div style="font-size:8px;width:100%;padding:0 18mm;color:#9ca3af">AFK</div>',
      footerTemplate:
        '<div style="font-size:8px;width:100%;padding:0 18mm;text-align:right;color:#9ca3af"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="afk-${user.username}-${year}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("pdf rendering failed", e);
    return err(c, "INTERNAL_ERROR", `PDF rendering failed: ${(e as Error).message}`);
  } finally {
    // Always close the browser, even on error — otherwise the headless
    // Chrome instance leaks for the lifetime of the isolate.
    if (browser) await browser.close().catch(() => undefined);
  }
});

export default r;
