# AFK — Design & Architecture

## Overview

AFK is a single-tenant vacation tracker deployed as a single Cloudflare Worker. The same Worker
serves the API, the React SPA, and the iCal feeds. Local state lives in D1 (SQLite at the edge).
Passkey challenges live in KV with a TTL. PDFs are rendered via the Browser Rendering binding.

The app is opinionated: you, you only, your vacation, your sarcasm. Anyone landing on a fresh
deployment can register the first user (and only the first user) — after that, registration is
locked and only adding additional passkeys to your own account is allowed.

## Architecture

```
                 +-------------------- Cloudflare edge ---------------------+
                 |                                                          |
  Browser  --->  |  Worker (Hono)                                           |
                 |   ├── /api/v1/* ── auth, categories, vacations, ical,    |
                 |   │                pdf, passkeys, health                 |
                 |   ├── /ical/:tok ── public-facing iCal feeds             |
                 |   └── ASSETS    ── React SPA (Vite build)                |
                 |        │                                                 |
                 |        ├── D1 (DB)        users, sessions, categories,   |
                 |        │                  allowances, vacations,         |
                 |        │                  credentials, ical_tokens       |
                 |        ├── KV (KV)        WebAuthn challenges (5m TTL)   |
                 |        └── Browser        Headless Chrome for PDF        |
                 +----------------------------------------------------------+
```

In dev, Vite's dev server runs the SPA with HMR and the `@cloudflare/vite-plugin` runs the Worker
inside Workerd in the same process. Workers bindings are declared in `wrangler.toml` and the dev
server points at local D1/KV via Miniflare under the hood.

## Project Structure

```
worker/
  index.ts                — Hono app entry, secure-headers, route mounting
  types.ts                — Env binding types
  lib/
    auth.ts               — requireAuth middleware + SUPPRESS_AUTH support
    sessions.ts           — server-side session CRUD + cookie helpers
    users.ts              — user upsert, dev-user bootstrap
    passkeys.ts           — SimpleWebAuthn flows (start/finish for both reg + auth)
    store.ts              — categories, allowances, vacations, iCal tokens, credentials
    responses.ts          — `ok` / `err` JSON envelope helpers
    ids.ts                — UUID + token generators, constant-time comparison
    print-template.ts     — server-rendered HTML for PDF export
  routes/
    auth.ts               — register/login/logout + status
    categories.ts         — categories + allowances
    vacations.ts          — entries + year summary
    passkeys.ts           — list/rename/delete passkeys
    ical.ts               — feed tokens (auth) + public feed routes (no auth)
    pdf.ts                — Browser Rendering invocation
  test-utils.ts           — applyMigrations, createTestSession, authedFetch helpers
  *.test.ts               — Vitest integration tests in the Workers pool

shared/
  types.ts                — types shared between worker and frontend
  vacation-math.ts        — pure functions for accounting (heavily unit-tested)
  colors.ts               — category palette + stable-color picker
  taglines.ts             — 200+ sarcastic one-liners

src/                      — React SPA
  main.tsx                — entry, QueryClient, RouterProvider
  app.css                 — Tailwind v4 theme + utility classes + components
  api/hooks.ts            — TanStack Query hooks for every endpoint
  lib/
    api.ts                — fetch wrapper + APIError class
    passkey-client.ts     — browser-side WebAuthn flows
    theme.ts              — system/light/dark cycle
  routes/                 — TanStack Router file-based routes
    __root.tsx            — auth-redirect logic + app shell
    index.tsx             — dashboard (year picker, widgets, list)
    login.tsx             — passkey sign-in
    setup.tsx             — first-run setup
    settings.tsx          — categories, passkeys, iCal feeds
  components/             — Header, Modal, BookingModal, CategoryWidget, VacationList

migrations/0001_initial.sql  — schema (run by Wrangler in CI, by helpers in tests)
```

## Key Design Decisions

1. **Single Worker, single binary.** No separate API + frontend. The Worker serves both, which
   means same-origin (no CORS), one deploy, and the React app can talk to `/api/v1` without
   thinking. The Cloudflare Vite plugin makes this as ergonomic in dev as in prod.

