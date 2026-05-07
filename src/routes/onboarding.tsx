/**
 * First-run wizard. Shown to any user whose `welcome_completed_at` is null —
 * new accounts AND existing users from before the wizard existed. The
 * "Save your recovery codes" step is the only mandatory one; everything
 * else is a quick tour.
 *
 * Route guard: `__root.tsx` redirects anyone signed-in with a null
 * `welcome_completed_at` to /onboarding when they hit `/`. They can still
 * navigate to /settings, /about, /share/, etc. without being trapped.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  Check,
  KeyRound,
  LifeBuoy,
  Mail,
  PartyPopper,
  Rss,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { useMarkWelcomeCompleted, useMe, useRegenerateRecoveryCodes } from "../api/hooks";
import { RecoveryCodesModal } from "./settings";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});

interface StepDef {
  key: string;
  title: string;
  body: React.ReactNode;
  icon: typeof CalendarDays;
}

function OnboardingPage() {
  const me = useMe();
  const [step, setStep] = useState(0);
  // The recovery step is the only mandatory one; it lifts state up here so
  // the Next button can be disabled until the user ticks "I've saved them."
  const [recoveryDone, setRecoveryDone] = useState(false);

  const steps: StepDef[] = [
    {
      key: "welcome",
      title: "Welcome to AFK",
      icon: ShieldCheck,
      body: (
        <>
          <p className="text-sm text-subtle leading-relaxed">
            AFK tracks how much time off you've actually taken. No spreadsheets, no HR portals, no
            passwords to forget. {me.data?.display_name ? `Hi ${me.data.display_name} — ` : ""}
            this is a quick tour, two minutes tops, then we'll set you up with backup codes so a
            lost device doesn't lock you out.
          </p>
        </>
      ),
    },
    {
      key: "categories",
      title: "Categories: how your buckets work",
      icon: CalendarDays,
      body: (
        <>
          <p className="text-sm text-subtle leading-relaxed">
            You'll start with two categories — <strong>Vacation</strong> (accrues throughout the
            year) and <strong>Flex</strong> (full balance day one). Add or rename them in Settings.
            Mark a category as <em>accruing</em> and the dashboard will subtly warn you if you book
            before you've banked it.
          </p>
        </>
      ),
    },
    {
      key: "vacations",
      title: "Booking, cancelling, partial days",
      icon: CalendarCheck,
      body: (
        <>
          <p className="text-sm text-subtle leading-relaxed">
            Click <strong>Book vacation</strong> on the dashboard. Pick a range, optional category,
            optional half-day. The widgets show used / available / total at a glance. Plans change?
            Cancel a vacation to hide it without losing the audit trail; restore later if it comes
            back.
          </p>
        </>
      ),
    },
    {
      key: "feeds",
      title: "Calendar feeds and read-only share links",
      icon: Rss,
      body: (
        <>
          <p className="text-sm text-subtle leading-relaxed">
            From Settings you can mint <strong>iCal feeds</strong> (subscribe in Outlook / Apple
            Calendar / Google) and <strong>share links</strong> (a read-only dashboard you can send
            to your manager or partner). For your privacy, the URLs are shown
            <strong> once at creation</strong> — copy and save them. Lose one? Delete and recreate.
          </p>
        </>
      ),
    },
    {
      key: "boss",
      title: "Optional: loop in your manager",
      icon: Mail,
      body: (
        <>
          <p className="text-sm text-subtle leading-relaxed">
            In Settings → Manager, add a manager's email address. Two modes:
          </p>
          <ul className="text-sm text-subtle list-disc pl-5 mt-2 space-y-1">
            <li>
              <strong>Notify</strong> — your manager gets a calendar invite when you book or cancel.
            </li>
            <li>
              <strong>Approval</strong> — your manager has to click an Approve / Reject link;
              vacations stay tentative until they decide.
            </li>
          </ul>
          <p className="text-sm text-subtle leading-relaxed mt-2">
            Skippable — most users don't need it.
          </p>
        </>
      ),
    },
    {
      key: "recovery",
      title: "Save your recovery codes",
      icon: LifeBuoy,
      body: <RecoveryStep onAcknowledgedChange={setRecoveryDone} />,
    },
    {
      key: "done",
      title: "You're all set",
      icon: PartyPopper,
      body: <DoneStep />,
    },
  ];

  const isLast = step === steps.length - 1;
  const current = steps[step]!;
  const Icon = current.icon;

  return (
    <div className="flex-1 flex items-center justify-center px-3 sm:px-6 py-6">
      <div className="card w-full max-w-2xl p-5 sm:p-7 flex flex-col gap-5">
        <ProgressDots count={steps.length} current={step} />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[color:var(--color-selected)] text-[color:var(--color-primary)] flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
          <h1 className="text-lg sm:text-xl font-semibold text-heading">{current.title}</h1>
        </div>
        <div className="min-h-[140px]">{current.body}</div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-subtle">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          {!isLast && (
            <div className="flex items-center gap-2">
              {current.key === "recovery" && !recoveryDone && (
                <span className="text-[11px] text-muted hidden sm:inline">
                  Generate and save your codes to continue
                </span>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
                disabled={current.key === "recovery" && !recoveryDone}
              >
                Next
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressDots({ count, current }: { count: number; current: number }) {
  return (
    <div className="flex items-center justify-center gap-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={
            "h-1.5 rounded-full transition-all " +
            (i === current
              ? "w-8 bg-[color:var(--color-primary)]"
              : i < current
                ? "w-2 bg-[color:var(--color-primary)] opacity-50"
                : "w-2 bg-[color:var(--color-hover)]")
          }
        />
      ))}
    </div>
  );
}

/**
 * The mandatory step. Calls `useRegenerateRecoveryCodes` once when the user
 * clicks Generate (lazy — the codes aren't minted until they ask). The
 * "I've saved them" checkbox unlocks the parent's Next button via the
 * `onAcknowledgedChange` callback.
 */
