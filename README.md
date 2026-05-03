# AFK — Away From Keyboard

Personal vacation tracker that runs on Cloudflare Workers. Pretty. Mobile-friendly. Sarcastic to a fault.

> Out of office. Out of patience.

AFK tracks how much time off you have left and how badly you've been wasting it. It supports
multiple categories (Vacation, Flex, whatever else HR invents this quarter), per-year allowances
with carryover, partial days, an iCal feed for Outlook/Google Calendar, and a charmingly bitter
PDF export. Authentication is passkey-only.

Designed for one person — yours truly — but it'll happily host a single account on a
self-deployed Cloudflare Worker at `afk.onewheelgeek.net`.

## Quick Start

```bash
# 1. Install all the things via mise
mise install
npm ci

# 2. Copy the dev secrets file and tweak as needed
cp .dev.vars.sample .dev.vars

# 3. Create the local D1 database & apply migrations
npx wrangler d1 create afk-db   # paste the returned ID into wrangler.toml
mise run db:migrate

# 4. Boot the dev server (Vite + Workerd)
mise run dev

# 5. Open http://localhost:5173
#    With SUPPRESS_AUTH="true" in .dev.vars you'll be auto-logged-in as
#    the developer user. Otherwise, the first visit lands on /setup so
#    you can register a passkey.
```

## Configuration

| Variable          | Description                                                                              | Default                        | Required           |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------ | ------------------ |
| `RP_ID`           | WebAuthn relying-party ID (derived from request hostname per-request)                    | _(request hostname)_           | No                 |
| `RP_NAME`         | WebAuthn relying-party name (shown in OS UI)                                             | `AFK`                          | Yes                |
| `APP_ORIGIN`      | Origin URL used for iCal feed URLs                                                       | `https://afk.onewheelgeek.net` | Yes                |
| `APP_VERSION`     | Version string returned by `/api/v1/health` (CI sets this from git describe)             | `dev`                          | No                 |
| `SESSION_SECRET`  | Reserved for future signed cookies                                                       | –                              | No (yet)           |
| `SUPPRESS_AUTH`   | When `"true"`, skip auth and auto-login as a built-in dev user. **NEVER set in prod.**   | (unset)                        | No                 |
| `MAILGUN_API_KEY` | Mailgun API key. Set via `wrangler secret put MAILGUN_API_KEY --env <test\|production>`. | (unset → emails skipped)       | For email/invites  |
| `MAILGUN_DOMAIN`  | Mailgun sending domain (e.g. `mg.example.com`)                                           | –                              | If MAILGUN_API_KEY |
| `MAILGUN_REGION`  | `us` or `eu`                                                                             | `us`                           | No                 |
| `MAILGUN_FROM`    | RFC 5322 `From:` header on outbound mail                                                 | `AFK <afk@MAILGUN_DOMAIN>`     | No                 |

Local secrets live in `.dev.vars` (gitignored). Production values live in
`wrangler.toml [env.production.vars]` plus `wrangler secret put` for sensitive ones.

## Bindings

Defined in `wrangler.toml`:

- **D1** — `DB` — stores users, credentials, sessions, categories, allowances, vacations, iCal tokens, email verifications
- **KV** — `KV` — stores WebAuthn challenges with a 5-minute TTL
- **Browser Rendering** — `BROWSER` — renders the year-summary PDF
- **Assets** — `ASSETS` — serves the built React SPA (production)
- **Cron Trigger** — daily 04:00 UTC, purges expired sessions and email-verification tokens

## Development

| Command                    | What it does                                               |
| -------------------------- | ---------------------------------------------------------- |
| `mise run dev`             | Vite + Workerd dev server with HMR                         |
| `mise run test`            | Vitest unit + integration tests (Workers pool)             |
| `mise run test:e2e`        | Playwright end-to-end tests                                |
| `mise run lint`            | `tsc --noEmit` + ESLint                                    |
| `mise run fmt`             | Prettier + `eslint --fix`                                  |
| `mise run build`           | Production build (Vite + worker)                           |
| `mise run deploy`          | Build + deploy to **test** (`afk-test.workers.dev`)        |
| `mise run deploy:prod`     | Build + deploy to **production** (refuses on dirty trees)  |
| `mise run release`         | Bump tag and push — GitHub Actions deploys the tag to prod |
| `mise run db:migrate`      | Apply D1 migrations to the local test DB                   |
| `mise run db:migrate:test` | Apply D1 migrations to the remote test DB                  |
| `mise run db:migrate:prod` | Apply D1 migrations to the remote production DB            |
| `mise run db:new <name>`   | Create a new numbered migration file                       |
| `mise run dev:reset`       | Wipe local Wrangler / Vite state                           |

## API

All API routes are mounted under `/api/v1`. The app authenticates browsers with a session cookie;
programmatic clients aren't supported (it's a personal app).

### Key endpoints

