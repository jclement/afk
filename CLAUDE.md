# App Builder — Claude Code Guidelines

You are bootstrapping and building applications for Jeff Clement. This directory is a project template — drop these files into a new project folder, describe what you want to build, and Claude will build it.

## How This Works

1. User creates a new project directory and copies these files in (or clones this repo)
2. User describes the application they want
3. Claude reads this file, identifies the right stack, and follows the skills to build a complete, working application

## Stack Selection

Pick **one** based on the project description:

| Stack | When | Key Trait |
|-------|------|-----------|
| **Go Web** | Self-hosted web apps, internal tools, APIs | Single binary with embedded React SPA, SQLite/Postgres |
| **Go CLI/TUI** | Terminal tools, automation, developer utilities | Single binary, Bubble Tea, colorful output |
| **Cloudflare Worker** | Edge-deployed web apps, lightweight SaaS | Vite + Workers, D1/KV, deploy with Wrangler |

If the description is ambiguous, ask.

## Skills (`skills/`)

Skills are reference documents that encode best practices. **Read the relevant skill file before starting work in that area.** You should load skills automatically based on what you're about to do — don't wait to be asked.

### Always Load (every project, every session)

| Skill | File | Contains |
|-------|------|----------|
| **Dev Tooling** | `skills/devtools.md` | mise setup, tasks, `mise exec`, hot reload, `.claude/settings.json` |
| **Testing** | `skills/testing.md` | Unit tests, E2E, linting — run on every change, never skip |
| **Code Quality** | `skills/code-quality.md` | Readability, comments, naming, structure — for human Jeff |
| **Documentation** | `skills/docs.md` | Auto-maintain README.md and DESIGN.md with every change |

### Load When Triggered

| Skill | File | Load when... |
|-------|------|-------------|
| **UI Design** | `skills/ui.md` | Creating or modifying frontend UI, components, layouts, styles |
| **Authentication** | `skills/auth.md` | Adding login/register, sessions, SUPPRESS_AUTH, user management |
| **CLI** | `skills/cli.md` | Building a terminal application, adding commands, TUI work |
| **Deployment** | `skills/deploy.md` | Setting up CI/CD, GitHub Actions, Dockerfiles, GoReleaser |
| **Auto-Update** | `skills/auto-update.md` | Implementing self-update, version checking, sigstore verification |
| **Database** | `skills/database.md` | Adding tables, migrations, queries, switching SQLite/Postgres |
| **Web API** | `skills/api.md` | Adding API endpoints, API keys, OpenAPI docs, Swagger |
| **Devcontainer** | `skills/devcontainer.md` | Setting up `.devcontainer/` for the project |
| **Security** | `skills/security.md` | Any change touching auth, user input, API endpoints, or data access |

## Universal Rules

### mise Is Everything

