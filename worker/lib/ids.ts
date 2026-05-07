/**
 * Crypto-random identifier helpers. We use `crypto.randomUUID()` for entity
 * IDs (compact, opaque) and a 32-byte hex string for session tokens (more
 * entropy than a v4 UUID which only has 122 random bits).
 */

export function newId(): string {
  return crypto.randomUUID();
}

export function newSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newICalToken(): string {
  // 24 bytes -> 48 hex chars. Long enough that brute force is hopeless,
  // short enough to fit cleanly in a calendar URL.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Token for read-only dashboard share links. 24 bytes -> 48 hex chars.
 * Same shape as iCal tokens (192 bits of entropy is brute-force-proof) and
 * the routing format-gate regex is shared.
 */
export function newShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Token for boss consent + approval magic links. 32 bytes -> 64 hex chars.
 * These tokens are emailed to humans who paste-and-click; the entropy and
 * format match the email-verification token so the routing/format gates can
 * share a regex.
 */
export function newBossToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison for opaque tokens. */
export function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * SHA-256 hash a token. Bearer tokens (sessions, iCal, share, email-verify,
 * boss consent/decision/unsubscribe, recovery codes) are stored hashed in D1
 * so a read-only DB compromise yields nothing usable — the attacker has to
 * pre-image a 256-bit hash to forge any token.
 *
 * The plaintext only exists in the cookie / URL / email at the moment of
 * delivery. We never store it.
 */
export async function hashToken(token: string): Promise<string> {
  const buf = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a recovery code in `XXXX-XXXX-XXXX-XXXX` format using a Crockford
 * base32 alphabet (no I, L, O, U — confusable when typed). 16 chars × 5 bits =
 * 80 bits of entropy per code; 10 codes per user → infeasible to guess online.
 *
 * Codes are hashed before storage; only this freshly-returned plaintext can
 * ever be shown to the user.
 */
export function newRecoveryCode(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += alphabet[bytes[i]! & 0x1f];
  }
  return out;
}

/**
 * Normalise a recovery code typed by a user — strip whitespace and dashes,
 * uppercase. Lookup hashes the normalised form, so the user can paste with
 * any spacing.
 */
export function normaliseRecoveryCode(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase();
}
