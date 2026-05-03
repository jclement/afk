/**
 * Settings — categories, allowances, passkeys, iCal feeds. One scrollable
 * page, four sections.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  KeyRound,
  Copy,
  Check,
  Mail,
  Globe,
  Download,
  UserCheck,
  User as UserIcon,
  Share2,
} from "lucide-react";
import {
  useAllowances,
  useBoss,
  useCategories,
  useClearEmail,
  useCreateCategory,
  useCreateICalToken,
  useCreateShareToken,
  useDeleteBoss,
  useDeleteCategory,
  useDeleteICalToken,
  useDeletePasskey,
  useDeleteShareToken,
  useICalTokens,
  usePasskeys,
  useRenamePasskey,
  useResendBossConsent,
  useResendEmailVerification,
  useSetDisplayName,
  useSetEmail,
  useSetTimezone,
  useShareTokens,
  useUpdateCategory,
  useUpsertAllowance,
  useUpsertBoss,
} from "../api/hooks";
import { registerPasskey } from "../lib/passkey-client";
import { useMe } from "../api/hooks";
import { currentYearInTimezone } from "../../shared/vacation-math";
import type { BossRelationship } from "@shared/types";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  validateSearch: (raw): { email?: string } => ({
    email: typeof raw.email === "string" ? raw.email : undefined,
  }),
});

function SettingsPage() {
  const me = useMe();
  // Use the user's configured timezone so the allowance editor shows the
  // same "current year" as the dashboard. Browser-local year would diverge
  // when the user's machine TZ differs from their AFK timezone.
  const year = currentYearInTimezone(me.data?.timezone ?? "UTC");
  return (
    <div className="max-w-3xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 flex flex-col gap-6">
      <h1 className="text-base font-semibold text-heading">Settings</h1>
      <DisplayNameSection />
      <TimezoneSection />
      <EmailSection />
      <CategoriesSection year={year} />
      <BossSection />
      <PasskeysSection />
      <ICalSection />
      <ShareLinksSection />
      <ExportSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boss / approver — opt-in. Notify mode emails the boss for every booking;
// approval mode requires them to click Approve before the calendar fires.
// ---------------------------------------------------------------------------
function BossSection() {
  const me = useMe();
  const boss = useBoss();
  const upsert = useUpsertBoss();
  const resend = useResendBossConsent();
  const remove = useDeleteBoss();

  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"notify" | "approval">("notify");
  const [error, setError] = useState<string | null>(null);

  // Pre-fill on edit; clear all state on cancel so re-opening doesn't show
  // stale typing from a previous session.
  function startEdit() {
    setEmail(boss.data?.boss_email ?? "");
    setMode(boss.data?.mode ?? "notify");
    setError(null);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setEmail("");
    setMode("notify");
    setError(null);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    upsert.mutate(
      { boss_email: email.trim().toLowerCase(), mode },
      {
        onSuccess: () => cancelEdit(),
        onError: (err) => setError((err as Error).message),
      },
    );
  }

  const userEmailOk = !!me.data?.email_verified_at;

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-heading mb-1 flex items-center gap-2">
        <UserCheck className="w-4 h-4" aria-hidden="true" /> Manager / approver
        <span className="text-[10px] uppercase tracking-wide text-muted font-normal">Optional</span>
      </h2>
      <p className="text-xs text-subtle mb-3">
        Optionally email a manager (or anyone) for every vacation you book — or have them approve
        each one. Honour-system; they don't need an AFK account.
      </p>

      {boss.isError && (
        <div role="alert" className="text-sm text-[color:var(--color-danger)]">
          Couldn't load manager settings: {(boss.error as Error).message}
        </div>
      )}

      {!editing && !boss.isPending && !boss.data && (
        <>
          <button
            type="button"
            className="btn btn-secondary min-h-[40px]"
            onClick={startEdit}
            disabled={!userEmailOk}
            aria-disabled={!userEmailOk}
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> Add manager / approver
          </button>
          {!userEmailOk && (
            <p className="text-[11px] text-muted mt-2">
              You'll need to verify your own email above first.
            </p>
          )}
        </>
      )}

      {!editing && boss.data && (
        <BossSummary
          boss={boss.data}
          onEdit={startEdit}
          onRemove={() => {
            if (
              window.confirm(
                "Remove this manager? Future vacations won't be sent to them. Already-sent calendar invites stay on their calendar.",
              )
            ) {
              remove.mutate(undefined, {
                onError: (e) => setError((e as Error).message),
              });
            }
          }}
          onResend={() =>
            resend.mutate(undefined, {
              onError: (e) => setError((e as Error).message),
            })
          }
          resendPending={resend.isPending}
          removePending={remove.isPending}
        />
      )}
      {!editing && error && (
        <div role="alert" className="text-sm text-[color:var(--color-danger)] mt-2">
          {error}
        </div>
      )}

      {editing && (
        <form onSubmit={save} className="grid gap-3 max-w-lg">
          <div>
            <label className="label" htmlFor="boss-email">
              Their email
            </label>
            <input
              id="boss-email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="manager@example.com"
              required
              autoComplete="off"
              autoFocus
            />
          </div>
          <fieldset className="grid gap-2">
            <legend className="label mb-1">Mode</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                checked={mode === "notify"}
                onChange={() => setMode("notify")}
                className="mt-1"
              />
              <span>
                <strong className="text-heading">Notify.</strong>{" "}
                <span className="text-subtle">
                  They get a calendar invite for every vacation. No approval gate.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                checked={mode === "approval"}
                onChange={() => setMode("approval")}
                className="mt-1"
              />
              <span>
                <strong className="text-heading">Requires approval.</strong>{" "}
                <span className="text-subtle">
                  Vacations enter as <em>pending</em> on your calendar. They get a one-click
                  approve/reject link. Calendar invites only fire on approval; rejection cancels the
                  booking and emails the comment back to you.
                </span>
              </span>
            </label>
          </fieldset>
          {error && (
            <div role="alert" className="text-sm text-[color:var(--color-danger)]">
              {error}
            </div>
          )}
          <div className="flex gap-2 mt-1">
            <button
              type="submit"
              className="btn btn-primary min-h-[40px]"
              disabled={upsert.isPending}
            >
              {upsert.isPending
                ? "Saving…"
                : boss.data
                  ? "Save & re-send consent"
                  : "Save & send consent email"}
            </button>
            <button type="button" className="btn btn-secondary min-h-[40px]" onClick={cancelEdit}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function BossSummary({
  boss,
  onEdit,
  onRemove,
  onResend,
  resendPending,
  removePending,
}: {
  boss: BossRelationship;
  onEdit: () => void;
  onRemove: () => void;
  onResend: () => void;
  resendPending: boolean;
  removePending: boolean;
}) {
  const status = boss.consent_status;
  const statusBg =
    status === "consented"
      ? "var(--color-success)"
      : status === "revoked"
        ? "var(--color-danger)"
        : "var(--color-warning)";
  const statusLabel =
    status === "consented" ? "Consented" : status === "revoked" ? "Revoked" : "Awaiting consent";
  // Resend works for both pending (re-send the original) and revoked
  // (re-invite). The server's reissueConsentToken accepts both branches.
  const showResend = status === "pending" || status === "revoked";
  const resendLabel = status === "revoked" ? "Re-invite" : "Resend consent";
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <span className="pill" style={{ background: statusBg }}>
          {statusLabel}
        </span>
        <span className="font-mono text-heading">{boss.boss_email}</span>
      </div>
      <div className="text-xs text-subtle">
        Mode:{" "}
        <strong className="text-heading">
          {boss.mode === "approval" ? "Requires approval" : "Notify"}
        </strong>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary min-h-[40px]"
          onClick={onEdit}
          disabled={removePending}
        >
          Edit
        </button>
        {showResend && (
          <button
            type="button"
            className="btn btn-secondary min-h-[40px]"
            onClick={onResend}
            disabled={resendPending || removePending}
          >
            <Mail className="w-4 h-4" aria-hidden="true" />
            {resendPending ? "Sending…" : resendLabel}
          </button>
        )}
        <button
          type="button"
          className="btn btn-danger min-h-[40px]"
          onClick={onRemove}
          disabled={removePending}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
          {removePending ? "Removing…" : "Remove"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data export — "give me everything you've got on me"
// ---------------------------------------------------------------------------
function ExportSection() {
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-heading mb-1 flex items-center gap-2">
        <Download className="w-4 h-4" /> Export your data
      </h2>
      <p className="text-xs text-subtle mb-3">
        Yours to take with you. JSON includes everything (profile, categories, allowances,
        vacations). CSV is your vacation list flattened for spreadsheets, with computed day costs.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <a
          className="btn btn-secondary inline-flex items-center justify-center gap-1.5 min-h-[40px]"
          href="/api/v1/me/export.json"
          download
        >
          <Download className="w-4 h-4" />
          Download everything (JSON)
        </a>
        <a
          className="btn btn-secondary inline-flex items-center justify-center gap-1.5 min-h-[40px]"
          href="/api/v1/me/export.csv"
          download
        >
          <Download className="w-4 h-4" />
          Download vacations (CSV)
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Display name — the user's own name, what shows up in the boss's calendar
// event subject ("Jeff Clement — Vacation: Hawaii"), the PDF header, and
// the iCal feed name. Set at registration; this lets the user fix typos.
// ---------------------------------------------------------------------------
function DisplayNameSection() {
  const me = useMe();
  const set = useSetDisplayName();
  const current = me.data?.display_name ?? "";
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);

  // Re-sync when the saved value lands (after an initial load or a save).
  if (current && draft === "" && current !== "") setDraft(current);

  const dirty = draft.trim() !== current && draft.trim().length > 0;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    set.mutate(draft.trim(), {
      onError: (err) => setError((err as Error).message),
    });
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-heading mb-1 flex items-center gap-2">
        <UserIcon className="w-4 h-4" aria-hidden="true" /> Your name
      </h2>
      <p className="text-xs text-subtle mb-3">
        How you show up in calendar invites, the PDF header, and (if you set up a manager) their
        inbox. Your username (<code className="font-mono">@{me.data?.username}</code>) is what you
        sign in with — separate.
      </p>
      <form onSubmit={save} className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="label" htmlFor="display-name-input">
            Display name
          </label>
          <input
            id="display-name-input"
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={100}
            placeholder="Jeff Clement"
            required
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary min-h-[40px]"
          disabled={!dirty || set.isPending}
        >
          {set.isPending ? "Saving…" : "Save"}
        </button>
      </form>
      {error && (
        <div role="alert" className="text-sm text-[color:var(--color-danger)] mt-2">
          {error}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Timezone — drives "current year" / accrual fraction / today defaults
// ---------------------------------------------------------------------------
function TimezoneSection() {
  const me = useMe();
  const set = useSetTimezone();
  const current = me.data?.timezone ?? "UTC";
  const [draft, setDraft] = useState(current);
  const [error, setError] = useState<string | null>(null);

  // Re-sync the draft if the saved value changes underneath us (e.g. after
  // a save round-trip).
  if (current && draft === "UTC" && current !== "UTC") setDraft(current);

  const browserTz = detectBrowserTimezone();
  const dirty = draft.trim() !== current;

  function save() {
    setError(null);
    set.mutate(draft.trim(), {
      onError: (e) => setError((e as Error).message),
    });
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-heading mb-1 flex items-center gap-2">
        <Globe className="w-4 h-4" /> Timezone
      </h2>
      <p className="text-xs text-subtle mb-3">
        Used for "what year is it?" on the dashboard and for accrual progress on accruing
        categories. IANA name (e.g. <code className="font-mono">{browserTz}</code>).
      </p>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="label">Timezone</label>
          <input
            className="input font-mono"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            list="afk-tz-list"
            placeholder="America/Vancouver"
          />
          <datalist id="afk-tz-list">
            {commonTimezones().map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </div>
        {browserTz !== current && (
          <button type="button" className="btn btn-secondary" onClick={() => setDraft(browserTz)}>
            Use browser ({browserTz})
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={!dirty || set.isPending}
        >
          Save
        </button>
      </div>
      {error && <div className="text-sm text-[color:var(--color-danger)] mt-2">{error}</div>}
    </section>
  );
}

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * `Intl.supportedValuesOf("timeZone")` is the right answer when available
 * (Node ≥18, modern browsers), but it returns ~600 zones — way too many for
 * a sensible dropdown. We just feed a curated short list into <datalist> for
 * autocomplete and let the input accept anything Intl will round-trip.
 */
