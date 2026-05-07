/**
 * Tiny wrapper around `marked` for rendering user-supplied notes as HTML.
 *
 * We're rendering text the user wrote about themselves to themselves (email
 * inbox, calendar event description), so XSS isn't a real threat — but we
 * still strip tags that email clients like to forbid (`<script>`, event
 * handlers, javascript: URLs) so the email passes their HTML sanitisers
 * cleanly instead of getting mangled or quarantined.
 *
 * **DO NOT** use this for content authored by an unauthenticated third party
 * (e.g. the manager's reject comment on the boss flow). Markdown link syntax
 * `[label](url)` lets a hostile author ship the user a phishing link under
 * arbitrary anchor text. For untrusted content, use
 * `escapeHtmlMultiline()` from `email-template.ts` instead.
 *
 * After rendering, every block element gets an inline style attribute. Email
 * clients (Gmail, Outlook, Fastmail) routinely strip <style> blocks and even
 * default list/heading CSS, so without inline styles a `<ul>` shows up as
 * unindented text with no bullets — which looked like markdown was broken.
 */

import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true, // a single newline becomes a <br> — matches what users expect
});

export function renderMarkdown(input: string): string {
  if (!input.trim()) return "";
  const raw = marked.parse(input, { async: false }) as string;
  return inlineStyle(scrub(raw));
}

/** Plain-text passthrough used as the text/plain alternative in emails. */
export function markdownToPlain(input: string): string {
  return input;
}

function scrub(html: string): string {
  return (
    html
      // strip <script>...</script> and <style>...</style> blocks
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      // strip <iframe> / <object> / <embed> openers and closers
      .replace(/<\/?(iframe|object|embed|frame|frameset)\b[^>]*>/gi, "")
      // strip on*="..." event handler attributes
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
      // strip javascript: URLs in href / src
      .replace(/(href|src)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"')
      .replace(/(href|src)\s*=\s*'\s*javascript:[^']*'/gi, "$1='#'")
  );
}

/**
 * Tag → inline style. Anything block-level the user might write in markdown
 * gets explicit margin / padding / list-style so the result is legible even
 * when the email client strips its own defaults.
 */
const INLINE_STYLES: Record<string, string> = {
  p: "margin:0 0 8px 0",
  ul: "margin:8px 0;padding-left:24px;list-style:disc",
  ol: "margin:8px 0;padding-left:24px;list-style:decimal",
  li: "margin:2px 0",
  blockquote: "margin:8px 0;padding:0 12px;border-left:3px solid #e5e7eb;color:#4b5563",
  h1: "font-size:20px;font-weight:600;margin:16px 0 8px 0",
  h2: "font-size:18px;font-weight:600;margin:14px 0 6px 0",
  h3: "font-size:16px;font-weight:600;margin:12px 0 4px 0",
  h4: "font-size:14px;font-weight:600;margin:10px 0 4px 0",
  h5: "font-size:13px;font-weight:600;margin:10px 0 4px 0",
  h6: "font-size:12px;font-weight:600;margin:10px 0 4px 0",
  code: "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:90%",
  pre: "background:#f3f4f6;padding:8px 10px;border-radius:4px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:90%;margin:8px 0",
  a: "color:#2563eb;text-decoration:underline",
  hr: "border:none;border-top:1px solid #e5e7eb;margin:12px 0",
  strong: "font-weight:600",
  em: "font-style:italic",
};

function inlineStyle(html: string): string {
  return html.replace(
    /<(\/?)([a-z][a-z0-9]*)(\s[^>]*)?>/gi,
    (full, slash: string, tag: string, attrs: string | undefined) => {
      if (slash) return full; // closing tags untouched
      const style = INLINE_STYLES[tag.toLowerCase()];
      if (!style) return full;
      const a = attrs ?? "";
      // Skip if the tag already carries a style attribute (don't clobber).
      if (/\sstyle\s*=/i.test(a)) return full;
      return `<${tag}${a} style="${style}">`;
    },
  );
}
