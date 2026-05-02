/**
 * First-run setup — only reachable when no users exist on the deployment.
 * Creates the first user (admin) and registers their first passkey.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { registerPasskey } from "../lib/passkey-client";
import { pickTagline } from "@shared/taglines";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nickname, setNickname] = useState("Primary passkey");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await registerPasskey({
        username: username.trim().toLowerCase(),
        display_name: displayName.trim(),
        nickname: nickname.trim() || "Primary passkey",
      });
      await qc.invalidateQueries();
      navigate({ to: "/" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8">
      <div className="card w-full max-w-md p-6">
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-heading tracking-tight">Set up AFK</div>
          <div className="text-xs text-muted italic mt-1">{pickTagline("setup")}</div>
        </div>
        <form onSubmit={handleSubmit} className="grid gap-3">
          <div>
            <label className="label">Username</label>
            <input
              className="input"
              type="text"
              required
              autoFocus
              pattern="[a-z0-9._-]+"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="jeff"
            />
          </div>
          <div>
            <label className="label">Display name</label>
            <input
              className="input"
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jeff Clement"
            />
          </div>
          <div>
            <label className="label">Passkey nickname</label>
            <input
              className="input"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary justify-center" disabled={busy}>
            <ShieldCheck className="w-4 h-4" />
            {busy ? "Registering passkey…" : "Create account & register passkey"}
          </button>
          {error && (
            <div className="text-sm text-[color:var(--color-danger)]">{error}</div>
          )}
        </form>
        <p className="text-xs text-muted mt-4">
          AFK is single-tenant. Once you finish setup, registration is closed for everyone else
          on this deployment.
        </p>
      </div>
    </div>
  );
}
