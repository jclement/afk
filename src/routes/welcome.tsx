/**
 * Marketing landing page for unauthenticated visitors. Hero, features,
 * dual CTA. Public route — no auth required, no redirect away. The root
 * component sends signed-out visitors here instead of straight to /login,
 * and signed-in visitors get bounced to / if they wander in.
 */

import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  CalendarCheck,
  FileDown,
  KeyRound,
  Mail,
  Repeat,
  Rss,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { pickTagline } from "@shared/taglines";

export const Route = createFileRoute("/welcome")({
  component: WelcomePage,
});

function WelcomePage() {
  return (
    <div className="flex-1 flex flex-col">
      <Hero />
      <Features />
      <Workflow />
      <FinalCta />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Soft gradient backdrop, theme-aware */}
      <div
        className="absolute inset-0 -z-10 opacity-90"
        style={{
          background:
            "radial-gradient(ellipse at top left, color-mix(in srgb, var(--color-primary) 18%, transparent), transparent 60%), radial-gradient(ellipse at bottom right, color-mix(in srgb, var(--color-success) 14%, transparent), transparent 55%)",
        }}
      />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-subtle bg-surface text-xs text-subtle mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-success)]" />
          Free, multi-user, passkey-only
        </div>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-heading">
          Vacation tracking that{" "}
          <span className="text-[color:var(--color-primary)]">gets out of your way</span>.
        </h1>
        <p className="mt-5 text-base sm:text-lg text-subtle max-w-2xl mx-auto">
          AFK is a small, opinionated tool for tracking how much time off you've
          actually taken. Days only, no spreadsheets, no HR portals, no logins
          to forget. Sign in with a passkey, book a vacation, get the calendar
          invite in your inbox. Done.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <Link to="/setup" className="btn btn-primary text-sm px-4 py-2">
            <ShieldCheck className="w-4 h-4" />
            Create your account
          </Link>
          <Link to="/login" className="btn btn-secondary text-sm px-4 py-2">
            <KeyRound className="w-4 h-4" />
            Sign in
          </Link>
        </div>
        <p className="mt-6 text-xs text-muted italic">
          {pickTagline("welcome-hero")}
        </p>
      </div>
    </section>
  );
}

interface FeatureCard {
  icon: typeof CalendarDays;
  title: string;
  body: string;
}

const FEATURES: FeatureCard[] = [
  {
    icon: CalendarDays,
    title: "Categories that match how you actually accrue",
    body:
      "Vacation, Flex, Sick — make as many buckets as you like. Mark a category as 'accrues' and it earns through the year, with a subtle warning if you book before you've banked it.",
  },
  {
    icon: Mail,
    title: "Calendar invites straight to your inbox",
    body:
      "Add a verified email and every booking arrives as a real .ics — Outlook, Gmail, Apple Calendar all add the OOO event automatically. Cancel a vacation and the calendar event vanishes too.",
  },
  {
    icon: Rss,
    title: "iCal feeds for the people who care",
    body:
      "Mint a private feed for your boss or a public one for the team. Subscribe in any calendar app — your time off shows up next to their meetings, no manual updates.",
  },
  {
    icon: FileDown,
    title: "Year-summary PDF, instantly",
    body:
      "One click and you've got a printable per-year breakdown of what you took, when, and how much is left — tidy enough to forward to HR or staple to a fridge.",
  },
  {
    icon: KeyRound,
    title: "Passkeys, not passwords",
    body:
      "Sign in with whatever your device already has — Face ID, Touch ID, Windows Hello. No passwords to forget, leak, or rotate.",
  },
  {
    icon: Repeat,
    title: "Edit, cancel, restore",
    body:
      "Plans change. Cancel a vacation if it falls through, restore it if it comes back, edit dates without losing your audit trail.",
  },
];

function Features() {
  return (
    <section className="py-12 sm:py-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <div className="text-xs uppercase tracking-widest text-muted">
            What you get
          </div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-heading mt-2">
            The features you'd build yourself, already built.
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="card p-5 flex flex-col gap-2 hover:bg-[color:var(--color-hover)] transition"
              >
                <div className="w-9 h-9 rounded-lg bg-[color:var(--color-selected)] text-[color:var(--color-primary)] flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="text-sm font-semibold text-heading">{f.title}</div>
                <div className="text-sm text-subtle leading-relaxed">{f.body}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Workflow() {
  const steps = [
    {
      icon: ShieldCheck,
      title: "Sign up with a passkey",
      body: "30 seconds. Pick a username, register the passkey on whatever device you're holding, you're in.",
    },
    {
      icon: CalendarCheck,
      title: "Book your time off",
      body:
        "Pick a date range, optional category, optional half-day. The dashboard shows exactly how much is left.",
    },
    {
      icon: TrendingUp,
      title: "Stay on top of accrual",
      body:
        "Widgets show used / available / total at a glance. The bar fills up; when you cross the accrual line, you'll see it.",
    },
  ];
  return (
    <section className="py-12 sm:py-16 bg-[color:var(--color-surface)] border-y border-subtle">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <div className="text-xs uppercase tracking-widest text-muted">
            How it works
          </div>
          <h2 className="text-2xl sm:text-3xl font-semibold text-heading mt-2">
            Three steps, no spreadsheet.
          </h2>
        </div>
        <ol className="grid sm:grid-cols-3 gap-4">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.title} className="card p-5 flex flex-col gap-2 relative">
                <div className="absolute top-3 right-4 text-[11px] font-mono text-muted">
                  0{i + 1}
                </div>
                <div className="w-9 h-9 rounded-lg bg-[color:var(--color-selected)] text-[color:var(--color-primary)] flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="text-sm font-semibold text-heading">{s.title}</div>
                <div className="text-sm text-subtle leading-relaxed">{s.body}</div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="py-14 sm:py-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="text-2xl sm:text-3xl font-semibold text-heading">
          Ready to find out how much vacation you actually have?
        </h2>
        <p className="mt-3 text-sm text-subtle max-w-xl mx-auto">
          AFK is a hobby project, not a SaaS. Free, no upsells, your data is
          isolated to your account. The fine print is on{" "}
          <Link to="/about" className="underline hover:text-heading">
            the about page
          </Link>
          .
        </p>
        <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
          <Link to="/setup" className="btn btn-primary text-sm px-4 py-2">
            Create your account
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link to="/login" className="btn btn-secondary text-sm px-4 py-2">
            <KeyRound className="w-4 h-4" />
            I already have one
          </Link>
        </div>
      </div>
    </section>
  );
}
