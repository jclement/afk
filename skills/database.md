# Database Skill

You are setting up the database layer for an application. Default to SQLite for development and most deployments. Support Postgres for larger installs.

## Default: SQLite

SQLite is the right choice for most self-hosted applications. Single file, zero config, embedded in the binary.

### Go — Pure Go SQLite (CGO=0)

Use [`modernc.org/sqlite`](https://pkg.go.dev/modernc.org/sqlite) — pure Go, no CGO required.

```go
import (
    "database/sql"
    _ "modernc.org/sqlite"
)

func OpenSQLite(path string) (*sql.DB, error) {
    db, err := sql.Open("sqlite", path)
    if err != nil {
        return nil, err
    }
    // WAL mode for concurrent reads
    db.Exec("PRAGMA journal_mode=WAL")
    // 5 second busy timeout
    db.Exec("PRAGMA busy_timeout=5000")
    // Foreign keys on
    db.Exec("PRAGMA foreign_keys=ON")
    // Single write connection
    db.SetMaxOpenConns(1)
    return db, nil
}
```

### Cloudflare/Bun — bun:sqlite or D1

- **Self-hosted (Bun):** `bun:sqlite` — built into Bun runtime
- **Cloudflare Workers:** D1 (SQLite at the edge)

## Postgres Option

When the app needs to scale beyond SQLite (high write concurrency, multiple app instances, large datasets).

### Go — pgx

Use [`pgx`](https://github.com/jackc/pgx) — the best Go PostgreSQL driver.

```go
import "github.com/jackc/pgx/v5/pgxpool"

func OpenPostgres(connString string) (*pgxpool.Pool, error) {
    config, err := pgxpool.ParseConfig(connString)
    if err != nil {
        return nil, err
    }
    config.MaxConns = 25
    config.MinConns = 5
    return pgxpool.NewWithConfig(context.Background(), config)
}
```

### Driver Selection via Environment

```go
// Select database driver based on DATABASE_DRIVER env var
switch os.Getenv("DATABASE_DRIVER") {
case "postgres":
    db, err = OpenPostgres(os.Getenv("DATABASE_URL"))
case "sqlite", "":
    db, err = OpenSQLite(os.Getenv("DATABASE_URL"))
default:
    log.Fatal("unsupported DATABASE_DRIVER")
}
```

| Env Var | Description | Default |
|---------|-------------|---------|
| `DATABASE_DRIVER` | `sqlite` or `postgres` | `sqlite` |
| `DATABASE_URL` | Connection string or file path | `./<appname>.db` |

## Migrations — Built-In, Auto-Run

Use [`golang-migrate`](https://github.com/golang-migrate/migrate) with embedded SQL migrations.

### Directory Structure

```
migrations/
  sqlite/
    001_initial.up.sql
    001_initial.down.sql
    002_add_users.up.sql
    002_add_users.down.sql
  postgres/
    001_initial.up.sql
    001_initial.down.sql
    002_add_users.up.sql
    002_add_users.down.sql
  embed.go
```

### Embedding Migrations

```go
// migrations/embed.go
package migrations

import "embed"

//go:embed sqlite/*.sql
var SQLiteFS embed.FS

//go:embed postgres/*.sql
var PostgresFS embed.FS
```

### Auto-Run on Startup

Migrations run automatically when the application starts. No manual migration step required.

```go
import (
    "github.com/golang-migrate/migrate/v4"
    "github.com/golang-migrate/migrate/v4/source/iofs"
    _ "github.com/golang-migrate/migrate/v4/database/sqlite"
    _ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
)

func RunMigrations(db *sql.DB, driver string) error {
    var fs embed.FS
    var subdir string
    switch driver {
    case "sqlite":
        fs = migrations.SQLiteFS
        subdir = "sqlite"
    case "postgres":
        fs = migrations.PostgresFS
        subdir = "postgres"
    }
    source, err := iofs.New(fs, subdir)
    // ... create migrator, run m.Up()
    // migrate.ErrNoChange is not an error
}
```

### Mise Tasks for Migrations

```toml
[tasks."db:migrate"]
description = "Apply database migrations"
run = "go run ./cmd/<appname> migrate"

[tasks."db:new"]
description = "Create new migration files"
run = """
#!/bin/bash
if [ -z "$1" ]; then echo "Usage: mise run db:new <name>"; exit 1; fi
next=$(ls migrations/sqlite/*.up.sql 2>/dev/null | wc -l | tr -d ' ')
next=$((next + 1))
num=$(printf "%03d" $next)
touch "migrations/sqlite/${num}_$1.up.sql"
touch "migrations/sqlite/${num}_$1.down.sql"
touch "migrations/postgres/${num}_$1.up.sql"
touch "migrations/postgres/${num}_$1.down.sql"
echo "Created migration ${num}_$1"
"""
```

## Writing Portable SQL

When supporting both SQLite and Postgres, keep SQL compatible:

### Safe to use in both:
- `TEXT`, `INTEGER`, `REAL`, `BLOB` types
- `CREATE TABLE IF NOT EXISTS`
- `INSERT INTO ... ON CONFLICT DO UPDATE` (upsert)
- `COALESCE()`, `NULLIF()`, `CASE WHEN`
- `ORDER BY`, `LIMIT`, `OFFSET`
- Standard joins, subqueries, CTEs

### Differences to watch:

| Feature | SQLite | Postgres |
|---------|--------|----------|
| Auto-increment PK | `INTEGER PRIMARY KEY` | `SERIAL` or `GENERATED ALWAYS AS IDENTITY` |
| UUID generation | Application-side | `gen_random_uuid()` |
| Timestamps | `TEXT` with `datetime('now')` | `TIMESTAMPTZ` with `NOW()` |
| Boolean | `INTEGER` (0/1) | `BOOLEAN` |
| JSON | `TEXT` + `json_extract()` | `JSONB` + `->`, `->>` |
| String concat | `\|\|` | `\|\|` |
| RETURNING clause | Supported (3.35+) | Supported |

**Best practice:** Use `TEXT` for UUIDs (both), generate UUIDs in application code, store timestamps as ISO 8601 TEXT (SQLite) or TIMESTAMPTZ (Postgres).

## Postgres in Containers

When Claude is running in a container and the app needs Postgres:

### Install and Start Postgres

```bash
# Install
apt-get update && apt-get install -y postgresql postgresql-client

# Start the service
pg_ctlcluster $(pg_lsclusters -h | head -1 | awk '{print $1, $2}') start

# Create database and user
su - postgres -c "createuser --superuser $(whoami) 2>/dev/null || true"
su - postgres -c "createdb <appname> 2>/dev/null || true"
```

Or more simply with a mise task:

```toml
[tasks."db:start"]
description = "Start local Postgres (container environments)"
run = """
#!/bin/bash
set -e
if ! command -v pg_isready &>/dev/null; then
  sudo apt-get update && sudo apt-get install -y postgresql postgresql-client
fi
sudo pg_ctlcluster $(pg_lsclusters -h | head -1 | awk '{print $1, $2}') start 2>/dev/null || true
sudo -u postgres createuser --superuser $(whoami) 2>/dev/null || true
sudo -u postgres createdb <appname> 2>/dev/null || true
echo "Postgres ready: DATABASE_URL=postgres://localhost/<appname>?sslmode=disable"
"""
```

### Environment Setup

```toml
# mise.toml for Postgres development
[env]
DATABASE_DRIVER = "postgres"
DATABASE_URL = "postgres://localhost/<appname>?sslmode=disable"
```

## Cloudflare/Bun Migration Pattern

For non-Go projects, use a simpler numbered migration system:

```
migrations/
  0001_initial.sql
  0002_add_users.sql
  0003_add_api_keys.sql
```

Track applied migrations in a `_migrations` table:

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Run migrations on startup by reading the directory, sorting by filename, and applying any not yet in `_migrations`.

## Store/Repository Pattern

Wrap database access in a store layer:

```go
type Store struct {
    db *sql.DB
}

func (s *Store) GetUser(ctx context.Context, id string) (*User, error) { ... }
func (s *Store) ListUsers(ctx context.Context) ([]User, error) { ... }
func (s *Store) CreateUser(ctx context.Context, u *User) error { ... }
```

This keeps SQL out of handlers and makes the database swappable.

## Backup Strategy

### SQLite — Litestream

For production SQLite, use [Litestream](https://litestream.io/) for continuous replication to S3/R2:

```yaml
# litestream.yml
dbs:
  - path: /data/<appname>.db
    replicas:
      - url: s3://<bucket>/<appname>.db
```

### Postgres — pg_dump

Standard `pg_dump` for backups, or managed Postgres backups.
