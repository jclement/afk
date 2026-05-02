# Security Review Skill

You are reviewing code for security vulnerabilities. This skill should be applied to **every change** that touches authentication, API endpoints, user input, data access, or configuration. When in doubt, review anyway.

## When to Run a Security Review

- Adding or modifying an API endpoint
- Changing authentication or authorization logic
- Processing user input (forms, file uploads, query parameters, request bodies)
- Writing SQL queries or database access code
- Handling secrets, tokens, or credentials
- Adding third-party dependencies
- Changing deployment configuration
- Modifying CORS, CSP, or other security headers

## The Checklist

Run through this checklist mentally for every change in scope. If a category doesn't apply to the change, skip it.

### 1. Input Validation

- [ ] All user input is validated server-side (never trust the client)
- [ ] String inputs have maximum length limits
- [ ] Numeric inputs have range validation
- [ ] Email addresses are validated with proper regex (or a library)
- [ ] File uploads: validate type (MIME + magic bytes, not just extension), enforce size limits
- [ ] URL inputs: validate scheme (reject `javascript:`, `data:` except where intended)
- [ ] No user input is directly interpolated into SQL, HTML, shell commands, or log messages

### 2. SQL Injection

- [ ] All queries use parameterized statements (`?` placeholders), never string concatenation
- [ ] Even "internal" queries that touch user-derived data use parameters
- [ ] ORM/query builder is used correctly — no raw string interpolation
- [ ] `LIKE` queries escape `%` and `_` characters in user input
- [ ] `ORDER BY` and `LIMIT` values are validated against an allowlist, not passed through

```go
// WRONG
db.Query("SELECT * FROM users WHERE name = '" + name + "'")

// RIGHT
db.Query("SELECT * FROM users WHERE name = ?", name)
```

### 3. XSS (Cross-Site Scripting)

- [ ] All user-generated content is escaped before rendering in HTML
- [ ] React's JSX auto-escaping is not bypassed with `dangerouslySetInnerHTML` (unless sanitized)
- [ ] If rendering user HTML is required, use a sanitization library (DOMPurify)
- [ ] Content-Security-Policy header restricts inline scripts and untrusted sources
- [ ] SVG uploads are sanitized (SVGs can contain JavaScript)

### 4. Authentication

- [ ] Session tokens are cryptographically random (32+ bytes)
- [ ] Session cookies: `HttpOnly`, `SameSite=Lax`, `Secure` (except localhost)
- [ ] Passwords (if used) are hashed with bcrypt/argon2, never stored in plain text
- [ ] API keys are hashed with SHA-256 before storage, plaintext shown only at creation
- [ ] Failed login attempts are rate-limited (prevent brute force)
- [ ] Session expiry is enforced server-side (don't trust cookie expiry alone)
- [ ] SUPPRESS_AUTH is only active when explicitly set, never defaults to true
- [ ] SUPPRESS_AUTH logs a visible warning on startup

### 5. Authorization

- [ ] Every API endpoint checks that the authenticated user has permission for the requested resource
- [ ] No IDOR (Insecure Direct Object Reference) — don't assume `/api/users/123` is safe because the user is logged in; verify they own or can access resource 123
- [ ] Admin-only endpoints check role, not just authentication
- [ ] API key scopes are enforced — a `read`-scoped key cannot access `write` endpoints
- [ ] File access endpoints validate path traversal (no `../../../etc/passwd`)

### 6. Secrets Management

- [ ] No secrets in code, commits, or logs
- [ ] Secrets loaded from environment variables, fnox, or GitHub Secrets
- [ ] `fnox.local.toml` and `.dev.vars` are in `.gitignore`
- [ ] Error responses never include internal details (stack traces, SQL errors, file paths)
- [ ] Health endpoints don't expose sensitive configuration
- [ ] Log output is reviewed — no session tokens, API keys, passwords, or PII in logs

### 7. HTTP Security Headers

Every web application must set these headers:

```go
w.Header().Set("X-Content-Type-Options", "nosniff")
w.Header().Set("X-Frame-Options", "DENY")
w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
w.Header().Set("X-XSS-Protection", "0")  // Disabled — modern browsers use CSP instead
w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'")
```

Adjust CSP as needed but start restrictive and loosen only when necessary.

### 8. CORS

- [ ] CORS is only enabled in development (`version == "dev"`)
- [ ] In production, same-origin policy applies (frontend embedded in binary, no CORS needed)
- [ ] If CORS is needed in production: specific origin allowlist, never `*`
- [ ] `Access-Control-Allow-Credentials` is only set with specific origins, never with `*`

### 9. Rate Limiting

- [ ] Auth endpoints (login, register, password reset) are rate-limited
- [ ] API endpoints have per-key rate limits
- [ ] Rate limit responses include `Retry-After` header
- [ ] Rate limiting is per-IP for unauthenticated endpoints, per-user/key for authenticated

### 10. Dependency Security

- [ ] New dependencies are from well-known, maintained sources
- [ ] Dependabot is configured for automated vulnerability alerts
- [ ] No dependency is pulled from a URL that could be compromised
- [ ] Import paths match the canonical source (prevent typosquatting)

### 11. Cryptography

- [ ] Using standard library or well-known libraries for crypto (never roll your own)
- [ ] Token comparisons use constant-time comparison (`crypto/subtle.ConstantTimeCompare`)
- [ ] Random tokens use `crypto/rand`, never `math/rand`
- [ ] TLS/HTTPS enforced in production (via `Secure` cookie flag and redirect)

### 12. File Operations

- [ ] File paths are validated against path traversal (`..` sequences)
- [ ] File uploads: size limits enforced server-side, stored outside web root
- [ ] Temp files are cleaned up (use `defer os.Remove()`)
- [ ] File permissions are set explicitly (0o600 for secrets, 0o755 for executables)

## Security Patterns by Stack

### Go Web
- Use `net/http` middleware for security headers (applied to all routes)
- `database/sql` with `?` placeholders prevents SQL injection
- `html/template` auto-escapes HTML (use it for any server-rendered content)
- `crypto/rand.Read()` for token generation

### Cloudflare Workers / Bun
- Use `crypto.randomUUID()` or `crypto.getRandomValues()` for tokens
- D1 parameterized queries (`db.prepare("...").bind(...)`) prevent SQL injection
- React's JSX auto-escaping handles most XSS
- `Hono` middleware for headers and CORS

### CLI / TUI
- Never execute user input as shell commands
- Validate file paths from user input
- When downloading updates: verify checksums and signatures (see `auto-update.md`)
- Config files: validate all fields, reject unknown keys

## What to Do When You Find an Issue

1. **Fix it immediately.** Don't file it for later.
2. **Add a test** that would catch the vulnerability.
3. **Check for the same pattern elsewhere** in the codebase — vulnerabilities often appear in clusters.
4. **Note it in the commit message** — "fix: prevent SQL injection in search handler" helps with audit trails.
