# Devcontainer Skill

You are setting up a devcontainer for consistent development environments. Uses mise for all tool installation — no manual version management.

## Philosophy

- **mise installs everything** — Go, Node, Bun, Python, and all dev tools
- **Works in GitHub Codespaces and local VS Code/Cursor**
- **Minimal base image** — start with a Debian/Ubuntu base, let mise handle the rest
- **Devcontainer features** for things mise can't install (Docker-in-Docker, Git, etc.)
- **Post-create runs `mise install`** to set up all project tools

## `.devcontainer/devcontainer.json`

```json
{
  "name": "<AppName>",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/devcontainers/features/docker-in-docker:2": {},
    "ghcr.io/devcontainers/features/git:1": {},
    "ghcr.io/devcontainers/features/github-cli:1": {}
  },
  "postCreateCommand": "bash .devcontainer/setup.sh",
  "postStartCommand": "mise install",
  "forwardPorts": [8080, 5173],
  "customizations": {
    "vscode": {
      "extensions": [
        "golang.Go",
        "bradlc.vscode-tailwindcss",
        "esbenp.prettier-vscode",
        "dbaeumer.vscode-eslint"
      ],
      "settings": {
        "terminal.integrated.defaultProfile.linux": "bash",
        "editor.formatOnSave": true,
        "go.toolsManagement.autoUpdate": false
      }
    }
  },
  "containerEnv": {
    "MISE_YES": "1"
  },
  "remoteEnv": {
    "PATH": "${containerEnv:HOME}/.local/share/mise/shims:${containerEnv:PATH}"
  }
}
```

## `.devcontainer/setup.sh`

```bash
#!/bin/bash
set -e

echo "=== Installing mise ==="
curl https://mise.run | sh
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
export PATH="$HOME/.local/bin:$PATH"

echo "=== Installing project tools ==="
mise install

echo "=== Installing project dependencies ==="
# Go projects
if [ -f "go.mod" ]; then
    mise exec -- go mod download
fi

# Node/frontend projects
if [ -f "package.json" ]; then
    mise exec -- npm ci
fi

# Frontend subdirectory (Go Web apps)
if [ -f "frontend/package.json" ]; then
    cd frontend && mise exec -- npm ci && cd ..
fi

echo "=== Setup complete ==="
echo "Run 'mise run dev' to start developing"
```

## Key Design Decisions

### Why mise, not Dockerfile tool installation?

1. **Single source of truth** — `mise.toml` defines tool versions for devcontainers, CI, and local dev
2. **No Dockerfile maintenance** — tool version bumps happen in `mise.toml`, not scattered across Dockerfiles
3. **Fast rebuilds** — mise caches tools, so rebuilding the devcontainer after a version bump is fast
4. **Same versions everywhere** — developers, CI, and Codespaces all get the exact same tool versions

### Why `base:ubuntu` and not a language-specific image?

Language-specific images (e.g., `golang:1.24`) pin a single language version and make it harder to manage multiple tools. With mise, you install exactly what you need and nothing extra.

### Why `MISE_YES=1`?

Prevents mise from prompting for confirmation during automated setup. In a devcontainer, we always want to proceed.

### Why `remoteEnv.PATH`?

Adds mise shims to PATH so tools installed by mise are available in VS Code's integrated terminal and any extensions that invoke tools.

## Postgres in Devcontainers

If the project uses Postgres, add the feature:

```json
{
  "features": {
    "ghcr.io/devcontainers/features/docker-in-docker:2": {},
    "ghcr.io/itsmechlark/features/postgresql:1": {}
  }
}
```

Or run Postgres as a service via Docker Compose:

### `.devcontainer/docker-compose.yml`

```yaml
services:
  app:
    build:
      context: ..
      dockerfile: .devcontainer/Dockerfile
    volumes:
      - ..:/workspace:cached
    command: sleep infinity
    depends_on:
      - db

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  pgdata:
```

Then update `devcontainer.json`:

```json
{
  "dockerComposeFile": "docker-compose.yml",
  "service": "app",
  "workspaceFolder": "/workspace",
  "postCreateCommand": "bash .devcontainer/setup.sh",
  "containerEnv": {
    "DATABASE_DRIVER": "postgres",
    "DATABASE_URL": "postgres://dev:dev@db/app?sslmode=disable"
  }
}
```

## Devcontainer for Cloudflare Worker Projects

Simpler — no Go, no Docker-in-Docker needed:

```json
{
  "name": "<AppName>",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "features": {
    "ghcr.io/devcontainers/features/git:1": {},
    "ghcr.io/devcontainers/features/github-cli:1": {}
  },
  "postCreateCommand": "bash .devcontainer/setup.sh",
  "forwardPorts": [5173],
  "customizations": {
    "vscode": {
      "extensions": [
        "bradlc.vscode-tailwindcss",
        "esbenp.prettier-vscode",
        "dbaeumer.vscode-eslint"
      ]
    }
  },
  "containerEnv": {
    "MISE_YES": "1"
  },
  "remoteEnv": {
    "PATH": "${containerEnv:HOME}/.local/share/mise/shims:${containerEnv:PATH}"
  }
}
```

## Claude Code in Devcontainers

When Claude Code is running inside a devcontainer:

1. **mise shims are in PATH** via `remoteEnv` — so `mise exec` and `mise run` work
2. **Tools are pre-installed** via `postCreateCommand` — no waiting for installations
3. **Database is ready** — either SQLite (file-based, instant) or Postgres (via compose service)
4. **Ports are forwarded** — dev server accessible from host browser

Claude should still prefer `mise run <task>` over bare commands, but the shims mean `go test ./...` will also work in a devcontainer (it won't in a bare container without mise shims on PATH).

## Bootstrapping Checklist

When setting up a devcontainer for a new project:

1. Create `.devcontainer/devcontainer.json` with the appropriate template above
2. Create `.devcontainer/setup.sh` (make it executable: `chmod +x`)
3. Add VS Code extensions relevant to the stack
4. If Postgres: add docker-compose.yml with db service
5. Forward the right ports (8080 for Go API, 5173 for Vite, both for Go Web)
6. Test: `devcontainer build` should produce a working environment where `mise run dev` starts the app