| Method                        | Path                                                | Description                                          |
| ----------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| `GET`                         | `/api/v1/health`                                    | Liveness probe — no auth                             |
| `GET`                         | `/api/v1/auth/status`                               | First-run check (`has_users`)                        |
| `GET`                         | `/api/v1/auth/me`                                   | Current user (or 401)                                |
| `POST`                        | `/api/v1/auth/register/start` & `/finish`           | Passkey registration                                 |
| `POST`                        | `/api/v1/auth/login/start` & `/finish`              | Passkey authentication                               |
| `POST`                        | `/api/v1/auth/logout`                               | Destroy session                                      |
| `GET` `POST` `PATCH` `DELETE` | `/api/v1/categories[/:id]`                          | Category CRUD                                        |
| `GET` `PUT`                   | `/api/v1/categories/allowances/:year[/:categoryId]` | Allowance per year                                   |
| `GET`                         | `/api/v1/vacations/summary/:year`                   | Year summary (widgets + list)                        |
| `POST` `PATCH`                | `/api/v1/vacations[/:id]`                           | Vacation CRUD                                        |
| `POST`                        | `/api/v1/vacations/:id/cancel`                      | Soft-cancel a vacation                               |
| `GET` `POST` `DELETE`         | `/api/v1/passkeys[/:id]`                            | Manage passkeys                                      |
| `GET` `POST` `DELETE`         | `/api/v1/ical-tokens[/:id]`                         | Manage iCal feed tokens                              |
| `GET`                         | `/api/v1/pdf/:year`                                 | Render year summary as PDF                           |
| `PATCH` `DELETE`              | `/api/v1/me/email`                                  | Set / clear email (triggers verification mail)       |
| `POST`                        | `/api/v1/me/email/resend`                           | Resend the email-verification link                   |
| `PATCH`                       | `/api/v1/me/timezone`                               | Update IANA timezone                                 |
| `GET`                         | `/api/v1/me/export.json`                            | Full data dump (categories, allowances, vacations)   |
| `GET`                         | `/api/v1/me/export.csv`                             | Vacations as a flat CSV with category info           |
| `GET` `PUT` `DELETE`          | `/api/v1/boss`                                      | Manage your single boss / approver                   |
| `POST`                        | `/api/v1/boss/resend-consent`                       | Re-send the consent link to your boss                |
| `GET`                         | `/ical/:token.ics`                                  | Public-facing iCal feed (token-authenticated)        |
| `GET`                         | `/verify-email/:token`                              | Email-verification redirect (link from inbox)        |
| `GET` `POST`                  | `/boss/consent/:token`                              | Public consent page (boss has no AFK account)        |
| `GET` `POST`                  | `/boss/approve/:token`                              | Public approve/reject page (boss has no AFK account) |

## Deployment

Two environments, one Worker config (`wrangler.toml`):

| Env          | Worker     | URL                           | D1            | KV            |
| ------------ | ---------- | ----------------------------- | ------------- | ------------- |
| `test`       | `afk-test` | `afk-test.<acct>.workers.dev` | `afk-test-db` | `afk-test-kv` |
| `production` | `afk`      | `afk.onewheelgeek.net`        | `afk-db`      | `afk-kv`      |

`APP_VERSION` is computed at deploy time from git: the latest tag if HEAD is at it,
otherwise `<tag>-<short-hash>`, with ` (dirty)` appended if the working tree is dirty.

### CI/CD — `.github/workflows/deploy.yml`

| Trigger             | Target                        |
| ------------------- | ----------------------------- |
| Push to `main`      | `test`                        |
| Push of a `v*` tag  | `production`                  |
| `workflow_dispatch` | Choose `test` or `production` |

The standard release flow is `mise run release` — it picks a new semver tag,
creates it, pushes it, and the tag-push triggers the production deploy.

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN` — scoped to D1 + Workers + KV + Browser Rendering
- `CLOUDFLARE_ACCOUNT_ID`

### First-time bootstrap

```bash
# Test resources
npx wrangler d1 create afk-test-db                # paste id into wrangler.toml [env.test]
npx wrangler kv namespace create afk-test-kv      # paste id into wrangler.toml [env.test]

# Production resources
npx wrangler d1 create afk-db                     # paste id into wrangler.toml [env.production]
npx wrangler kv namespace create afk-kv           # paste id into wrangler.toml [env.production]

mise run db:migrate:test
mise run db:migrate:prod
mise run deploy            # test
mise run deploy:prod       # production
```

## Architecture

A single Worker bundles the API and the React SPA. Auth is passkey-only with server-side
sessions in D1; challenges live in KV with a 5-minute TTL. The PDF endpoint server-renders an
HTML document and pipes it to the Browser Rendering binding via `@cloudflare/puppeteer`.

See `DESIGN.md` for the full architecture write-up, data model, and gotchas.

## License

(C) 2026 Jeff Clement.