2. **D1 for everything except WebAuthn challenges.** Sessions, categories, and vacations all
   benefit from durable, queryable storage. WebAuthn challenges are _intrinsically_ short-lived
   (5 min) and tied to a one-shot flow id, so KV's TTL fits perfectly and we get automatic GC.

3. **Server-side sessions, not JWTs.** The cookie carries a token; the row in `sessions` is the
   source of truth. Logout revokes instantly. No "token blacklists" to maintain.

4. **One user, but a real user model.** "Personal" doesn't mean "skip auth". Categories and
   vacations are scoped by `user_id` so an IDOR test (see `vacations.test.ts`) can prove
   isolation. If two people ever share a deployment, they're isolated by default.

5. **Days are the unit of accounting.** Categories _display_ in either days or weeks (1 week =
   5 business days). Allowances and used totals are stored in days. The conversion lives in
   `shared/vacation-math.ts` so the worker, the React app, and the PDF template all agree.

6. **Three vacation shapes.** Multi-day full, single full, single partial. Anything else is
   rejected at the API layer (`validateVacationShape`). This keeps the math simple and the UI
   honest.

7. **iCal scopes.** The `private` token reveals everything. The `public` token reveals only the
   `public_desc`. Tests verify the leak-prevention contract — see `ical.test.ts`.

8. **PDF via `setContent`.** We render the HTML in-Worker and hand the string to puppeteer's
   `page.setContent`, which sidesteps the auth-bounce issue you'd hit if puppeteer navigated to
   a URL on the same Worker. No round-trip, no second auth flow.

9. **Stable colors.** New categories pick the first unused color from `CATEGORY_PALETTE`, then
   that color is persisted with the category. Renaming or moving a category never reshuffles
   the palette — important for charts and PDFs to stay visually consistent.

## Data Model

```
users 1──* sessions
users 1──* credentials          (passkeys)
users 1──* categories
users 1──* allowances           (one per category-year pair)
users 1──* vacations
users 1──* ical_tokens
users 1──* email_verifications  (in-flight verification links, 24h TTL)

categories 1──* allowances
categories 1──* vacations
```

| Table                 | Purpose                          | Notable columns                                                                               |
| --------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `users`               | Account record                   | `username`, `display_name`, `role`, `email`, `email_verified_at`, `timezone`, `last_login_at` |
| `sessions`            | Active sessions                  | `id` (token), `expires_at`, `last_seen_at`                                                    |
| `credentials`         | WebAuthn passkeys                | `id` (cred id), `public_key`, `counter`, `transports`, `nickname`                             |
| `categories`          | User-defined categories          | `accrues`, `color`, `archived`, `sort_order`                                                  |
| `allowances`          | Per-year, per-category budgets   | `year`, `days_allotted`, `days_carryover`, `notes`                                            |
| `vacations`           | Entries                          | `start_date`, `end_date`, `partial_amount`, `cancelled_at`, `ical_sequence`                   |
| `ical_tokens`         | Calendar feed tokens             | `scope` (`private`/`public`), `label`, `last_used_at`                                         |
| `email_verifications` | Pending email-verification links | `token` (32-byte hex), `email`, `expires_at` (24h)                                            |

## Authentication Flow

### First-run setup

1. Browser hits `/api/v1/auth/status` and receives `has_users: false`.
2. Frontend redirects to `/setup` and POSTs `{username, display_name}` to `/api/v1/auth/register/start`.
3. Worker calls `generateRegistrationOptions` and stashes the challenge under a fresh `flow_id`
   in KV with a 5-minute TTL.
4. Browser invokes `navigator.credentials.create()` via `@simplewebauthn/browser`.
5. Browser POSTs `{flow_id, response, nickname, timezone}` to `/finish`. Worker re-runs the
   registration gate (existing-username branch must be the requester), creates the user
   (`role: "admin"` if `userCount === 0`, else `"user"`), inserts the credential, seeds default
   categories (`Vacation`, `Flex`), creates a session, and sets the cookie.

Open multi-user signup is intentional. Anyone can pick an unused username and register; the only
gated branch is "username already exists" — in that case the requester must already be signed in
as that user (otherwise anyone could attach a new passkey to a known account).

