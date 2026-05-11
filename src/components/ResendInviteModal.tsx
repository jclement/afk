/**
 * "Resend invite" modal. Lets the user replay the calendar invite for a
 * vacation to themselves, their manager, or both. Built for the
 * "manager-says-they-didn't-get-it" support case: notify-mode emails fire
 * via waitUntil and any Mailgun failure used to disappear into stdout,
 * so users had no recovery path short of editing the vacation.
 *
 * Shows the per-vacation email log underneath the picker — when the last
 * send to the manager has an `error` set, render the message inline so
 * the user knows whether the resend will likely help.
 */

import { useMemo, useState } from "react";
import { Mail, AlertCircle, CheckCircle2, RotateCw } from "lucide-react";
import { Modal } from "./Modal";
import {
  useBoss,
  useResendVacationEmail,
  useVacationEmailLog,
  type VacationEmailResendResult,
} from "../api/hooks";
import type { Vacation, VacationEmailLog } from "@shared/types";

interface Props {
  open: boolean;
  vacation: Vacation | null;
  onClose: () => void;
}

type Target = "self" | "boss" | "both";

export function ResendInviteModal({ open, vacation, onClose }: Props) {
  const vacationId = vacation?.id ?? null;
  const boss = useBoss();
  const log = useVacationEmailLog(open ? vacationId : null);
  const resend = useResendVacationEmail();

  const hasConsentedBoss = boss.data?.consent_status === "consented";
  const defaultTarget: Target = hasConsentedBoss ? "boss" : "self";
  const [target, setTarget] = useState<Target>(defaultTarget);
  const [lastResults, setLastResults] = useState<VacationEmailResendResult[] | null>(null);

  // The "last sent" lines under the picker — derived from the log query.
  // Keys are recipient strings so we render at most one line each.
  const lastByRecipient = useMemo(() => {
    const map = new Map<VacationEmailLog["recipient"], VacationEmailLog>();
    for (const row of log.data ?? []) {
      if (!map.has(row.recipient)) map.set(row.recipient, row);
    }
    return map;
  }, [log.data]);

  function handleClose() {
    setLastResults(null);
    resend.reset();
    onClose();
  }

  async function handleSend() {
    if (!vacationId) return;
    try {
      const result = await resend.mutateAsync({ id: vacationId, to: target });
      setLastResults(result.results);
    } catch {
      // useMutation captures the error on resend.error; nothing else to do.
    }
  }

  // Disable the boss/both options when no consented manager exists. Show
  // why in the help text below.
  const bossDisabled = !hasConsentedBoss;
  const bossDisabledReason = boss.data
    ? boss.data.consent_status === "pending"
      ? "Your manager hasn't accepted the consent email yet."
      : "Your manager unsubscribed — add a new manager from Settings."
    : "You don't have a manager configured.";

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Resend invite"
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={handleClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSend}
            disabled={resend.isPending || (target !== "self" && bossDisabled)}
          >
            <RotateCw className={`w-4 h-4 ${resend.isPending ? "animate-spin" : ""}`} />
            {resend.isPending ? "Sending..." : "Resend now"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-subtle">
          If the calendar invite never arrived — spam filter, corporate email gateway, or a Mailgun
          blip — replay it without editing the booking.
        </p>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs uppercase tracking-wide text-subtle mb-1">Send to</legend>
          <RadioRow
            checked={target === "self"}
            onChange={() => setTarget("self")}
            label="Just me"
            sub="Copy the invite back to your own inbox to verify it looks right."
          />
          <RadioRow
            checked={target === "boss"}
            onChange={() => setTarget("boss")}
            label="My manager"
            sub={
              bossDisabled
                ? bossDisabledReason
                : `Send to ${boss.data?.boss_email ?? "your manager"}.`
            }
            disabled={bossDisabled}
          />
          <RadioRow
            checked={target === "both"}
            onChange={() => setTarget("both")}
            label="Both"
            sub="Send to both inboxes — useful for double-checking content."
            disabled={bossDisabled}
          />
        </fieldset>

        {/* Send results — appears after the mutation resolves. */}
        {lastResults && (
          <div className="flex flex-col gap-1 rounded border border-subtle bg-surface p-3 text-sm">
            <div className="text-xs uppercase tracking-wide text-subtle">Result</div>
            {lastResults.map((r, i) => (
              <ResultLine key={i} result={r} bossEmail={boss.data?.boss_email ?? null} />
            ))}
          </div>
        )}
        {resend.isError && (
          <div className="rounded border border-[color:var(--color-danger)] bg-surface p-3 text-sm text-[color:var(--color-danger)] flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{(resend.error as Error).message}</span>
          </div>
        )}

        {/* Audit trail — last-send-per-recipient lines. */}
        <div className="flex flex-col gap-1">
          <div className="text-xs uppercase tracking-wide text-subtle">Recent sends</div>
          {log.isLoading && <div className="text-xs text-muted">Loading…</div>}
          {log.data && log.data.length === 0 && (
            <div className="text-xs text-muted italic">
              No sends recorded yet. The original create-time invite predates this audit log.
            </div>
          )}
          {(["self", "boss"] as const).map((r) => {
            const last = lastByRecipient.get(r);
            if (!last) return null;
            return <LogLine key={r} entry={last} bossEmail={boss.data?.boss_email ?? null} />;
          })}
        </div>
      </div>
    </Modal>
  );
}

