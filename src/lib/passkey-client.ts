/**
 * Browser-side passkey flows. Wraps @simplewebauthn/browser and the auth
 * endpoints into a pair of high-level functions: registerPasskey() and
 * loginWithPasskey().
 */

import {
  startAuthentication as browserStartAuth,
  startRegistration as browserStartReg,
} from "@simplewebauthn/browser";
import { API_BASE, api } from "./api";
import type { User } from "@shared/types";

interface RegStartResponse {
  flow_id: string;
  options: Parameters<typeof browserStartReg>[0]["optionsJSON"];
}

interface AuthStartResponse {
  flow_id?: string;
  options?: Parameters<typeof browserStartAuth>[0]["optionsJSON"];
  suppressed?: boolean;
}

/**
 * Probe the WebAuthn API. Old browsers, locked-down enterprise WebViews, and
 * some embedded browsers (Facebook in-app, etc.) don't ship the API at all —
 * we want to give those users a friendly explanation rather than a
 * stack-trace-y "TypeError: ... is undefined" surfaced through React Query.
 */
function assertWebAuthnSupported(): void {
  if (typeof window === "undefined") return;
  if (!("PublicKeyCredential" in window) || !window.navigator?.credentials) {
    throw new Error(
      "Your browser doesn't support passkeys. Try the latest Safari, Chrome, Firefox, or Edge.",
    );
  }
}

export async function registerPasskey(input: {
  username: string;
  display_name: string;
  nickname?: string;
}): Promise<User> {
  assertWebAuthnSupported();
  const start = await api<RegStartResponse>(`${API_BASE}/auth/register/start`, {
    method: "POST",
    json: {
      username: input.username,
      display_name: input.display_name,
    },
  });
  let response;
  try {
    response = await browserStartReg({ optionsJSON: start.options });
  } catch (e) {
    throw new Error(`Could not register passkey: ${(e as Error).message}`, {
      cause: e,
    });
  }
  const finish = await api<{ user: User }>(`${API_BASE}/auth/register/finish`, {
    method: "POST",
    json: {
      flow_id: start.flow_id,
      response,
      nickname: input.nickname,
      // Capture the browser's current IANA timezone on signup so the
      // dashboard and accrual math start in the user's local frame
      // without them having to find a settings page first.
      timezone: detectBrowserTimezone(),
    },
  });
  return finish.user;
}

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export async function loginWithPasskey(username?: string): Promise<User> {
  assertWebAuthnSupported();
  const start = await api<AuthStartResponse>(`${API_BASE}/auth/login/start`, {
    method: "POST",
    json: username ? { username } : {},
  });
  if (start.suppressed) {
    // SUPPRESS_AUTH path — server will hand us the dev user via /me.
    const me = await api<User>(`${API_BASE}/auth/me`);
    return me;
  }
  if (!start.options || !start.flow_id) {
    throw new Error("Login start did not return options.");
  }
  let response;
  try {
    response = await browserStartAuth({ optionsJSON: start.options });
  } catch (e) {
    throw new Error(`Could not authenticate: ${(e as Error).message}`, {
      cause: e,
    });
  }
  const finish = await api<{ user: User }>(`${API_BASE}/auth/login/finish`, {
    method: "POST",
    json: { flow_id: start.flow_id, response },
  });
  return finish.user;
}

/**
 * Run the WebAuthn ceremony but stop short of POSTing to /login/finish — used
 * by flows that need a fresh assertion to ship to a different endpoint (e.g.
 * DELETE /api/v1/me/account, which wants `{ flow_id, response, confirm }`).
 */
export async function getPasskeyAssertion(
  username: string,
): Promise<{ flow_id: string; response: unknown; suppressed?: boolean }> {
  assertWebAuthnSupported();
  const start = await api<AuthStartResponse>(`${API_BASE}/auth/login/start`, {
    method: "POST",
    json: { username },
  });
  if (start.suppressed) {
    // SUPPRESS_AUTH dev mode — the backend route already short-circuits on
    // its own, but we still need *something* to ship. The actual delete
    // endpoint requires a real flow, so this branch only matters for flows
    // that ignore the assertion in dev — callers should check `suppressed`.
    return { flow_id: "", response: null, suppressed: true };
  }
  if (!start.options || !start.flow_id) {
    throw new Error("Login start did not return options.");
  }
  let response;
  try {
    response = await browserStartAuth({ optionsJSON: start.options });
  } catch (e) {
    throw new Error(`Could not authenticate: ${(e as Error).message}`, {
      cause: e,
    });
  }
  return { flow_id: start.flow_id, response };
}
