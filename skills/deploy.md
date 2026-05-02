# Deployment Skill

You are setting up CI/CD and release infrastructure. Everything runs through GitHub Actions and uses tags for releases.

## Principles

- **GitHub Actions for everything** — CI, releases, deploys
- **Tags trigger releases** — push `v*` tag to release
- **`mise run release`** — interactive version bump (patch/minor/major), tag, push
- **GoReleaser** for Go projects — binaries, Docker images, Homebrew tap
- **Cosign** for signing — keyless via GitHub OIDC, verify with Sigstore
- **`jdx/mise-action@v2`** in all workflows for consistent tool setup

## CI Workflow (All Projects)

File: `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v2
        with: { experimental: true }
      - run: mise run lint
      - run: mise run build
      - run: mise run test
```

For Node projects, add `npm ci` before lint/build/test.
For Go projects, add `go mod download` before lint/build/test.

## Release Workflow — Go Projects (GoReleaser + Cosign)

File: `.github/workflows/release.yml`

```yaml
name: Release
on:
  push:
    tags: ["v*"]

permissions:
  contents: write
  packages: write
  id-token: write  # Required for cosign OIDC keyless signing

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: jdx/mise-action@v2
        with: { experimental: true }
      - uses: sigstore/cosign-installer@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: goreleaser/goreleaser-action@v6
        with:
          version: latest
          args: release --clean
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          HOMEBREW_TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
```

**Key points:**
- `id-token: write` is required for cosign keyless signing via GitHub OIDC
- `sigstore/cosign-installer@v3` must run before GoReleaser
- `fetch-depth: 0` is required for GoReleaser changelog generation

## GoReleaser Configuration

File: `.goreleaser.yaml`

```yaml
version: 2
project_name: <appname>

before:
  hooks:
    - go mod tidy

builds:
  - main: ./cmd/<appname>
    binary: <appname>
    env: [CGO_ENABLED=0]
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]
    ldflags:
      - -s -w -X main.version={{.Version}} -X main.commit={{.ShortCommit}} -X main.date={{.Date}}

archives:
  - format: tar.gz
    name_template: "{{ .ProjectName }}_{{ .Os }}_{{ .Arch }}"
    format_overrides:
      - goos: windows
        format: zip

brews:
  - repository:
      owner: jclement
      name: homebrew-tap
      token: "{{ .Env.HOMEBREW_TAP_TOKEN }}"
    homepage: "https://github.com/jclement/{{ .ProjectName }}"
    description: "<one-line description>"
    install: |
      bin.install "<appname>"

signs:
  - cmd: cosign
    artifacts: checksum
    args:
      - "sign-blob"
      - "--yes"
      - "--bundle=${signature}.sigstore.json"
      - "--output-signature=${signature}"
      - "${artifact}"

docker_signs:
  - cmd: cosign
    args:
      - "sign"
      - "--yes"
      - "${artifact}"

dockers:
  - goos: linux
    goarch: amd64
    dockerfile: Dockerfile.goreleaser
    use: buildx
    build_flag_templates: ["--platform=linux/amd64"]
    image_templates:
      - "ghcr.io/jclement/{{ .ProjectName }}:{{ .Version }}-amd64"
      - "ghcr.io/jclement/{{ .ProjectName }}:latest-amd64"
  - goos: linux
    goarch: arm64
    dockerfile: Dockerfile.goreleaser
    use: buildx
    build_flag_templates: ["--platform=linux/arm64"]
    image_templates:
      - "ghcr.io/jclement/{{ .ProjectName }}:{{ .Version }}-arm64"
      - "ghcr.io/jclement/{{ .ProjectName }}:latest-arm64"

docker_manifests:
  - name_template: "ghcr.io/jclement/{{ .ProjectName }}:{{ .Version }}"
    image_templates:
      - "ghcr.io/jclement/{{ .ProjectName }}:{{ .Version }}-amd64"
      - "ghcr.io/jclement/{{ .ProjectName }}:{{ .Version }}-arm64"
  - name_template: "ghcr.io/jclement/{{ .ProjectName }}:latest"
    image_templates:
      - "ghcr.io/jclement/{{ .ProjectName }}:latest-amd64"
      - "ghcr.io/jclement/{{ .ProjectName }}:latest-arm64"

changelog:
  sort: asc
  filters:
    exclude: ["^docs:", "^test:", "^ci:", "^chore:"]

release:
  prerelease: auto
  footer: |
    ## Docker
    ```bash
    docker pull ghcr.io/jclement/{{ .ProjectName }}:{{ .Version }}
    ```
```

## Dockerfile Patterns

### Standard Dockerfile (multi-stage)

```dockerfile
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /app ./cmd/<appname>

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /app /usr/local/bin/<appname>
ENTRYPOINT ["<appname>"]
```

### Dockerfile.goreleaser (for GoReleaser builds)

```dockerfile
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
COPY <appname> /usr/local/bin/<appname>
ENTRYPOINT ["<appname>"]
```

## Release Task (mise)

```toml
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

## Release Workflow — Cloudflare Projects

```yaml
name: Deploy
on:
  push:
    tags: ["v*"]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v2
      - run: npm ci
      - run: npm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: d1 migrations apply <appname>-db --remote
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

## Dependabot

File: `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: gomod
    directory: /
    schedule: { interval: weekly }
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
  - package-ecosystem: docker
    directory: /
    schedule: { interval: weekly }
```

Add `npm` ecosystem if the project has a `package.json`.

## Docker Compose Patterns

### Development (SQLite)
```yaml
services:
  app:
    image: ghcr.io/jclement/<appname>:latest
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    environment:
      DATABASE_URL: /data/<appname>.db
```

### Production (with Cloudflare Tunnel + Litestream)
```yaml
services:
  app:
    image: ghcr.io/jclement/<appname>:latest
    volumes: ["./data:/data"]
    environment:
      DATABASE_URL: /data/<appname>.db
  tunnel:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
```
