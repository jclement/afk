# Web API Skill

You are building a public-facing API with key management, documentation, and LLM-friendly specs.

## API Key Management

Users in the system can create and manage time-limited API keys through the UI.

### API Key Model

```sql
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,                    -- UUID
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,                     -- User-defined label ("CI bot", "Mobile app")
  key_hash TEXT NOT NULL,                 -- SHA-256 hash of the key (NEVER store plaintext)
  key_prefix TEXT NOT NULL,               -- First 8 chars for identification (e.g., "sk_a1b2c3d4")
  scopes TEXT NOT NULL DEFAULT '*',       -- Comma-separated: 'read', 'write', 'admin', or '*'
  expires_at TEXT,                        -- NULL = never expires, otherwise ISO 8601
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT                         -- Non-null = revoked
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
```

### Key Generation

```go
// Generate a new API key
func GenerateAPIKey() (plaintext, hash, prefix string) {
    // 32 bytes of crypto random = 256 bits of entropy
    raw := make([]byte, 32)
    crypto_rand.Read(raw)

    plaintext = "sk_" + hex.EncodeToString(raw)  // sk_ prefix for identification
    prefix = plaintext[:11]                        // "sk_a1b2c3d4" for display

    h := sha256.Sum256([]byte(plaintext))
    hash = hex.EncodeToString(h[:])

    return plaintext, hash, prefix
}
```

**Critical:** The plaintext key is shown ONCE at creation time. After that, only the hash and prefix are stored. The user must copy the key immediately.

### Key Lifecycle

1. **Create**: User names the key, sets optional expiry and scopes → show plaintext once
2. **List**: Show name, prefix, scopes, created, last used, expires — never the full key
3. **Revoke**: Soft-delete (set `revoked_at`) — don't hard delete for audit trail
4. **Auto-expire**: Background job or check-on-use for expired keys

### API Key UI (Settings > API Keys)

- Table showing: Name, Key (prefix only: `sk_a1b2...`), Scopes, Created, Last Used, Expires, Actions
- "Create API Key" button opens modal:
  - Name (required)
  - Expiry: dropdown — 30 days, 90 days, 1 year, Never
  - Scopes: checkboxes — Read, Write, Admin
- After creation: modal with the full key and a "Copy" button, warning that it won't be shown again
- Revoke button with confirmation modal

## API Authentication

API routes accept either:
1. **Session cookie** (for browser/UI requests)
2. **`Authorization: Bearer <api_key>`** header (for API consumers)

```go
func authMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Check SUPPRESS_AUTH first
        if os.Getenv("SUPPRESS_AUTH") == "true" {
            setDevUser(r)
            next.ServeHTTP(w, r)
            return
        }

        // Try Bearer token first
        if token := extractBearerToken(r); token != "" {
            user, err := validateAPIKey(token)
            if err != nil {
                writeJSON(w, 401, errorResponse("Invalid or expired API key"))
                return
            }
            setUser(r, user)
            next.ServeHTTP(w, r)
            return
        }

        // Fall back to session cookie
        user, err := validateSession(r)
        if err != nil {
            writeJSON(w, 401, errorResponse("Authentication required"))
            return
        }
        setUser(r, user)
        next.ServeHTTP(w, r)
    })
}
```

### Key Validation

```go
func validateAPIKey(plaintext string) (*User, error) {
    h := sha256.Sum256([]byte(plaintext))
    hash := hex.EncodeToString(h[:])

    key, err := store.GetAPIKeyByHash(hash)
    if err != nil { return nil, err }
    if key.RevokedAt != nil { return nil, errors.New("key revoked") }
    if key.ExpiresAt != nil && time.Now().After(*key.ExpiresAt) {
        return nil, errors.New("key expired")
    }

    // Update last_used_at (non-blocking)
    go store.UpdateAPIKeyLastUsed(key.ID)

    return store.GetUser(key.UserID)
}
```

## API Response Format

Consistent envelope format:

```json
// Success
{
  "data": { ... }
}

// Success (list)
{
  "data": [ ... ],
  "meta": {
    "total": 42,
    "page": 1,
    "per_page": 25
  }
}

// Error
{
  "error": {
    "message": "Human-readable error message",
    "code": "MACHINE_READABLE_CODE"
  }
}
```

### Standard Error Codes

| HTTP Status | Code | When |
|-------------|------|------|
| 400 | `VALIDATION_ERROR` | Invalid input |
| 401 | `UNAUTHORIZED` | Missing or invalid auth |
| 403 | `FORBIDDEN` | Valid auth, insufficient permissions |
| 404 | `NOT_FOUND` | Resource doesn't exist |
| 409 | `CONFLICT` | Duplicate or conflicting state |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |

## OpenAPI / Swagger Documentation

### Go Projects — OpenAPI-First

Use the OpenAPI spec as the source of truth:

```
api/openapi.yaml → oapi-codegen → Go types + strict server interface
                 → openapi-typescript + openapi-fetch → TypeScript client
```

1. Write `api/openapi.yaml` (OpenAPI 3.1)
2. Generate Go server types: [`oapi-codegen`](https://github.com/oapi-codegen/oapi-codegen)
3. Generate TypeScript client: [`openapi-typescript`](https://openapi-ts.dev/) + [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/)

```go
// api/generate.go
//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen --config=config.yaml openapi.yaml
```

### TypeScript/Bun Projects

Write the OpenAPI spec manually or generate from route definitions using a library like `hono-openapi`.

### Serving the Spec

- `GET /api/docs` — Swagger UI (interactive API explorer)
- `GET /api/openapi.yaml` — raw OpenAPI spec (for LLMs and tooling)
- `GET /api/openapi.json` — JSON format of the spec

### Swagger UI

Embed Swagger UI for interactive documentation:

```go
// Serve Swagger UI at /api/docs
// Use swagger-ui-dist npm package or CDN
http.Handle("/api/docs/", http.StripPrefix("/api/docs/",
    http.FileServer(http.Dir("api/swagger-ui"))))
```

Or for simplicity, use a CDN-loaded single HTML page:

```html
<!DOCTYPE html>
<html>
<head>
  <title>API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: "/api/openapi.yaml", dom_id: "#swagger-ui" });
  </script>
</body>
</html>
```

### LLM-Friendly Documentation

The OpenAPI spec at `/api/openapi.yaml` should be comprehensive enough that an LLM can use it to automate the API:

1. **Descriptive operation summaries and descriptions** — not just "Get users" but "List all users in the organization, with optional filtering by role and search by name or email"
2. **Complete request/response examples** for every endpoint
3. **Authentication section** documenting both session cookie and API key methods
4. **Error response schemas** with all possible error codes
5. **Pagination parameters** documented with defaults and limits

### OpenAPI Spec Structure

```yaml
openapi: "3.1.0"
info:
  title: <AppName> API
  version: "1.0.0"
  description: |
    API for <AppName>. Authenticate with either a session cookie (browser)
    or an API key via the Authorization header: `Authorization: Bearer sk_...`

    API keys can be created and managed at /settings/api-keys.

servers:
  - url: /api/v1
    description: API v1

security:
  - bearerAuth: []
  - cookieAuth: []

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: "API key (starts with sk_)"
    cookieAuth:
      type: apiKey
      in: cookie
      name: session

  schemas:
    Error:
      type: object
      properties:
        error:
          type: object
          properties:
            message: { type: string }
            code: { type: string }

paths:
  /users:
    get:
      summary: List users
      # ... complete definitions
```

## API Versioning

- Prefix routes with `/api/v1/`
- Version in the URL, not headers
- When breaking changes are needed, add `/api/v2/` routes alongside v1

## Rate Limiting

- In-memory sliding window on auth endpoints (login, register)
- Per-API-key rate limits: store in config or database
- Return `429 Too Many Requests` with `Retry-After` header
- Default: 100 requests/minute per API key, 1000/hour

## Health Endpoint

```
GET /api/v1/health
```

```json
{
  "status": "ok",
  "version": "v1.2.3",
  "update_available": "v1.3.0"
}
```

No authentication required. Used by monitoring, load balancers, and the UI footer.
