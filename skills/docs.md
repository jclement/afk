# Documentation Skill

You are maintaining living documentation for this project. Documentation is not a one-time task — it must stay current with the code. **Stale docs are worse than no docs** because they actively mislead.

## Two Required Documents

Every project maintains two documentation files:

### 1. `README.md` — User-Facing

The README is for someone who wants to **use or set up** the application. It answers: What is this? How do I run it? How do I configure it? How do I deploy it?

#### Required Sections

```markdown
# <AppName>

<One-line description of what this does and who it's for>

> <Random tagline>

## Quick Start

<3-5 numbered steps to get from zero to running locally>
1. Clone the repo
2. `mise install` (installs all tools)
3. Copy config: `cp fnox.local.toml.sample fnox.local.toml`
4. `mise run dev`
5. Open http://localhost:8080

## Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | HTTP listen port | `8080` | No |
| `DATABASE_URL` | SQLite path or Postgres connection string | `./data/<app>.db` | No |
| `DATABASE_DRIVER` | `sqlite` or `postgres` | `sqlite` | No |
| `SUPPRESS_AUTH` | Skip authentication (dev only) | `false` | No |
| `SESSION_SECRET` | Secret for session signing | — | Yes (prod) |

<Include ALL env vars. Update this table every time you add, change, or remove one.>

## Development

| Command | What it does |
|---------|-------------|
| `mise run dev` | Start dev server with hot reload |
| `mise run test` | Run all tests |
| `mise run lint` | Lint and typecheck |
| `mise run build` | Production build |
| `mise run fmt` | Format all code |
| `mise run release` | Tag and push a release |
| `mise run dev:reset` | Blow away local dev state |

## API

<Brief overview of the API. Link to `/api/docs` for Swagger UI.>

### Authentication

<How to authenticate: session cookie for browsers, API key for programmatic access.>

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health check (no auth) |
| `GET` | `/api/v1/things` | List things |
| `POST` | `/api/v1/things` | Create a thing |

<Don't list every endpoint — just the important ones. Point to OpenAPI spec for full reference.>

## Deployment

### Docker (Recommended)

<Exact docker commands or compose file>

### Binary

<Where to download, how to run>

### Cloudflare (if applicable)

<Wrangler deploy steps>

## Architecture

<Brief (3-5 sentences) description of the architecture. Link to DESIGN.md for details.>

## License

(C) <year> Jeff Clement
```

### 2. `DESIGN.md` — Developer-Facing

The DESIGN.md is for someone who wants to **understand and modify** the code. It answers: Why is it built this way? Where does this logic live? What are the important patterns? What are the gotchas?

#### Required Sections

```markdown
# <AppName> — Design & Architecture

## Overview

<2-3 paragraphs: what the app does, the core problem it solves, and the high-level approach.>

## Architecture

<Describe the system architecture. For web apps: how the frontend and backend interact, where state lives, how auth works. For CLIs: the command structure, the TUI model, data flow.>

### System Diagram (text)

<ASCII or Mermaid diagram showing major components and data flow>

```
Browser → [React SPA] → /api/* → [Go HTTP Server] → [SQLite/Postgres]
                                        ↓
                                  [Auth Middleware]
                                        ↓
                                  [Route Handlers]
```

## Project Structure

<Annotated tree showing every important directory with a one-line explanation>

```
cmd/<app>/main.go          — Entry point, config loading, server startup
internal/
  server/server.go         — HTTP server, middleware stack, graceful shutdown
  server/routes.go         — Route registration
  api/                     — API handlers (one file per domain)
  auth/                    — Authentication logic
  store/                   — Database access layer
  models/                  — Domain types
frontend/
  src/routes/              — TanStack Router pages
  src/components/          — Shared UI components
  src/api/hooks.ts         — React Query hooks
migrations/                — Database migrations (auto-run on startup)
```

## Key Design Decisions

<Numbered list of important architectural choices and WHY they were made>

1. **SQLite by default** — Most installs are single-server. SQLite eliminates a dependency. Postgres available via `DATABASE_DRIVER=postgres` for multi-instance deployments.

2. **Server-side sessions** — Not JWTs. Sessions can be revoked instantly, don't leak claims, and don't grow unbounded.

3. **OpenAPI-first API** — The spec drives both Go server types and TypeScript client. Prevents drift between frontend and backend.

## Data Model

<List the core tables/entities with their relationships and purpose>

### Entity Relationship

```
Users 1──* Sessions
Users 1──* API Keys
Users 1──* Things
Things 1──* SubThings
```

### Key Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts (id, username, email, role) |
| `sessions` | Active sessions (token hash, user_id, expires_at) |
| `api_keys` | API keys (key hash, scopes, expiry) |

## Authentication Flow

<Describe the auth flow: how login works, how sessions are created, how the middleware validates requests, how SUPPRESS_AUTH works.>

## API Patterns

<Describe: response envelope, error format, pagination, rate limiting, versioning strategy.>

## Frontend Patterns

<Describe: routing approach, state management (React Query), component patterns, how forms work, how the theme system works.>

## Testing Strategy

<What's tested, how, and what the test helpers do.>

## Deployment Architecture

<How the app is deployed: Docker, Cloudflare Tunnel, systemd, etc. Include the production stack.>

## Known Limitations & Future Work

<Honest list of known issues, shortcuts, and planned improvements. This is where you document tech debt.>
```

## When to Update Documentation

### README.md — Update When:
- Adding, changing, or removing an environment variable
- Adding or changing a mise task
- Changing deployment steps
- Adding a major feature that affects how users interact with the app
- Changing the tech stack or dependencies

### DESIGN.md — Update When:
- Adding a new major component or service
- Changing the data model (new tables, changed relationships)
- Making an architectural decision that future developers need to understand
- Adding a new integration or external dependency
- Changing the auth flow or API patterns
- Discovering a gotcha that cost you debugging time

## Documentation Style

- **Be specific.** Not "configure the database" but "set `DATABASE_URL` to a Postgres connection string: `postgres://user:pass@host/db`"
- **Show, don't just tell.** Include actual commands, actual env vars, actual file paths.
- **Keep it scannable.** Tables for configuration. Numbered lists for procedures. Code blocks for commands.
- **Date your decisions.** In DESIGN.md, when documenting why something was built a certain way, note the context: "SQLite chosen because target is single-server self-hosted (as of v1.0)."
- **Link between docs.** README says "see DESIGN.md for architecture details." DESIGN.md says "see README for setup instructions."

## Auto-Maintenance Rules for Claude

1. **After every feature:** Check if README.md needs updating (new env vars? new endpoints? changed setup steps?)
2. **After every architectural change:** Update DESIGN.md (new component? changed data model? new pattern?)
3. **After adding a migration:** Update the data model section in DESIGN.md
4. **After adding an API endpoint:** Update the API section in both README.md (key endpoints table) and DESIGN.md (if it introduces a new pattern)
5. **Never let docs refer to things that don't exist.** If you remove a feature, remove it from the docs in the same change.
