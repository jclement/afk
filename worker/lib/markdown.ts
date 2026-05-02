/**
 * Tiny wrapper around `marked` for rendering user-supplied notes as HTML.
 *
 * We're rendering text the user wrote about themselves to themselves (email
 * inbox, calendar event description), so XSS isn't a real threat — but we
 * still strip tags that email clients like to forbid (`<script>`, event
 * handlers, javascript: URLs) so the email passes their HTML sanitisers
 * cleanly instead of getting mangled or quarantined.
 */

import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true, // a single newline becomes a <br> — matches what users expect
});

export function renderMarkdown(input: string): string {
  if (!input.trim()) return "";
  const raw = marked.parse(input, { async: false }) as string;
  return scrub(raw);
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