function commonTimezones(): string[] {
  return [
    "UTC",
    "America/Vancouver",
    "America/Los_Angeles",
    "America/Denver",
    "America/Edmonton",
    "America/Chicago",
    "America/Toronto",
    "America/New_York",
    "America/Halifax",
    "America/St_Johns",
    "America/Sao_Paulo",
    "Europe/London",
    "Europe/Dublin",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Amsterdam",
    "Europe/Madrid",
    "Europe/Rome",
    "Europe/Stockholm",
    "Europe/Athens",
    "Africa/Cairo",
    "Africa/Johannesburg",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Bangkok",
    "Asia/Singapore",
    "Asia/Hong_Kong",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Australia/Perth",
    "Australia/Adelaide",
    "Australia/Sydney",
    "Pacific/Auckland",
  ];
}

// ---------------------------------------------------------------------------
// Email — drives outgoing calendar invites for vacation lifecycle events
// ---------------------------------------------------------------------------
function EmailSection() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const setEmail = useSetEmail();
  const resend = useResendEmailVerification();
  const clear = useClearEmail();
  const [draft, setDraft] = useState("");
  const [banner, setBanner] = useState<
    | { kind: "ok"; text: string }
    | { kind: "warn"; text: string }
    | { kind: "err"; text: string }
    | null
  >(null);

  const current = me.data?.email ?? null;
  const verified = !!me.data?.email_verified_at;

  // The /verify-email/:token redirect sends the user back here with a query
  // param — surface it as a banner. Setting state from a URL transition is
  // intentional (the rule's preferred remount-via-key pattern doesn't fit a
  // page-level banner that also reflects mutation results).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (search.email === "verified") {
      setBanner({ kind: "ok", text: "Email verified. You're all set." });
    } else if (search.email === "invalid") {
      setBanner({
        kind: "err",
        text: "That verification link was expired or invalid. Click 'Resend' below to get a new one.",
      });
    }
    if (search.email) {
      navigate({ search: {}, replace: true });
    }
  }, [search.email, navigate]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function save() {
    const email = draft.trim().toLowerCase();
    if (!email) return;
    setBanner(null);
    setEmail.mutate(email, {
      onSuccess: () => {
        setDraft("");
        setBanner({
          kind: "warn",
          text: `Verification email sent to ${email}. Click the link in your inbox to confirm — invites won't go out until then.`,
        });
      },
      onError: (e) => setBanner({ kind: "err", text: (e as Error).message }),
    });
  }

  function doResend() {
    setBanner(null);
    resend.mutate(undefined, {
      onSuccess: (data) =>
        setBanner({
          kind: "warn",
          text: `Verification email resent to ${data.email}.`,
        }),
      onError: (e) => setBanner({ kind: "err", text: (e as Error).message }),
    });
  }

  function doClear() {
    if (!confirm("Remove your email and stop receiving calendar invites?")) {
      return;
    }
    clear.mutate(undefined, {
      onSuccess: () => setBanner({ kind: "ok", text: "Email removed." }),
    });
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-heading mb-1 flex items-center gap-2">
        <Mail className="w-4 h-4" /> Email &amp; calendar invites
      </h2>
      <p className="text-xs text-subtle mb-3">
        We'll send you a calendar invite (.ics) for every vacation you book and a cancellation when
        you cancel one. Works with Outlook, Gmail, Apple Calendar — your client adds the event
        automatically.
      </p>

      {banner && (
        <div
          className={`text-sm mb-3 ${
            banner.kind === "ok"
              ? "text-[color:var(--color-success,#15803d)]"
              : banner.kind === "warn"
                ? "text-[color:var(--color-warning)]"
                : "text-[color:var(--color-danger)]"
          }`}
        >
          {banner.text}
        </div>
      )}

      {current ? (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-sm font-mono text-heading">{current}</span>
          {verified ? (
            <span className="pill" style={{ backgroundColor: "#16a34a" }}>
              verified
            </span>
          ) : (
            <span className="pill" style={{ backgroundColor: "#b45309" }}>
              pending
            </span>
          )}
          {!verified && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={doResend}
              disabled={resend.isPending}
            >
              Resend verification
            </button>
          )}
          <button
            type="button"
            className="p-1 rounded hover:bg-hover text-[color:var(--color-danger)]"
            onClick={doClear}
            aria-label="Remove email"
            title="Remove email"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="label">{current ? "Change email" : "Email address"}</label>
          <input
            className="input"
            type="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={setEmail.isPending || !draft.trim()}
        >
          {current ? "Update" : "Add email"}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Categories + allowances (combined for ergonomics)
// ---------------------------------------------------------------------------
function CategoriesSection({ year }: { year: number }) {
  const cats = useCategories();
  const allowances = useAllowances(year);
  const createCat = useCreateCategory();
  const updateCat = useUpdateCategory();
  const deleteCat = useDeleteCategory();
  const upsert = useUpsertAllowance(year);

  const [name, setName] = useState("");
  const [accrues, setAccrues] = useState(false);

  function add() {
    if (!name.trim()) return;
    createCat.mutate(
      { name: name.trim(), accrues },
      {
        onSuccess: () => setName(""),
      },
    );
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-heading mb-3">
        Categories &amp; allowances ({year})
      </h2>
      <p className="text-xs text-subtle mb-3">
        Everything is in days. Tick "accrues" if days_allotted is earned over the year (carryover is
        always available up front).
      </p>
      {cats.data && cats.data.length > 0 && (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-subtle">
              <tr>
                <th className="px-3 py-1 text-left">Name</th>
                <th className="px-3 py-1 text-left">Accrues</th>
                <th className="px-3 py-1 text-left">Allotted (d)</th>
                <th className="px-3 py-1 text-left">Carryover (d)</th>
                <th className="px-3 py-1 text-right">…</th>
              </tr>
            </thead>
            <tbody>
              {cats.data.map((c) => {
                const a = allowances.data?.find((al) => al.category_id === c.id) ?? null;
                return (
                  <CategoryRow
                    // Re-key when the allowance loads or its values change on
                    // the server: CategoryRow's input state seeds from props
                    // on mount only, so without a remount the rows stay
                    // showing the "0" they captured before allowances loaded.
                    key={`${c.id}:${a?.id ?? "pending"}:${a?.days_allotted ?? 0}:${a?.days_carryover ?? 0}`}
                    id={c.id}
                    name={c.name}
                    accrues={c.accrues}
                    color={c.color}
                    allotted={a?.days_allotted ?? 0}
                    carryover={a?.days_carryover ?? 0}
                    onSave={(allotted, carryover) =>
                      upsert.mutate({
                        category_id: c.id,
                        days_allotted: allotted,
                        days_carryover: carryover,
                      })
                    }
                    onToggleAccrues={(next) => updateCat.mutate({ id: c.id, accrues: next })}
                    onDelete={() => {
                      if (
                        confirm(
                          `Delete category "${c.name}"? Cancel its entries first if it has any.`,
                        )
                      )
                        deleteCat.mutate(c.id);
                    }}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[140px]">
          <label className="label">New category</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sick"
          />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={accrues} onChange={(e) => setAccrues(e.target.checked)} />
          Accrues
        </label>
        <button type="button" className="btn btn-primary" onClick={add}>
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>
      {createCat.isError && (
        <div className="text-sm text-[color:var(--color-danger)] mt-2">
          {(createCat.error as Error).message}
        </div>
      )}
    </section>
  );
}

interface RowProps {
  id: string;
  name: string;
  accrues: boolean;
  color: string;
  allotted: number;
  carryover: number;
  onSave: (allotted: number, carryover: number) => void;
  onToggleAccrues: (next: boolean) => void;
  onDelete: () => void;
}

function CategoryRow(p: RowProps) {
  const [allotted, setAllotted] = useState<string>(p.allotted.toString());
  const [carryover, setCarryover] = useState<string>(p.carryover.toString());
  const dirty = Number(allotted) !== p.allotted || Number(carryover) !== p.carryover;
  return (
    <tr className="border-t border-subtle">
      <td className="px-3 py-2">
        <span className="pill" style={{ backgroundColor: p.color }}>
          {p.name}
        </span>
      </td>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={p.accrues}
          onChange={(e) => p.onToggleAccrues(e.target.checked)}
          aria-label={`Toggle accrual for ${p.name}`}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min="0"
          step="0.25"
          className="input w-20"
          value={allotted}
          onChange={(e) => setAllotted(e.target.value)}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min="0"
          step="0.25"
          className="input w-20"
          value={carryover}
          onChange={(e) => setCarryover(e.target.value)}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex gap-1">
          {dirty && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => p.onSave(Number(allotted), Number(carryover))}
            >
              Save
            </button>
          )}
          <button
            type="button"
            className="p-1 rounded hover:bg-hover text-[color:var(--color-danger)]"
            onClick={p.onDelete}
            aria-label="Delete category"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------
function PasskeysSection() {
  const passkeys = usePasskeys();
  const me = useMe();
  const del = useDeletePasskey();
  const ren = useRenamePasskey();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPasskey() {
    setError(null);
    if (!me.data) return;
    setAdding(true);
    try {
      await registerPasskey({
        username: me.data.username,
        display_name: me.data.display_name,
        nickname: prompt("Nickname for this passkey?") || "Additional passkey",
      });
      await qc.invalidateQueries({ queryKey: ["passkeys"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-heading mb-3">Passkeys</h2>
      <div className="flex flex-col gap-2">
        {(passkeys.data ?? []).map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2 border-t border-subtle py-2 first:border-t-0 first:pt-0"
          >
            <KeyRound className="w-4 h-4 text-subtle shrink-0" />
            <div className="flex-1 min-w-0">
              <input
                className="input"
                defaultValue={p.nickname ?? ""}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== p.nickname) {
                    ren.mutate({ id: p.id, nickname: e.target.value.trim() });
                  }
                }}
              />
              <div className="text-[11px] text-muted mt-1">
                {p.device_type ?? "passkey"} · added {p.created_at.slice(0, 10)} ·{" "}
                {p.last_used_at ? `last used ${p.last_used_at.slice(0, 10)}` : "never used"}
              </div>
            </div>
            <button
              type="button"
              className="p-1 rounded hover:bg-hover text-[color:var(--color-danger)]"
              onClick={() => {
                if (confirm("Delete this passkey?")) del.mutate(p.id);
              }}
              aria-label="Delete passkey"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-secondary mt-3"
        onClick={addPasskey}
        disabled={adding}
      >
        <Plus className="w-4 h-4" />
        {adding ? "Registering…" : "Add another passkey"}
      </button>
      {error && <div className="text-sm text-[color:var(--color-danger)] mt-2">{error}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// iCal feeds
// ---------------------------------------------------------------------------
function ICalSection() {
  const tokens = useICalTokens();
  const create = useCreateICalToken();
  const del = useDeleteICalToken();
  const [copied, setCopied] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  function copy(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-heading mb-3">Calendar feeds (iCal)</h2>
      <p className="text-xs text-subtle mb-3">
        Mint a feed URL and paste it into Outlook, Google Calendar, or Apple Calendar. Public feeds
        expose only the public description; private feeds include internal notes and category names.
      </p>
      <div className="flex flex-col gap-2">
        {(tokens.data ?? []).map((t) => (
          <div
            key={t.id}
            className="border-t border-subtle py-2 first:border-t-0 first:pt-0 flex flex-col gap-1"
          >
            <div className="flex items-center gap-2">
              <span
                className="pill"
                style={{
                  backgroundColor: t.scope === "private" ? "#dc2626" : "#16a34a",
                }}
              >
                {t.scope}
              </span>
              <span className="text-sm">{t.label || "(unnamed)"}</span>
              <div className="flex-1" />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => copy(t.feed_url)}
                title={t.feed_url}
              >
                {copied === t.feed_url ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copied === t.feed_url ? "Copied" : "Copy URL"}
              </button>
              <button
                type="button"
                className="p-1 rounded hover:bg-hover text-[color:var(--color-danger)]"
                onClick={() => {
                  if (confirm("Revoke this feed? Subscribers will start 404ing.")) del.mutate(t.id);
                }}
                aria-label="Revoke feed"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[11px] text-muted font-mono truncate">{t.feed_url}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[140px]">
          <label className="label">Feed label</label>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. for manager"
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            create.mutate({ scope: "public", label }, { onSuccess: () => setLabel("") })
          }
          disabled={create.isPending}
        >
          <Plus className="w-4 h-4" />
          New public
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            create.mutate({ scope: "private", label }, { onSuccess: () => setLabel("") })
          }
          disabled={create.isPending}
        >
          <Plus className="w-4 h-4" />
          New private
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Share links — read-only dashboard URLs to hand out. Mirrors the iCal
// section's UX (label, mint, copy URL, revoke). Two scopes:
//   - current-year: locked to "today" in your timezone
//   - all-years: visitor can pivot through years
// ---------------------------------------------------------------------------
function ShareLinksSection() {
  const tokens = useShareTokens();
  const create = useCreateShareToken();
  const del = useDeleteShareToken();
  const [copied, setCopied] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  function copy(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  }

  function mint(scope: "current-year" | "all-years") {
    setError(null);
    create.mutate(
      { scope, label: label.trim() },
      {
        onSuccess: () => setLabel(""),
        onError: (e) => setError((e as Error).message),
      },
    );
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-heading mb-1 flex items-center gap-2">
        <Share2 className="w-4 h-4" aria-hidden="true" /> Share links
      </h2>
      <p className="text-xs text-subtle mb-3">
        Mint a read-only URL to send to your manager, spouse, or anyone else who wants visibility
        into your time off. They see balances and bookings — not your private notes, not the
        cancelled-and-restored history. Revoke any time.
      </p>

      <div className="flex flex-col gap-2">
        {(tokens.data ?? []).map((t) => (
          <div
            key={t.id}
            className="border-t border-subtle py-2 first:border-t-0 first:pt-0 flex flex-col gap-1"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="pill"
                style={{
                  backgroundColor: t.scope === "all-years" ? "#7c3aed" : "#0891b2",
                }}
                title={
                  t.scope === "all-years"
                    ? "Visitor can pivot through every year"
                    : "Locked to whatever year is current when they open it"
                }
              >
                {t.scope === "all-years" ? "All years" : "Current year"}
              </span>
              <span className="text-sm">{t.label || "(unnamed)"}</span>
              <div className="flex-1" />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => copy(t.share_url)}
                title={t.share_url}
              >
                {copied === t.share_url ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copied === t.share_url ? "Copied" : "Copy URL"}
              </button>
              <button
                type="button"
                className="p-1 rounded hover:bg-hover text-[color:var(--color-danger)]"
                onClick={() => {
                  if (confirm("Revoke this share link? Whoever has it will start seeing a 404.")) {
                    del.mutate(t.id);
                  }
                }}
                aria-label="Revoke share link"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {t.last_viewed_at && (
              <div className="text-[11px] text-muted">
                Last viewed {t.last_viewed_at.slice(0, 10)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[160px]">
          <label className="label">Link label</label>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. for Sarah, for HR"
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => mint("current-year")}
          disabled={create.isPending}
        >
          <Plus className="w-4 h-4" />
          New (current year)
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => mint("all-years")}
          disabled={create.isPending}
        >
          <Plus className="w-4 h-4" />
          New (all years)
        </button>
      </div>
      {error && (
        <div role="alert" className="text-sm text-[color:var(--color-danger)] mt-2">
          {error}
        </div>
      )}
    </section>
  );
}
