/**
 * Shared HTML scaffolding for transactional emails (verification, vacation
 * invites, boss consent / approval / receipts).
 *
 * Design constraints:
 *   - Inline styles only — Gmail / Outlook strip <style> blocks.
 *   - Table-based outer layout — Outlook on Windows ignores most modern CSS.
 *   - No web fonts, no background images, no JS, no media queries we depend on.
 *   - Light theme only. Outlook ignores prefers-color-scheme; rendering darker
 *     in supporting clients still has to look intentional, so we stick to a
 *     neutral palette that reads well on both.
 *
 * Public surface: `renderEmail()` for the wrapper + `metaTable()`, `button()`,
 * `paragraph()`, `lead()`, `notesBlock()`, `divider()`, `escapeHtml()` for
 * content blocks.
 */
const COLORS = {
  brand: "#2563eb",
  brandDark: "#1d4ed8",
  page: "#f3f4f6",
  card: "#ffffff",
  border: "#e5e7eb",
  heading: "#111827",
  body: "#1f2937",
  subtle: "#4b5563",
  muted: "#6b7280",
  faint: "#9ca3af",
  cancelled: "#b45309",
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,'Helvetica Neue',Arial,sans-serif";

export interface RenderEmailOpts {
  /** Hidden preheader — first text the inbox preview shows. ~80 chars max. */
  preheader: string;
  /** Big heading at the top of the card. */
  heading: string;
  /** Optional accent strip color above the card (e.g. red for cancelled). */
  accent?: "brand" | "danger" | "warning" | "success";
  /** Pre-rendered HTML blocks that live inside the card body. */
  blocks: string[];
  /** Footer text (rendered under the card, muted). HTML allowed. */
  footer: string;
}

export function renderEmail(opts: RenderEmailOpts): string {
  const accentColor =
    opts.accent === "danger"
      ? "#dc2626"
      : opts.accent === "warning"
        ? COLORS.cancelled
        : opts.accent === "success"
          ? "#15803d"
          : COLORS.brand;
  const preheader = escapeHtml(opts.preheader);
  return [
    `<!DOCTYPE html>`,
    `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.heading)}</title></head>`,
    `<body style="margin:0;padding:0;background:${COLORS.page};">`,
    // Hidden preheader — controls inbox preview text.
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:transparent;opacity:0;font-size:1px;line-height:1px">${preheader}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};padding:24px 12px;font-family:${FONT};">`,
    `<tr><td align="center">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">`,
    // Brand row above the card
    `<tr><td style="padding:0 4px 12px 4px;">`,
    `<span style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;font-weight:600;color:${COLORS.brand};">AFK</span>`,
    `<span style="font-size:13px;color:${COLORS.muted};margin-left:8px">· away from keyboard</span>`,
    `</td></tr>`,
    // Coloured accent strip — visual cue for cancellations vs normal sends.
    `<tr><td style="background:${accentColor};height:4px;line-height:4px;font-size:0;border-radius:8px 8px 0 0;">&nbsp;</td></tr>`,
    // Card
    `<tr><td style="background:${COLORS.card};border:1px solid ${COLORS.border};border-top:none;border-radius:0 0 8px 8px;padding:28px 32px;color:${COLORS.body};font-size:15px;line-height:1.55;">`,
    `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:600;color:${COLORS.heading};">${escapeHtml(opts.heading)}</h1>`,
    opts.blocks.join("\n"),
    `</td></tr>`,
    // Footer
    `<tr><td style="padding:16px 4px 0 4px;color:${COLORS.faint};font-size:12px;line-height:1.5;">${opts.footer}</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `</body></html>`,
  ].join("");
}

/** Lead paragraph — slightly larger than body. Good for the first sentence. */
export function lead(html: string): string {
  return `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;color:${COLORS.body};">${html}</p>`;
}

/** Standard body paragraph. */
export function paragraph(html: string): string {
  return `<p style="margin:0 0 12px 0;color:${COLORS.body};">${html}</p>`;
}

/** Muted sub-paragraph — for "your calendar should update automatically" hints. */
export function muted(html: string): string {
  return `<p style="margin:12px 0 0 0;color:${COLORS.muted};font-size:13px;line-height:1.5;">${html}</p>`;
}

/** Light divider line. */
export function divider(): string {
  return `<hr style="border:none;border-top:1px solid ${COLORS.border};margin:20px 0;">`;
}

/** Key/value summary table for "When / Category / Days" style blocks. */
export function metaTable(rows: Array<[string, string]>): string {
  const cells = rows
    .map(
      ([k, v]) =>
        `<tr>` +
        `<td style="padding:4px 16px 4px 0;color:${COLORS.muted};font-size:13px;white-space:nowrap;vertical-align:top;width:1%;">${escapeHtml(k)}</td>` +
        `<td style="padding:4px 0;color:${COLORS.heading};font-size:14px;vertical-align:top;">${escapeHtml(v)}</td>` +
        `</tr>`,
    )
    .join("");
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 16px 0;border:1px solid ${COLORS.border};border-radius:6px;background:#fafafa;padding:8px 14px;">` +
    cells +
    `</table>`
  );
}

/**
 * Render an already-html-rendered notes block (e.g. user's markdown notes
 * post-`renderMarkdown`) inside a subtle bordered area so it visually
 * separates from the meta-table.
 */
export function notesBlock(rawHtml: string, label?: string): string {
  if (!rawHtml.trim()) return "";
  const heading = label
    ? `<div style="font-size:12px;letter-spacing:0.05em;text-transform:uppercase;color:${COLORS.muted};margin:0 0 6px 0;">${escapeHtml(label)}</div>`
    : "";
  return (
    `<div style="border-left:3px solid ${COLORS.border};padding:4px 0 4px 12px;margin:8px 0 16px 0;color:${COLORS.body};font-size:14px;line-height:1.55;">` +
    heading +
    rawHtml +
    `</div>`
  );
}

/**
 * Bulletproof CTA button. Two-layer trick: a styled <a> for modern clients,
 * and the same anchor wrapped in a table cell with bgcolor / inline padding
 * so Outlook still renders a button-shaped block.
 */
export function button(href: string, label: string, kind: "brand" | "danger" = "brand"): string {
  const bg = kind === "danger" ? "#dc2626" : COLORS.brand;
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px 0;">` +
    `<tr><td style="background:${bg};border-radius:6px;">` +
    `<a href="${safeHref}" style="display:inline-block;padding:11px 22px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${safeLabel}</a>` +
    `</td></tr></table>`
  );
}

/**
 * Plain-text fallback link rendered alongside the button — some clients
 * strip styled buttons or the recipient just wants to copy the URL.
 */
export function linkFallback(href: string): string {
  const safe = escapeHtml(href);
  return `<p style="margin:0 0 16px 0;font-size:12px;line-height:1.5;color:${COLORS.muted};word-break:break-all;">Or paste this link into your browser: <a href="${safe}" style="color:${COLORS.brand};">${safe}</a></p>`;
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Small HTML helper: a colored badge (e.g. "Pending", "Cancelled"). */
export function badge(text: string, kind: "brand" | "warning" | "danger" | "success"): string {
  const bg =
    kind === "warning"
      ? "#fef3c7"
      : kind === "danger"
        ? "#fee2e2"
        : kind === "success"
          ? "#dcfce7"
          : "#dbeafe";
  const fg =
    kind === "warning"
      ? "#92400e"
      : kind === "danger"
        ? "#991b1b"
        : kind === "success"
          ? "#166534"
          : "#1e40af";
  return `<span style="display:inline-block;padding:2px 8px;font-size:12px;font-weight:600;border-radius:999px;background:${bg};color:${fg};">${escapeHtml(text)}</span>`;
}
