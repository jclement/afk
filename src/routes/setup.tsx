/**
 * Account creation — anyone can land here and register a new user with a
 * passkey. Also the page the root component routes brand-new visitors to
 * when no users exist yet (so the very first arrival sees a "create account"
 * screen, not an empty login).
 */

import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { registerPasskey } from "../lib/passkey-client";
import { pickTagline } from "@shared/taglines";
import { useAuthStatus } from "../api/hooks";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const status = useAuthStatus();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nickname, setNickname] = useState("Primary passkey");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isFirstUser = status.data && !status.data.has_users;

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
          <div className="text-2xl font-bold text-heading tracking-tight">
            {isFirstUser ? "Welcome to AFK" : "Create your account"}
          </div>
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
              pattern="[a-z0-9._\-]+"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="jeff"
            />
            <div className="text-[11px] text-muted mt-1">
              Lowercase letters, digits, dot, underscore, hyphen.
            </div>
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
          {error && <div className="text-sm text-[color:var(--color-danger)]">{error}</div>}
        </form>

        <div className="mt-5 pt-4 border-t border-subtle text-center text-sm">
          <span className="text-muted">Already have an account? </span>
          <Link to="/login" className="font-semibold text-heading hover:underline">
            Sign in
          </Link>
        </div>

        <p className="text-xs text-muted mt-4">
          Each account is private — categories, vacations, and feeds are isolated to the user that
          created them. See{" "}
          <Link to="/about" className="underline">
            about &amp; privacy
          </Link>{" "}
          for the rest of the fine print.
        </p>
      </div>
    </div>
  );
}
