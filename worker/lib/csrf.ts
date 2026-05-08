/**
 * Same-origin guard for state-changing requests that aren't authenticated by
 * a custom header (which would already trip CORS preflight). Used for the
 * boss-public POSTs (token-in-URL is the auth) and `/api/v1/auth/logout`
 * (deliberately unauthenticated so a stale cookie can be cleared).
 *
 * Behaviour, in priority order:
 *   1. `Sec-Fetch-Site` — set by every modern browser on every request.
 *      `same-origin` is exactly the property we want, and we don't have to
 *      compare strings that might disagree across Cloudflare custom domains,
 *      proxies, or URL normalisation.
 *   2. `Origin` — fallback for older clients. Must match the request URL's
 *      origin if present.
 *   3. Neither header — allow. Outlook desktop, corporate mail gateways and
 *      RFC 8058 one-click unsubscribe POSTs all do this, and there's no
 *      authenticated cookie at risk on these endpoints.
 *
 * Logs the rejected case with `[csrf:<tag>]` so a future mismatch is
 * diagnosable from `wrangler tail` without leaking the actual URL path
 * (which can carry a token).
 */
export function isSameOrigin(c: { req: { header(name: string): string | undefined; url: string } }, tag: string): boolean {
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite) {
    if (fetchSite === "same-origin") return true;
    console.warn(`[csrf:${tag}] sec-fetch-site mismatch`, {
      sec_fetch_site: fetchSite,
      origin: c.req.header("origin") ?? null,
    });
    return false;
  }
  const sent = c.req.header("origin");
  if (!sent) return true;
  const expected = new URL(c.req.url).origin;
  if (sent === expected) return true;
  console.warn(`[csrf:${tag}] origin mismatch`, { sent, expected });
  return false;
}
