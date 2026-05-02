/**
 * Login screen — passkey authentication. Single big "Sign in" button that
 * triggers the OS passkey picker. The username field is hidden behind a
 * "Trouble signing in?" disclosure for environments where the discoverable-
 * credential flow doesn't reliably surface the right account.
 */

import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { loginWithPasskey } from "../lib/passkey-client";
import { pickTagline } from "@shared/taglines";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const [username, setUsername] = useState("");
  const [showUsername, setShowUsername] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loginWithPasskey(username.trim() || undefined);
      await qc.invalidateQueries();
      navigate({ to: "/" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-heading tracking-tight">AFK</h1>
          <div className="text-xs text-muted italic mt-1">{pickTagline()}</div>
        </div>
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

        <div className="mt-5 pt-4 border-t border-subtle text-center text-sm">
          <span className="text-muted">First time here? </span>
          <Link to="/setup" className="font-semibold text-heading hover:underline">
            Create an account
          </Link>
        </div>

        {!showUsername && (
          <button
            type="button"
            className="mt-3 text-[11px] text-muted hover:text-heading w-full text-center"
            onClick={() => setShowUsername(true)}
          >
            Trouble signing in? Type your username instead.
          </button>
        )}
      </div>
    </div>
  );
}
