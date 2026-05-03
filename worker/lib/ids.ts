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