function RadioRow(props: {
  checked: boolean;
  onChange: () => void;
  label: string;
  sub: string;
  disabled?: boolean;
}) {
  const { checked, onChange, label, sub, disabled } = props;
  return (
    <label
      className={`flex items-start gap-2 rounded border p-2 cursor-pointer ${
        checked ? "border-[color:var(--color-brand)]" : "border-subtle"
      } ${disabled ? "opacity-60 cursor-not-allowed" : "hover:bg-hover"}`}
    >
      <input
        type="radio"
        name="resend-target"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-1"
      />
      <div className="flex-1">
        <div className="text-sm font-semibold text-heading">{label}</div>
        <div className="text-xs text-subtle">{sub}</div>
      </div>
    </label>
  );
}

function ResultLine({
  result,
  bossEmail,
}: {
  result: VacationEmailResendResult;
  bossEmail: string | null;
}) {
  const recipientLabel = result.recipient === "self" ? "You" : (bossEmail ?? "Manager");
  if (result.skipped) {
    return (
      <div className="flex items-center gap-2 text-xs text-subtle">
        <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
        <span>
          {recipientLabel}: skipped
          {result.skip_reason === "no_user_email" ? " (verify your email first)" : ""}.
        </span>
      </div>
    );
  }
  if (result.error) {
    return (
      <div className="flex items-center gap-2 text-xs text-[color:var(--color-danger)]">
        <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
        <span>
          {recipientLabel}: failed — {result.error}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-subtle">
      <CheckCircle2 className="w-3.5 h-3.5 text-[color:var(--color-success)]" aria-hidden="true" />
      <span>{recipientLabel}: sent.</span>
    </div>
  );
}

function LogLine({ entry, bossEmail }: { entry: VacationEmailLog; bossEmail: string | null }) {
  const recipientLabel = entry.recipient === "self" ? "You" : (bossEmail ?? "Manager");
  const when = formatRelative(entry.sent_at);
  const failed = !!entry.error;
  return (
    <div className="flex items-start gap-2 text-xs">
      {failed ? (
        <AlertCircle
          className="w-3.5 h-3.5 mt-0.5 text-[color:var(--color-danger)]"
          aria-hidden="true"
        />
      ) : (
        <Mail className="w-3.5 h-3.5 mt-0.5 text-subtle" aria-hidden="true" />
      )}
      <div className="flex-1">
        <span className="text-subtle">
          {recipientLabel}: {failed ? "last attempt failed" : "last sent"} {when}
          {entry.resend ? " (manual resend)" : ""}.
        </span>
        {failed && entry.error && (
          <div className="text-[11px] text-[color:var(--color-danger)] mt-0.5 break-words">
            {entry.error}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Lightweight relative time formatter — "2m ago", "5h ago", "3d ago", or
 * the ISO date for anything older than a week. We intentionally avoid
 * `Intl.RelativeTimeFormat` here because the modal stays open while the
 * user reads it and we don't need live-updating precision.
 */
function formatRelative(stamp: string): string {
  // SQLite emits `YYYY-MM-DD HH:MM:SS` (UTC, no Z). Normalise to ISO so
  // the Date constructor parses it correctly across browsers — Safari is
  // strict about the `T` separator and the trailing `Z`.
  const iso = stamp.includes("T") ? stamp : stamp.replace(" ", "T") + "Z";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return stamp;
  const ms = Date.now() - t;
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d}d ago`;
  return stamp.slice(0, 10);
}