- **[mise](https://mise.jdx.dev/)** manages all dev tools and tasks
- Every project has a `mise.toml` with standard tasks: `dev`, `test`, `lint`, `build`, `release`
- **Use `mise exec --` to run tools** — they are NOT in the global PATH
- **Use `mise run <task>`** when a task exists for the operation
- See `skills/devtools.md` for the full mise setup

### Latest Versions Always

Use the latest stable versions of everything: Go, React, Node, Vite, Tailwind, all dependencies, Docker base images, GitHub Actions. Do not pin to old versions out of habit.

### Secrets — fnox + 1Password

- Local: fnox pulls from 1Password, injected via `fnox.local.toml` (gitignored)
- CI: GitHub Secrets with the same variable names
- Include `fnox.local.toml.sample` (committed) showing the structure

### MANDATORY: Run Before Committing

1. `mise run fmt` — format all code
2. `mise run lint` — must pass with zero warnings
3. `mise run test` — must pass, no skipped tests
4. If user-visible changes: update README.md

### MANDATORY: Testing

- **Run tests after every change.** Not at the end — after each logical change.
- **Run linters after every change.** `go vet`, `staticcheck`, `go fmt` for Go. `tsc`, `eslint` for TypeScript.
- **Fix failures immediately.** Never leave failing tests for later.
- **Add tests for every feature and bugfix.** No exceptions.
- See `skills/testing.md` for detailed patterns.

### MANDATORY: Documentation

Every project has two living documents — see `skills/docs.md` for full details:

- **`README.md`** — User-facing: what is this, how to run it, how to configure it, how to deploy it
- **`DESIGN.md`** — Developer-facing: architecture, design decisions, data model, patterns, gotchas

Update docs **in the same change** as the code. If you add an env var, update the README config table. If you add a table, update the DESIGN.md data model. Stale docs are a bug.

### MANDATORY: Code Quality

Code must be readable by human Jeff six months from now. See `skills/code-quality.md` for full details:

- Every file gets a top-of-file comment explaining its purpose
- Every exported function/component gets a doc comment
- Non-obvious decisions get *why* comments (not *what*)
- Functions under ~40 lines, use early returns, descriptive names
- Match existing patterns in the codebase — consistency matters

### MANDATORY: Security Review

Before finishing any task that touches auth, API endpoints, user input, or data access — see `skills/security.md` for the full checklist:

- Check for injection vulnerabilities (SQL, XSS, command)
- Verify auth/authz on every endpoint (no IDOR)
- Ensure secrets are never logged or exposed in responses
- Validate all inputs server-side
- API keys: hash with SHA-256, show plaintext once at creation
- Set security headers on all responses

## Bootstrapping Sequence

When building a new app, follow this order:

### Go Web
1. `mise.toml`, `.air.toml`, `.goreleaser.yaml`, `Dockerfile`, `Dockerfile.goreleaser`
2. `.claude/settings.json` (permissions for dev tools)
3. `.devcontainer/devcontainer.json`, `.devcontainer/setup.sh`
4. `go.mod`, `cmd/<appname>/main.go` (version embedding, config, server startup, graceful shutdown)
5. `internal/` — server, routes, middleware, auth, store, models
6. `api/openapi.yaml`, `api/generate.go`
7. `migrations/` — initial schema
8. `frontend/` — full React app (package.json, vite.config.ts, tsconfig, src/, index.html)
9. `frontend/src/` — app.css (full theme), routes, components, api hooks, taglines
10. `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml`
11. `deploy/` — docker-compose files
12. `fnox.local.toml.sample`, `.gitignore`, `CLAUDE.md`, `README.md`, `DESIGN.md`

### Go CLI/TUI
1. `mise.toml`, `.air.toml`, `.goreleaser.yaml`, `Dockerfile`, `Dockerfile.goreleaser`
2. `.claude/settings.json`, `.devcontainer/devcontainer.json`, `.devcontainer/setup.sh`
3. `go.mod`, `cmd/<appname>/main.go` (Cobra root, config, TUI launch, TTY detection)
4. `internal/tui/` — app.go, keys.go, styles.go, components/
5. `internal/config/`, `internal/<domain>/`
6. Taglines in `internal/taglines/taglines.go`
7. `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml`
8. `fnox.local.toml.sample`, `.gitignore`, `CLAUDE.md`, `README.md`, `DESIGN.md`

### Cloudflare Worker
1. `mise.toml`, `wrangler.toml`, `vite.config.ts`, `tsconfig.json`, `package.json`
2. `.claude/settings.json`, `.devcontainer/devcontainer.json`, `.devcontainer/setup.sh`
3. `worker/` — index.ts, router.ts, types.ts, middleware, handlers
4. `migrations/` — initial D1 schema
5. `src/` — full React app (main.tsx, app.css with full theme, routes, components, api hooks, taglines)
6. `index.html`
7. `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.github/dependabot.yml`
8. `.dev.vars.sample`, `fnox.local.toml.sample`, `.gitignore`, `CLAUDE.md`, `README.md`, `DESIGN.md`

## Build Output Expectations

- **Go:** Single static binary. `CGO_ENABLED=0` always. Assets embedded via `//go:embed`.
- **Cloudflare:** Wrangler deploy. Assets served by Workers.
- **Version:** Injected via ldflags (Go) or git describe (Cloudflare/Vite). Show in health endpoint, UI footer, CLI `--version`.

## Go Specifics

- **Zero CGO.** `CGO_ENABLED=0`. Use `modernc.org/sqlite` for SQLite.
- **net/http stdlib** router (Go 1.22+ method patterns). No Gin/Echo/Chi.
- **log/slog** for structured logging. Text in dev, JSON in production.
- **Graceful shutdown:** SIGINT/SIGTERM → stop accepting → drain (30s) → close DB → exit.
- **Dev vs Production:** Controlled by `version` variable. `"dev"` = debug logging, serve frontend from Vite, CORS for localhost. Production = JSON logging, embedded assets, same-origin.

## Frontend Specifics (Shared)

- **React** (latest) + **TypeScript** (strict)
- **Tailwind CSS v4** with `@tailwindcss/vite` (no config file)
- **TanStack Router** (file-based, type-safe routing)
- **TanStack Query** (data fetching with caching)
- **Lucide React** (icons)
- **Vitest** + **React Testing Library** (unit tests)
- **Playwright** (E2E tests)
- API response types use **snake_case** to match the database — no camelCase mapping layer

## Taglines

Every app gets ~200 short, funny, domain-relevant taglines. Show on login screen, header, footer, or CLI version output. Generate all of them — no `// ... more` placeholders.

## Import/Export

Every app that manages user data supports import/export from day one:
- **Web:** Toolbar buttons for Export (CSV, JSON) and Import (with preview + validation)
- **CLI:** `--json` and `--format` flags, stdin support for piping

## Common Workflows

**Adding a new API endpoint:**
1. Define in OpenAPI spec (Go) or add handler directly
2. Add handler with tests
3. Add React Query hook
4. Run `mise run fmt && mise run test && mise run lint`
5. Update README.md (key endpoints table) and DESIGN.md (if new pattern)

**Adding a new frontend page:**
1. Add route in `src/routes/` (or `frontend/src/routes/`)
2. Add components to `src/components/`
3. Wire up API hooks
4. Add tests (unit + E2E if user-visible)
5. Run `mise run fmt && mise run test && mise run lint`
6. Update README.md if user-facing

**Adding a database migration:**
1. `mise run db:new "description"`
2. Write SQL for both SQLite and Postgres (if dual-driver)
3. `mise run db:migrate`
4. Update models/types and affected handlers
5. Update tests
6. Update DESIGN.md data model section
