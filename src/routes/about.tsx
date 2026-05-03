/**
 * About / privacy page — accessible from the footer regardless of auth state.
 * Spells out the (lack of) guarantees, points at the contact page, and
 * explains what we store and why.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="max-w-2xl w-full mx-auto px-3 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-heading">About AFK</h1>

      <section className="card p-4 flex flex-col gap-2 text-sm">
        <p>
          AFK (Away From Keyboard) is a vacation tracker I built to scratch my own itch and left
          open for anyone who finds it useful. It's a hobby project, not a SaaS.
        </p>
        <p>
          Anyone can sign up. Each account is fully isolated — your categories, allowances,
          vacations, and calendar feeds belong to you and only you.
        </p>
        <p>
          For contact, source, or anything else,{" "}
          <a
            href="https://owg.me"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-heading"
          >
            owg.me
          </a>{" "}
          is the place.
        </p>
      </section>

      <section className="card p-4 flex flex-col gap-2 text-sm">
        <h2 className="text-sm font-semibold text-heading">Boss / approver (optional)</h2>
        <p>You can add a boss or approver email in Settings. Two modes:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-heading">Notify</strong> — they get a calendar invite for every
            vacation you book. No approval gate. Honour-system; great for managers who just want
            visibility.
          </li>
          <li>
            <strong className="text-heading">Requires approval</strong> — your booking enters as{" "}
            <em>pending</em> on your calendar. Your boss gets a one-click link to approve or reject.
            Calendar invites only fire on approval. Rejection cancels the booking and emails the
            comment back to you.
          </li>
        </ul>
        <p>
          The boss doesn't need an AFK account. They consent once via a verification email, and can
          opt out by replying to any email and asking you to remove them. You can remove them
          yourself at any time from Settings.
        </p>
        <p>
          The whole feature is optional and off by default. Email/calendar invites only fire when
          you've verified your own email AND added a boss who consented.
        </p>
      </section>

      <section className="card p-4 flex flex-col gap-2 text-sm">
        <h2 className="text-sm font-semibold text-heading">No guarantees</h2>
        <p>This is not a mission-critical, production-grade application. Use at your own risk.</p>
        <p>
          I'll do my best to keep the data safe — it's my own data too — but I make no promises that
          it won't be lost, leaked, corrupted, or accidentally vacuumed up by a misbehaving
          migration. Mistakes happen.
        </p>
        <p>
          If your job, your sanity, or your annual review depends on these numbers, please keep your
          own copy somewhere too. The PDF export and the iCal feeds exist partly for that reason.
        </p>
      </section>

      <section className="card p-4 flex flex-col gap-2 text-sm">
        <h2 className="text-sm font-semibold text-heading">What's stored</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Your username, display name, and the passkeys you register.</li>
          <li>
            The vacation categories, allowances, and entries you create — start and end dates,
            optional descriptions, and the category they belong to.
          </li>
          <li>
            Session cookies and short-lived auth challenges, kept just long enough to log you in and
            out.
          </li>
          <li>
            iCal feed tokens you opt into. Public feeds expose only the public description; private
            feeds expose internal notes and category names.
          </li>
        </ul>
        <p>
          Everything lives in a Cloudflare D1 database in the worker's home region. No third-party
          analytics, no ad networks, no tracking pixels.
        </p>
      </section>
    </div>
  );
}
