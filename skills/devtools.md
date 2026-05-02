# Developer Tooling Skill

You are setting up the development environment for a project. **mise is the foundation for everything.**

## mise — The Universal Rule

[mise](https://mise.jdx.dev/) manages all development tools and tasks. Every project has a `mise.toml`.

### Installing Dependencies

**Always install tools through mise first.** Do not assume tools are in the global PATH.

```toml
[tools]
go = "latest"
node = "lts"
python = "latest"
"npm:bun" = "latest"
goreleaser = "latest"
"go:github.com/air-verse/air" = "latest"
"go:honnef.co/go/tools/cmd/staticcheck" = "latest"
```

### Running Tools — CRITICAL

**When Claude is running, use `mise exec` to invoke tools**, not bare commands. Tools installed by mise are NOT in the global PATH inside Claude's execution environment.

```bash
# WRONG — tool may not be found
go test ./...
npx vitest run
bun run dev

# RIGHT — mise ensures the tool is available
mise exec -- go test ./...
mise exec -- npx vitest run
mise exec -- bun run dev

# BEST — use mise tasks (they automatically get the right env)
mise run test
mise run dev
mise run lint
```

**Exception:** If a `mise run <task>` exists for the operation, prefer that over `mise exec`.

### Required Mise Tasks (Every Project)

```toml
[tasks.dev]
description = "Start full dev environment"
# Runs all watchers/servers in parallel

[tasks.test]
description = "Run all tests"

[tasks."test:unit"]
description = "Unit tests only"

[tasks."test:e2e"]
description = "E2E tests (if applicable)"

[tasks.lint]
description = "Run all linters and type checks"

[tasks.build]
description = "Production build"

[tasks.release]
description = "Version bump, tag, push (triggers CI)"

[tasks."dev:reset"]
description = "Blow away local dev state (databases, caches, tmp)"

[tasks.fmt]
description = "Format code"
```

If the app has a database, also include:
```toml
[tasks."db:migrate"]
description = "Apply migrations locally"

[tasks."db:new"]
description = "Create a new migration file"
```

### Example mise.toml — Go Web App

```toml
[tools]
go = "latest"
node = "lts"
goreleaser = "latest"
"go:github.com/air-verse/air" = "latest"

[env]
PORT = "8080"
DATABASE_URL = "./data/app.db"
LOG_LEVEL = "debug"

[tasks.dev]
description = "Start dev servers (Go + Vite)"
run = """
#!/bin/bash
trap 'kill 0' EXIT
cd frontend && npm run dev &
air &
wait
"""

[tasks."dev:api"]
description = "Start Go backend only"
run = "air"

[tasks."dev:ui"]
description = "Start Vite frontend only"
run = "cd frontend && npm run dev"

[tasks.test]
description = "Run all tests"
depends = ["test:api", "test:ui"]

[tasks."test:api"]
description = "Go tests"
run = "go test -v -race -cover ./..."

[tasks."test:ui"]
description = "Frontend tests"
run = "cd frontend && npx vitest run"

[tasks.lint]
description = "Lint everything"
run = """
go vet ./... && \
staticcheck ./... && \
cd frontend && npx tsc --noEmit && npx eslint .
"""

[tasks.fmt]
description = "Format code"
run = "go fmt ./... && cd frontend && npx prettier --write src/"

[tasks.build]
description = "Production build"
run = """
#!/bin/bash
set -e
cd frontend && npm run build && cd ..
CGO_ENABLED=0 go build -ldflags="-s -w -X main.version=dev" -o bin/app ./cmd/app
"""

[tasks."dev:reset"]
description = "Blow away local dev state"
run = "rm -rf tmp/ bin/ data/*.db frontend/node_modules/.vite"

[tasks.release]
description = "Tag and push a release"
run = """
#!/bin/bash
set -e
current=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
echo "Current: $current"
major=$(echo $current | sed 's/v//' | cut -d. -f1)
minor=$(echo $current | cut -d. -f2)
patch=$(echo $current | cut -d. -f3)
echo "  1) patch → v${major}.${minor}.$((patch+1))"
echo "  2) minor → v${major}.$((minor+1)).0"
echo "  3) major → v$((major+1)).0.0"
read -p "Choice [1]: " c; c=${c:-1}
case $c in
  1) v="v${major}.${minor}.$((patch+1))" ;;
  2) v="v${major}.$((minor+1)).0" ;;
  3) v="v$((major+1)).0.0" ;;
  *) echo "Invalid"; exit 1 ;;
esac
git tag -a "$v" -m "Release $v"
read -p "Push $v? [Y/n]: " p; p=${p:-Y}
[[ $p =~ ^[Yy]$ ]] && git push origin "$v"
"""
```

### mise.local.toml — Local Dev Overrides (Gitignored)

```toml
[env]
SUPPRESS_AUTH = "true"
```

Always add `mise.local.toml` to `.gitignore`.

## Secrets Management — fnox + 1Password

**Local development:** [fnox](https://github.com/jdx/fnox) pulls secrets from 1Password and injects them into commands.

Every project includes a `fnox.local.toml.sample` (committed) showing the structure:

```toml
default_provider = "1Password"

[providers.1Password]
type = "1password"

[secrets]
SESSION_SECRET = {provider = "1Password", value = "op://Employee/<AppName>/SESSION_SECRET"}
# Add project-specific secrets here
```

The real `fnox.local.toml` is gitignored.

**CI/CD:** GitHub Secrets directly — same variable names so code doesn't care about the source.

## Hot Reload

### Go — Air

```toml
# .air.toml
root = "."
tmp_dir = "tmp"

[build]
cmd = "go build -ldflags=\"-X main.version=dev\" -o ./tmp/main ./cmd/<appname>"
bin = "./tmp/main"
include_ext = ["go", "html", "css", "js"]
exclude_dir = ["tmp", "bin", "dist", "frontend/node_modules", "data"]
delay = 1000
```

### Frontend — Vite

Vite dev server with HMR. In dev mode, Go serves the API and Vite serves the frontend with proxy:

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
});
```

## .gitignore (Standard)

```gitignore
# Dependencies
node_modules/

# Build output
dist/
bin/
tmp/

# Local secrets (NEVER commit)
.dev.vars
fnox.local.toml
mise.local.toml

# Data
data/
*.db

# IDE
.vscode/
.idea/

# OS
.DS_Store

# Cloudflare
.wrangler/

# TanStack Router cache
.tanstack/

# Core dumps
core
```

## Claude Settings (`.claude/settings.json`) — MANDATORY

Every project **must** include `.claude/settings.json` during bootstrapping. This is what lets Claude run dev tools without constant permission prompts.

```json
{
  "permissions": {
    "allow": [
      "Bash(mise run *)",
      "Bash(mise exec -- *)",
      "Bash(go mod tidy)",
      "Bash(go mod download)",
      "Bash(go test *)",
      "Bash(go vet *)",
      "Bash(go fmt *)",
      "Bash(npm ci)",
      "Bash(npm install)",
      "Bash(npm test)",
      "Bash(npm run *)",
      "Bash(npx *)"
    ]
  }
}
```

Add this to the bootstrapping sequence — it's as important as `mise.toml`.