function RecoveryStep({ onAcknowledgedChange }: { onAcknowledgedChange: (ack: boolean) => void }) {
  const regen = useRegenerateRecoveryCodes();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  function generate() {
    setError(null);
    regen.mutate(undefined, {
      onSuccess: (data) => {
        setCodes(data.codes);
        setModalOpen(true);
      },
      onError: (e) => setError((e as Error).message),
    });
  }

  function toggleAck(next: boolean) {
    setAcknowledged(next);
    onAcknowledgedChange(next && codes !== null);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-subtle leading-relaxed">
        Passkeys are great until you've lost every device with one. Recovery codes are the escape
        hatch: 10 typeable one-time codes that work like a passkey for that one login. Save them
        somewhere offline — a password manager, a printed sheet in a drawer.
      </p>

      {!codes && (
        <button
          type="button"
          className="btn btn-primary self-start"
          onClick={generate}
          disabled={regen.isPending}
        >
          <KeyRound className="w-4 h-4" />
          {regen.isPending ? "Generating…" : "Generate my 10 recovery codes"}
        </button>
      )}

      {codes && !modalOpen && (
        <div
          className="rounded border p-3 flex items-start gap-2 text-xs"
          style={{
            borderColor: "var(--color-success)",
            background: "color-mix(in srgb, var(--color-success) 12%, transparent)",
          }}
        >
          <Check
            className="w-4 h-4 mt-0.5 text-[color:var(--color-success)] shrink-0"
            aria-hidden="true"
          />
          <div className="text-subtle">
            Codes generated.{" "}
            <button
              type="button"
              className="underline text-heading"
              onClick={() => setModalOpen(true)}
            >
              Show again
            </button>{" "}
            (you can re-open this modal until you click Next).
          </div>
        </div>
      )}

      {codes && (
        <label className="flex items-start gap-2 text-sm text-subtle mt-1 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => toggleAck(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I've saved my recovery codes somewhere I can find them later. They won't be shown again.
          </span>
        </label>
      )}

      {error && (
        <div role="alert" className="text-sm text-[color:var(--color-danger)]">
          {error}
        </div>
      )}

      <RecoveryCodesModal
        codes={modalOpen ? codes : null}
        onClose={() => setModalOpen(false)}
        dismissLabel="Got it"
      />
    </div>
  );
}

function DoneStep() {
  const navigate = useNavigate();
  const mark = useMarkWelcomeCompleted();
  const [error, setError] = useState<string | null>(null);

  function finish() {
    setError(null);
    mark.mutate(undefined, {
      onSuccess: () => navigate({ to: "/" }),
      onError: (e) => setError((e as Error).message),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-subtle leading-relaxed">
        That's the tour. The dashboard is where you'll spend most of your time; everything else
        lives in <strong>Settings</strong>. If you ever want a refresher, the{" "}
        <a className="underline" href="/about">
          About page
        </a>{" "}
        has the long form.
      </p>
      <p className="text-sm text-subtle leading-relaxed">A few quick wins for day one:</p>
      <ul className="text-sm text-subtle list-disc pl-5 space-y-1">
        <li>Set this year's allowance in Settings → Categories.</li>
        <li>Verify your email so AFK can mail you calendar invites.</li>
        <li>Add a passkey on a second device while you're thinking about it.</li>
      </ul>
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={finish}
          disabled={mark.isPending}
        >
          <TrendingUp className="w-4 h-4" />
          {mark.isPending ? "Saving…" : "Go to dashboard"}
        </button>
      </div>
      {error && (
        <div role="alert" className="text-sm text-[color:var(--color-danger)]">
          {error}
        </div>
      )}
    </div>
  );
}
