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

export async function registerPasskey(input: {
  username: string;
  display_name: string;
  nickname?: string;
}): Promise<User> {
  const start = await api<RegStartResponse>(
    `${API_BASE}/auth/register/start`,
    {
      method: "POST",
      json: {
        username: input.username,
        display_name: input.display_name,
      },
    },
  );
  let response;
  try {
    response = await browserStartReg({ optionsJSON: start.options });
  } catch (e) {
    throw new Error(`Could not register passkey: ${(e as Error).message}`, {
      cause: e,
    });
  }
  const finish = await api<{ user: User }>(
    `${API_BASE}/auth/register/finish`,
    {
      method: "POST",
      json: {
        flow_id: start.flow_id,
        response,
        nickname: input.nickname,
      },
    },
  );
  return finish.user;
}

export async function loginWithPasskey(username?: string): Promise<User> {
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
