/**
 * Login screen — passkey authentication. Shows a subtle tagline and a
 * single big "Sign in with passkey" button. Username is optional but the
 * input is exposed for environments where the OS picker doesn't show all
 * accounts.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
          <div className="text-2xl font-bold text-heading tracking-tight">AFK</div>
          <div className="text-xs text-muted italic mt-1">{pickTagline()}</div>
        </div>
        <form onSubmit={handleLogin} className="grid gap-3">
          <div>
            <label className="label">Username (optional)</label>
            <input
              className="input"
              type="text"
              placeholder="leave blank to use OS picker"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username webauthn"
            />
          </div>
          <button type="submit" className="btn btn-primary justify-center" disabled={busy}>
            <KeyRound className="w-4 h-4" />
            {busy ? "Negotiating with your authenticator…" : "Sign in with passkey"}
          </button>
          {error && (
            <div className="text-sm text-[color:var(--color-danger)]">{error}</div>
          )}
        </form>
      </div>
    </div>
  );
}
