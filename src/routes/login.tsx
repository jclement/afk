/**
 * Login screen — passkey authentication. Single big "Sign in" button that
 * triggers the OS passkey picker. The username field is hidden behind a
 * "Trouble signing in?" disclosure for environments where the discoverable-
 * credential flow doesn't reliably surface the right account.
 *
 * Recovery-code fallback: when every passkey is gone, the user can type a
 * one-time recovery code from the codes they saved at signup.
 */

import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { KeyRound, LifeBuoy } from "lucide-react";
import { loginWithPasskey } from "../lib/passkey-client";
import { pickTagline } from "@shared/taglines";
import { useQueryClient } from "@tanstack/react-query";
import { useRecoveryLogin } from "../api/hooks";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: (raw): { mode?: "passkey" | "recovery" } => ({
    mode: raw.mode === "recovery" ? "recovery" : undefined,
  }),
});

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"passkey" | "recovery">(search.mode ?? "passkey");

  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-heading tracking-tight">AFK</h1>
          <div className="text-xs text-muted italic mt-1">{pickTagline()}</div>
        </div>

        {mode === "passkey" ? (
          <PasskeyForm
            onSwitchToRecovery={() => setMode("recovery")}
            onSuccess={async () => {
              await qc.invalidateQueries();
              navigate({ to: "/" });
            }}
          />
        ) : (
          <RecoveryForm
            onSwitchToPasskey={() => setMode("passkey")}
            onSuccess={async () => {
              await qc.invalidateQueries();
              // The wizard guard takes over from here if welcome is incomplete.
              // We send everyone to "/" and let the root redirect logic decide.
              navigate({
                to: "/",
                search: { recovery: 1 } as { recovery?: number },
              });
            }}
          />
        )}

        <div className="mt-5 pt-4 border-t border-subtle text-center text-sm">
          <span className="text-muted">First time here? </span>
          <Link to="/setup" className="font-semibold text-heading hover:underline">
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}

function PasskeyForm({
  onSuccess,
  onSwitchToRecovery,
}: {
  onSuccess: () => Promise<void> | void;
  onSwitchToRecovery: () => void;
}) {
  const [username, setUsername] = useState("");
  const [showUsername, setShowUsername] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loginWithPasskey(username.trim() || undefined);
      await onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={handleLogin} className="grid gap-3">
        {showUsername && (
          <div>
            <label className="label">Username</label>
            <input
              className="input"
              type="text"
              placeholder="your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username webauthn"
              autoFocus
            />
          </div>
        )}
        <button type="submit" className="btn btn-primary justify-center" disabled={busy}>
          <KeyRound className="w-4 h-4" />
          {busy ? "Negotiating with your authenticator…" : "Sign in with passkey"}
        </button>
        {error && (
          <div role="alert" className="text-sm text-[color:var(--color-danger)]">
            {error}
          </div>
        )}
      </form>

      {!showUsername && (
        <button
          type="button"
          className="mt-3 text-[11px] text-muted hover:text-heading w-full text-center"
          onClick={() => setShowUsername(true)}
        >
          Trouble signing in? Type your username instead.
        </button>
      )}
      <button
        type="button"
        className="mt-2 text-[11px] text-muted hover:text-heading w-full text-center inline-flex items-center justify-center gap-1"
        onClick={onSwitchToRecovery}
      >
        <LifeBuoy className="w-3 h-3" aria-hidden="true" />
        Use a recovery code instead
      </button>
    </>
  );
}

function RecoveryForm({
  onSuccess,
  onSwitchToPasskey,
}: {
  onSuccess: () => Promise<void> | void;
  onSwitchToPasskey: () => void;
}) {
  const recovery = useRecoveryLogin();
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    recovery.mutate(
      { username: username.trim().toLowerCase(), code: code.trim() },
      {
        onSuccess: () => onSuccess(),
        onError: (e) => setError((e as Error).message),
      },
    );
  }

  return (
    <>
      <form onSubmit={handleLogin} className="grid gap-3">
        <div>
          <label className="label" htmlFor="recovery-username">
            Username
          </label>
          <input
            id="recovery-username"
            className="input"
            type="text"
            placeholder="your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="recovery-code">
            Recovery code
          </label>
          <input
            id="recovery-code"
            className="input font-mono"
            type="text"
            placeholder="xxxx-xxxx-xxxx-xxxx"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <div className="text-[11px] text-muted mt-1">
            One of the 10 codes you saved at signup. Each one works once.
          </div>
        </div>
        <button
          type="submit"
          className="btn btn-primary justify-center"
          disabled={recovery.isPending}
        >
          <LifeBuoy className="w-4 h-4" />
          {recovery.isPending ? "Checking…" : "Sign in with recovery code"}
        </button>
        {error && (
          <div role="alert" className="text-sm text-[color:var(--color-danger)]">
            {error}
          </div>
        )}
      </form>
      <button
        type="button"
        className="mt-3 text-[11px] text-muted hover:text-heading w-full text-center inline-flex items-center justify-center gap-1"
        onClick={onSwitchToPasskey}
      >
        <KeyRound className="w-3 h-3" aria-hidden="true" />
        Back to passkey sign-in
      </button>
    </>
  );
}
