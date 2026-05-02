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
          AFK (Away From Keyboard) is a personal vacation tracker built for one
          person — me — and shared with anyone who finds it useful. It's a
          hobby project, not a SaaS.
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
        <h2 className="text-sm font-semibold text-heading">No guarantees</h2>
        <p>
          This is not a mission-critical, production-grade application. Use at
          your own risk.
        </p>
        <p>
          I'll do my best to keep the data safe — it's my own data too — but I
          make no promises that it won't be lost, leaked, corrupted, or
          accidentally vacuumed up by a misbehaving migration. Mistakes happen.
        </p>
        <p>
          If your job, your sanity, or your annual review depends on these
          numbers, please keep your own copy somewhere too. The PDF export and
          the iCal feeds exist partly for that reason.
        </p>
      </section>

      <section className="card p-4 flex flex-col gap-2 text-sm">
        <h2 className="text-sm font-semibold text-heading">What's stored</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Your username, display name, and the passkeys you register.</li>
          <li>
            The vacation categories, allowances, and entries you create — start
            and end dates, optional descriptions, and the category they belong
            to.
          </li>
          <li>
            Session cookies and short-lived auth challenges, kept just long
            enough to log you in and out.
          </li>
          <li>
            iCal feed tokens you opt into. Public feeds expose only the public
            description; private feeds expose internal notes and category names.
          </li>
        </ul>
        <p>
          Everything lives in a Cloudflare D1 database in the worker's home
          region. No third-party analytics, no ad networks, no tracking
          pixels.
        </p>
      </section>
    </div>
  );
}
