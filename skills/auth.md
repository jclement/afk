# Authentication Skill

You are implementing authentication for this application. Follow these patterns.

## SUPPRESS_AUTH — Development Bypass

**Every app must support a `SUPPRESS_AUTH` environment variable.** When set to `"true"`:

- Skip all authentication checks
- Auto-authenticate as a well-known developer user:
  - ID: `00000000-0000-0000-0000-000000000000`
  - Username: `developer`
  - Display name: `Developer`
  - Role: `admin` (full access for testing)
- Create the developer user automatically on first request if it doesn't exist
- Log a warning on startup: `⚠ SUPPRESS_AUTH=true — authentication disabled, auto-login as developer`

**Set via:** `mise.local.toml` (gitignored) with `SUPPRESS_AUTH = "true"` in the `[env]` section, or `.dev.vars` for Cloudflare Workers. Never commit this value as `true`.

This makes development and testing frictionless — no need to register/login during development.

## Auth Methods — Pick One Per Project

### 1. Passkeys / WebAuthn (Default Choice)

**Go backend:** [`go-webauthn/webauthn`](https://github.com/go-webauthn/webauthn)
**Cloudflare Worker:** `@simplewebauthn/server` + `@simplewebauthn/browser`

- Registration flow: username → create credential → store public key
- Login flow: start assertion → sign challenge → verify → create session
- Store challenges in KV/cache with 5-minute TTL
- Store credentials in the database (user_id, credential_id, public_key, sign_count)
- Support multiple passkeys per user (manage in Settings > Security)

Config env vars:
- `RP_ID` — relying party ID (e.g., `myapp.example.com`)
- `RP_ORIGIN` — relying party origin (e.g., `https://myapp.example.com`)

### 2. Email Magic Link

- User enters email → server generates a one-time token (crypto random, 32 bytes hex)
- Token stored in DB/KV with 15-minute TTL, tied to email
- Send email via configured provider (Mailgun, SES, Resend, etc.)
- User clicks link → server validates token → creates session → deletes token
- Rate limit: max 3 magic links per email per hour

Config env vars:
- `MAIL_PROVIDER` — `mailgun`, `ses`, `resend`
- `MAIL_API_KEY` — provider API key
- `MAIL_FROM` — sender address (e.g., `auth@myapp.example.com`)
- `MAIL_DOMAIN` — domain for Mailgun

### 3. OIDC (OpenID Connect)

For enterprise SSO and existing identity providers.

**Required env vars — prompt the user for all of these:**

| Variable | Description | Example |
|----------|-------------|---------|
| `OIDC_CLIENT_ID` | OAuth client ID | `abc123` |
| `OIDC_CLIENT_SECRET` | OAuth client secret | `secret_xyz` |
| `OIDC_ISSUER_URL` | Issuer URL (used for discovery) | `https://accounts.google.com` |
| `OIDC_AUTH_URL` | Authorization endpoint (if not using discovery) | `https://idp.example.com/authorize` |
| `OIDC_TOKEN_URL` | Token endpoint (if not using discovery) | `https://idp.example.com/token` |
| `OIDC_USERINFO_URL` | UserInfo endpoint (optional, if not in ID token) | `https://idp.example.com/userinfo` |
| `OIDC_REDIRECT_URL` | Callback URL for your app | `https://myapp.example.com/auth/callback` |
| `OIDC_SCOPES` | Scopes to request | `openid profile email` |
| `OIDC_NAME_CLAIM` | JWT claim for display name | `name` or `preferred_username` |
| `OIDC_EMAIL_CLAIM` | JWT claim for email | `email` |
| `OIDC_ALLOWED_DOMAINS` | Comma-separated allowed email domains (optional) | `example.com,corp.example.com` |
| `OIDC_ALLOWED_GROUPS` | Comma-separated allowed groups claim values (optional) | `app-users,admins` |
| `OIDC_GROUPS_CLAIM` | JWT claim for group membership (optional) | `groups` |

**Flow:**
1. Redirect to `OIDC_AUTH_URL` with client_id, redirect_uri, scopes, state, nonce
2. User authenticates with IdP
3. Callback receives authorization code
4. Exchange code for tokens at `OIDC_TOKEN_URL`
5. Validate ID token: check issuer, audience, expiry, nonce, signature (via JWKS)
6. Extract name from `OIDC_NAME_CLAIM`, email from `OIDC_EMAIL_CLAIM`
7. Optionally validate domain and group membership
8. Create or update local user record, create session

**Validation:**
- Always verify the ID token signature against the provider's JWKS
- Validate `iss`, `aud`, `exp`, `nonce` claims
- If `OIDC_ALLOWED_DOMAINS` is set, reject emails not in the list
- If `OIDC_ALLOWED_GROUPS` is set, check the groups claim
- Use PKCE (S256) for public clients

**Go library:** Standard `golang.org/x/oauth2` + manual OIDC validation, or [`coreos/go-oidc`](https://github.com/coreos/go-oidc)

## Sessions

- Server-side sessions stored in database (SQLite/Postgres) or KV store
- Session token: `crypto.randomUUID()` or 32 bytes of crypto random hex
- Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` (except localhost)
- Max age: 30 days, refreshed on activity
- Background cleanup goroutine for expired sessions (Go), or KV TTL (Cloudflare)
- Store: session_id (PK), user_id, created_at, expires_at, last_seen_at, ip_address, user_agent

## Auth Middleware Pattern

```
Request → Check SUPPRESS_AUTH → auto-auth if true
        → Parse session cookie
        → Validate session in store
        → Set user context (userId, username, role)
        → 401 if invalid
```

Skip auth for public routes: health check, login, register, auth callbacks, static assets.

## User Model (minimum)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- UUID
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',  -- 'user' or 'admin'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
```

## Security Rules

1. Never log session tokens, passwords, or secrets
2. Rate limit auth endpoints (login, register, magic link send)
3. Hash API keys with SHA-256 before storing
4. Session tokens must be cryptographically random
5. Always validate server-side — never trust the client
6. Use constant-time comparison for token validation
7. Set security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