### Subsequent login

1. Browser POSTs optional `{username}` to `/login/start`. Worker returns assertion options.
2. Browser invokes `navigator.credentials.get()`.
3. Browser POSTs `{flow_id, response}` to `/login/finish`. Worker verifies, updates the
   credential's counter, creates a session, sets the cookie.

### SUPPRESS_AUTH

When `SUPPRESS_AUTH=true` (only in dev), `requireAuth` short-circuits and forges a built-in
admin user (`developer` / id `00000000-...`). Logs a warning every request so it's hard to ship
this on by accident.

## API Patterns

- **Envelope:** `{ data: ... }` on success, `{ error: { message, code } }` on failure.
- **Error codes:** machine-readable strings (`VALIDATION_ERROR`, `UNAUTHORIZED`, etc.) plus
  matching HTTP statuses. Helper in `worker/lib/responses.ts`.
- **Validation:** server-side via plain TypeScript checks. Strict input shapes, length caps on
  free text. The vacation-shape validator (`validateVacationShape`) lives in `shared/` and runs
  in both the worker and the React app for instant feedback.
- **Year scoping:** the dashboard summary endpoint accepts `:year` and auto-creates an
  allowance row if one doesn't exist yet so the UI always has something to render.

## Frontend Patterns

- **TanStack Router file-based routes.** `src/routes/` files are the routes. `__root.tsx` is the
  shell. Auth redirects happen in the root component using a `useEffect` that watches
  `useAuthStatus` + `useMe`.
- **TanStack Query everywhere.** Every server interaction goes through a hook in
  `src/api/hooks.ts`. Mutations invalidate the relevant query keys on success.
- **No camelCase mapping layer.** API responses are snake_case, types are snake_case. The
  database shape is the API shape is the React state shape. Saves a translation tax.
- **Tailwind v4.** No config file, just `@import "tailwindcss"` in `app.css` and `@theme`
  blocks. Semantic color tokens (`--color-surface`, `--color-heading`, etc.) flip via the
  `.dark` class on `<html>`.

## Testing Strategy

- **`shared/*.test.ts`** — pure-function tests for vacation math and color palette. Fast.
- **`worker/*.test.ts`** — integration tests using `@cloudflare/vitest-pool-workers`. Each test
  file resets the in-memory D1 via `applyMigrations()`. We test the real Hono app end-to-end
  through `app.fetch(new Request(...))`.
- **`e2e/`** — Playwright. Runs against the dev server in `SUPPRESS_AUTH=true` mode so we don't
  have to dance with WebAuthn in headless Chrome.

The IDOR test in `worker/vacations.test.ts` is load-bearing: it proves a different user cannot
read, cancel, or delete another user's vacation.

## Known Limitations & Future Work

- **Office 365 calendar OAuth.** Bonus on the wishlist. Not yet implemented — start with the
  iCal feed, escalate to push-style sync only if we ever feel the pain.
- **Mailgun notifications + boss notifications.** Stubbed for the future. Schema doesn't track
  a "manager" yet.
- **Public holidays.** We treat any Mon-Fri as a business day, ignoring statutory holidays. For
  most use cases the user works around them by splitting an entry; we may add a per-user
  holiday list later.
- **Browser Rendering availability.** The PDF endpoint returns a clear 503 when the binding
  isn't configured (e.g. local dev). Use `?html=1` to preview the source. Fix: either pay for
  Browser Rendering on the local plan or add Wrangler's local browser shim.
- **Multi-user.** Schema, registration, and UI all support it. First user becomes admin, rest are
  role `user`. The only gated registration branch is "username already taken" — that requires the
  requester to already be signed in as that user (prevents passkey-attachment impersonation).
- **Office 365 calendar OAuth.** See first bullet — still wishlist.

## Email + calendar invites

Outbound email goes through Mailgun's HTTP API (`/v3/{domain}/messages.mime` for invites,
`/messages` for verification). The MIME message is hand-built (`worker/lib/mailgun.ts`) so the
calendar part can carry `Content-Type: text/calendar; method=PUBLISH|CANCEL` — that's what makes
Outlook show "Add to calendar." Mailgun secrets are loaded via `wrangler secret put`; an unset
key cleanly degrades to `console.warn` so dev/test environments don't need credentials.

