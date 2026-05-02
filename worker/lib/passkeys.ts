/**
 * Passkey / WebAuthn flows. Built on @simplewebauthn/server.
 *
 * The flows are split across four endpoints (see ../routes/auth.ts):
 *   1. POST /api/v1/auth/register/start    — username -> registration options
 *   2. POST /api/v1/auth/register/finish   — verify attestation, create user + credential
 *   3. POST /api/v1/auth/login/start       — optional username -> assertion options
 *   4. POST /api/v1/auth/login/finish      — verify assertion, create session
 *
 * Subtle bits to NOT screw up (we have screwed these up before):
 *   - Challenges go to KV with a 5-minute TTL keyed by a server-issued
 *     `flow_id` we hand to the client. The client returns `flow_id` so we
 *     pin the challenge to a specific flow. NEVER read the challenge back
 *     out of the client response — it must come from the server's KV.
 *   - The credential id MUST be stored as base64url (the format SimpleWebAuthn
 *     emits and accepts). We also store transports as JSON because we need
 *     them for the `allowCredentials` list during login.
 *   - `expectedOrigin` and `expectedRPID` come from env (RP_ID, APP_ORIGIN).
 *     For local dev the user can override via .dev.vars.
 *   - Counter handling: SimpleWebAuthn returns a new counter post-verify; we
 *     persist it. If the device returns 0 (most synced passkeys do), we just
 *     write 0 — that's spec-compliant and not a replay signal.
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransportFuture,
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import { newId } from "./ids.js";

export interface RPConfig {
  rpID: string;
  rpName: string;
  origin: string;
}

interface PendingRegistration {
  type: "registration";
  username: string;
  display_name: string;
  challenge: string;
  user_handle: string; // base64url; what we hand to the authenticator
}

interface PendingAuthentication {
  type: "authentication";
  username: string | null;
  challenge: string;
}

const REG_TTL_SECONDS = 5 * 60;

const KV_PREFIX = "afk:webauthn:";

async function putPending(
  kv: KVNamespace,
  flowId: string,
  payload: PendingRegistration | PendingAuthentication,
): Promise<void> {
  await kv.put(KV_PREFIX + flowId, JSON.stringify(payload), {
    expirationTtl: REG_TTL_SECONDS,
  });
}

async function takePending(
  kv: KVNamespace,
  flowId: string,
): Promise<PendingRegistration | PendingAuthentication | null> {
  const raw = await kv.get(KV_PREFIX + flowId);
  if (!raw) return null;
  // Burn the challenge after we read it. Even if verification fails the
  // client must restart the flow — never reuse a challenge.
  await kv.delete(KV_PREFIX + flowId);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RegistrationStartResult {
  flow_id: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

export async function startRegistration(
  kv: KVNamespace,
  rp: RPConfig,
  username: string,
  displayName: string,
  excludeCredentialIds: string[],
): Promise<RegistrationStartResult> {
  // The user handle is a stable, non-PII bytestring identifying the account.
  // We use a fresh random id during initial registration; subsequent
  // registrations (adding a passkey to an existing account) reuse the user's
  // existing user.id (caller passes username + we look it up upstream).
  const userHandle = newId();
  // SimpleWebAuthn wants Uint8Array<ArrayBuffer>; allocate a fresh buffer
  // (not the TextEncoder default which returns Uint8Array<ArrayBufferLike>).
  const encoded = new TextEncoder().encode(userHandle);
  const userIdBytes = copyToFreshArrayBuffer(encoded);

  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userID: userIdBytes,
    userName: username,
    userDisplayName: displayName,
    timeout: 60_000,
    attestationType: "none",
    excludeCredentials: excludeCredentialIds.map((id) => ({ id })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const flowId = newId();
  const pending: PendingRegistration = {
    type: "registration",
    username,
    display_name: displayName,
    challenge: options.challenge,
    user_handle: userHandle,
  };
  await putPending(kv, flowId, pending);

  return { flow_id: flowId, options };
}

export interface RegistrationFinishResult {
  user_handle: string;
  credential: {
    id: string;
    publicKey: string; // base64url
    counter: number;
    transports: AuthenticatorTransportFuture[] | null;
    deviceType: string | null;
    backedUp: boolean;
  };
  username: string;
  display_name: string;
}

export async function finishRegistration(
  kv: KVNamespace,
  rp: RPConfig,
  flowId: string,
  response: RegistrationResponseJSON,
): Promise<RegistrationFinishResult> {
  const pending = await takePending(kv, flowId);
  if (!pending || pending.type !== "registration") {
    throw new AuthError("Registration challenge expired or unknown.");
  }
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new AuthError("Passkey registration failed verification.");
  }
  const info = verification.registrationInfo;
  return {
    user_handle: pending.user_handle,
    credential: {
      id: info.credential.id,
      publicKey: bufferToBase64Url(info.credential.publicKey),
      counter: info.credential.counter ?? 0,
      transports: info.credential.transports ?? null,
      deviceType: info.credentialDeviceType ?? null,
      backedUp: info.credentialBackedUp ?? false,
    },
    username: pending.username,
    display_name: pending.display_name,
  };
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export interface AuthStartResult {
  flow_id: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export async function startAuthentication(
  kv: KVNamespace,
  rp: RPConfig,
  username: string | null,
  allowedCredentials: Array<{ id: string; transports: AuthenticatorTransportFuture[] | null }>,
): Promise<AuthStartResult> {
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    timeout: 60_000,
    userVerification: "preferred",
    allowCredentials: allowedCredentials.map((c) => ({
      id: c.id,
      transports: c.transports ?? undefined,
    })),
  });
  const flowId = newId();
  const pending: PendingAuthentication = {
    type: "authentication",
    username,
    challenge: options.challenge,
  };
  await putPending(kv, flowId, pending);
  return { flow_id: flowId, options };
}

export interface StoredCredential {
  id: string;
  user_id: string;
  publicKey: string; // base64url
  counter: number;
  transports: AuthenticatorTransportFuture[] | null;
}

export interface AuthFinishResult {
  user_id: string;
  credential_id: string;
  new_counter: number;
}

export async function finishAuthentication(
  kv: KVNamespace,
  db: D1Database,
  rp: RPConfig,
  flowId: string,
  response: AuthenticationResponseJSON,
): Promise<AuthFinishResult> {
  const pending = await takePending(kv, flowId);
  if (!pending || pending.type !== "authentication") {
    throw new AuthError("Authentication challenge expired or unknown.");
  }
  const credentialId = response.id;
  const stored = await loadCredential(db, credentialId);
  if (!stored) {
    throw new AuthError("Unknown credential.");
  }
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    credential: {
      id: stored.id,
      publicKey: copyToFreshArrayBuffer(base64UrlToBuffer(stored.publicKey)),
      counter: stored.counter,
      transports: stored.transports ?? undefined,
    },
    requireUserVerification: false,
  });
  if (!verification.verified) {
    throw new AuthError("Passkey verification failed.");
  }
  return {
    user_id: stored.user_id,
    credential_id: stored.id,
    new_counter: verification.authenticationInfo.newCounter,
  };
}

async function loadCredential(
  db: D1Database,
  id: string,
): Promise<StoredCredential | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, public_key AS publicKey, counter, transports
       FROM credentials WHERE id = ?`,
    )
    .bind(id)
    .first<{
      id: string;
      user_id: string;
      publicKey: string;
      counter: number;
      transports: string | null;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    publicKey: row.publicKey,
    counter: row.counter,
    transports: row.transports ? JSON.parse(row.transports) : null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  readonly code: "VALIDATION_ERROR" | "UNAUTHORIZED";
  constructor(
    message: string,
    code: "VALIDATION_ERROR" | "UNAUTHORIZED" = "VALIDATION_ERROR",
  ) {
    super(message);
    this.code = code;
  }
}

function bufferToBase64Url(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBuffer(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const norm = (b64 + pad).replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** SimpleWebAuthn's types insist on Uint8Array<ArrayBuffer> (not ArrayBufferLike). */
function copyToFreshArrayBuffer(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(src.length);
  const fresh = new Uint8Array(buf);
  fresh.set(src);
  return fresh;
}
