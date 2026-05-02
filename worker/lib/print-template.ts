/**
 * Server-rendered HTML for the year-summary PDF.
 *
 * Produced as a single static HTML string and handed to the Browser
 * Rendering binding via `page.setContent()` — no network round-trip, no
 * auth dance, no race condition.
 *
 * Style notes:
 *   - System fonts only (the headless browser doesn't always have time
 *     to fetch Google Fonts before the PDF snap).
 *   - Print-friendly: A4 portrait, 18mm margins applied via @page.
 *   - Sarcastic cover line because it's that kind of app.
 */

import {
  categoryUsage,
  describeVacation,
  parseISODate,
  vacationDayCost,
  vacationsInYear,
} from "../../shared/vacation-math.js";
import { pickTagline } from "../../shared/taglines.js";
import type {
  Allowance,
  Category,
  User,
  Vacation,
} from "../../shared/types.js";

interface PrintData {
  user: User;
  year: number;
  categories: Category[];
  allowances: Allowance[];
  vacations: Vacation[];
}

export function renderPrintHTML(data: PrintData): string {
  const { user, year, categories, allowances, vacations } = data;
  const allowanceByCat = new Map<string, Allowance>(
    allowances.map((a) => [a.category_id, a]),
  );
  const visible = vacationsInYear(year, vacations);
  const asOf = new Date();
  const summaries = categories
    .filter((c) => !c.archived)
    .map((cat) => {
      const allowance = allowanceByCat.get(cat.id) ?? null;
      const usage = categoryUsage(
        cat,
        allowance,
        visible.filter((v) => v.category_id === cat.id),
        asOf,
        year,
      );
      return { cat, allowance, usage };
    });

  const catsById = new Map(categories.map((c) => [c.id, c]));
  const tagline = pickTagline(`${user.id}:${year}`);

  const monthBuckets = new Map<string, Vacation[]>();
  for (const v of visible) {
    const m = parseISODate(v.start_date).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    if (!monthBuckets.has(m)) monthBuckets.set(m, []);
    monthBuckets.get(m)!.push(v);
  }

  const css = `
    @page { size: A4 portrait; margin: 18mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111827; margin: 0; }
    h1 { font-size: 28px; margin: 0 0 4px 0; letter-spacing: -0.02em; }
    .tag { color: #6b7280; font-style: italic; margin-bottom: 24px; }
    .meta { color: #4b5563; font-size: 12px; }
    h2 { font-size: 18px; margin: 24px 0 8px 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #f1f5f9; }
    th { background: #f9fafb; font-weight: 600; color: #374151; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; color: white; font-size: 10px; font-weight: 600; letter-spacing: 0.02em; }
    .num { font-variant-numeric: tabular-nums; }
    .totals td { font-weight: 600; }
    .footer { margin-top: 48px; font-size: 10px; color: #9ca3af; }
    .month { margin-top: 16px; }
    .desc { color: #4b5563; }
    .cancelled td { text-decoration: line-through; color: #9ca3af; }
  `;

  const summaryRows = summaries
    .map(({ cat, usage }) => {
      const used = fmtDays(usage.used_days);
      const available = fmtDays(usage.available_days);
      const total = fmtDays(usage.total_days);
      const remaining = fmtDays(usage.remaining_days);
      return `<tr>
        <td><span class="pill" style="background:${escapeHtml(cat.color)}">${escapeHtml(cat.name)}</span></td>
        <td>${cat.accrues ? "accrues" : "up front"}</td>
        <td class="num">${used}</td>
        <td class="num">${available}</td>
        <td class="num">${total}</td>
        <td class="num">${remaining}</td>
      </tr>`;
    })
    .join("");

  const detailSections = [...monthBuckets.entries()]
    .map(([month, items]) => {
      const rows = items
        .map((v) => {
          const cat = catsById.get(v.category_id);
          const cost = vacationDayCost(v);
          return `<tr class="${v.cancelled_at ? "cancelled" : ""}">
            <td>${escapeHtml(describeVacation(v))}</td>
            <td><span class="pill" style="background:${escapeHtml(cat?.color ?? "#999")}">${escapeHtml(cat?.name ?? "—")}</span></td>
            <td class="num">${cost.toString()}</td>
            <td class="desc">${escapeHtml(v.public_desc || v.internal_desc || "")}</td>
          </tr>`;
        })
        .join("");
      return `<div class="month"><h3 style="font-size:14px;margin:16px 0 4px 0;color:#374151">${escapeHtml(month)}</h3>
        <table><thead><tr><th>When</th><th>Category</th><th>Days</th><th>Note</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(user.display_name)} — AFK ${year}</title>
<style>${css}</style></head>
<body>
  <h1>AFK — ${year}</h1>
  <div class="tag">${escapeHtml(tagline)}</div>
  <div class="meta">${escapeHtml(user.display_name)} (@${escapeHtml(user.username)}) · generated ${escapeHtml(new Date().toISOString().slice(0, 10))}</div>

  <h2>Category summary (days)</h2>
  <table><thead><tr><th>Category</th><th>Accrual</th><th>Used</th><th>Available</th><th>Total</th><th>Remaining</th></tr></thead>
  <tbody>${summaryRows || `<tr><td colspan="6">No categories defined.</td></tr>`}</tbody></table>

  <h2>Vacations</h2>
  ${detailSections || `<div>No vacations recorded for ${year}. Suspicious.</div>`}

  <div class="footer">Generated by AFK · afk.onewheelgeek.net · ${TAGLINE_FOOTER}</div>
</body></html>`;
}

const TAGLINE_FOOTER = "Out of office, into PDF.";

function fmtDays(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