The user adds their email in Settings, gets a verification link via Mailgun (24h, single-use,
256-bit token), and from then on every vacation create / update / cancel emits a calendar
invite to themselves with a stable UID (`{vacation.id}@afk`) and a monotonically-increasing
`SEQUENCE`. The same UID + sequence pattern keeps Outlook/Apple/Google in sync.

## Data export

`GET /api/v1/me/export.json` returns a complete dump of every user-owned table (profile,
categories, allowances, vacations) in a stable JSON envelope (`schema_version: 1`). `export.csv`
is a flat vacations-with-category-info view with computed day costs, RFC 4180-compliant. The
schema lives in `worker/lib/export.ts` and is the single source of truth — see CLAUDE.md
"Data Export Contract" for the rules around extending it when new columns/tables are added.

## Boss / approver (optional, opt-in)

Users can add a single boss or approver — an external email with no AFK account — in two
modes:

- **Notify** — every vacation lifecycle event (create / cancel / delete) fans out a copy of the
  same iCal invite the user gets to themselves. Subject leads with the user's `display_name`
  (not username, not email — fits in a notification preview).
- **Requires approval** — the vacation enters as `approval_state = 'pending'`. The user's own
  iCal invite goes out with `STATUS:TENTATIVE` (Apple/Google/Outlook render visually distinct).
  The boss gets an approval-request email with a magic link to a server-rendered HTML page
  showing the dates, days, and the user's category balance. Approve flips the state to
  `approved` and re-fires confirmed iCal to both parties; reject flips to `rejected`, sets
  `cancelled_at`, requires a comment, and emails the comment back to the user.

Two new tables (`migrations/0005_boss.sql`):

| Table                | Purpose                               | Notable columns                                                                               |
| -------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `boss_relationships` | One per user                          | `boss_email`, `boss_display_name`, `mode`, `consent_token`, `consented_at`, `revoked_at`      |
| `vacation_approvals` | Per (vacation, boss) approval request | `state` (`pending`/`approved`/`rejected`), `decision_token`, `decided_at`, `decision_comment` |

`vacations.approval_state` is denormalised onto the row so the dashboard query doesn't need a
join. Tokens are 64-char hex (32 bytes), single-use after the action, with a 7-day TTL on
consent and 14-day TTL on decisions. Public boss pages (`/boss/consent/:token`,
`/boss/approve/:token`) live outside `/api/v1` because the boss has no account — the URL token
IS the auth, format-gated to constant-time-404 bogus probes.

Calendar lifecycle in approval mode:

```
user creates → approval_state=pending → user iCal: TENTATIVE, [Pending] in summary
                                       → boss email: approval-request (NO iCal yet)
boss approves → approval_state=approved → user iCal: CONFIRMED
                                        → boss iCal: PUBLISH (CONFIRMED)
                                        → user receipt email
boss rejects  → approval_state=rejected → vacation cancelled_at = now
                                        → user iCal: CANCEL
                                        → boss iCal: CANCEL (no-op if they never had it)
                                        → user receipt email with the comment
```

The public iCal feed (`/ical/:token`) shows pending/rejected entries on the **private** scope
only — the public scope omits them entirely so a user's team doesn't see speculative bookings.

## Daily cron

`wrangler.toml [env.*.triggers]` runs `worker/index.ts#scheduled` daily at 04:00 UTC. Three
purges: expired session rows (`sessions.expires_at < now`), expired email-verification tokens,
and expired boss tokens (consent + approval). All compare via `julianday()` because the stored
ISO timestamps don't sort lexicographically against SQLite's `datetime('now')` format. Each
task is wrapped so a single failure doesn't take down the others, and start/end log lines
leave breadcrumbs in `wrangler tail`.

- **Session secret.** `SESSION_SECRET` is reserved but currently unused — sessions rely on
  unguessable random IDs (256 bits) and a server-side row. We'd need this if we ever switched
  to signed cookies.
