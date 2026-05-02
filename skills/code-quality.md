# Code Quality & Readability Skill

You are writing code that **human Jeff** needs to understand, maintain, and modify six months from now. Optimize for clarity over cleverness. Code is read far more often than it is written.

## The Readability Standard

If Jeff opens a file he hasn't touched in six months, he should be able to understand:
1. **What** this file does (top-of-file comment)
2. **Why** non-obvious decisions were made (inline comments)
3. **How** to modify it without breaking things (clear structure + tests)

## File-Level Documentation

### Every File Gets a Top-of-File Comment

Explain what this module does and why it exists. Not a restatement of the filename — actual context.

**Go:**
```go
// Package store provides the database access layer for the application.
// All SQL queries live here — handlers never touch the database directly.
// Supports both SQLite and Postgres via the database/sql interface.
package store
```

**TypeScript:**
```typescript
/**
 * @module api/hooks
 *
 * React Query hooks for all API endpoints. Every backend call goes through
 * a hook defined here — components never call fetch() directly.
 *
 * Pattern: useQuery for reads, useMutation for writes. All mutations
 * invalidate the relevant query cache on success.
 */
```

### Section Headers for Large Files

Files with multiple logical sections get dividers:

**Go:**
```go
// ---------------------------------------------------------------------------
// User CRUD
// ---------------------------------------------------------------------------

func (s *Store) GetUser(ctx context.Context, id string) (*User, error) { ... }
func (s *Store) CreateUser(ctx context.Context, u *User) error { ... }

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

func (s *Store) CreateSession(ctx context.Context, userId string) (string, error) { ... }
```

**TypeScript (route handlers):**
```typescript
// ---------------------------------------------------------------------------
// GET /api/v1/entities — list entities with their attributes for a project
// ---------------------------------------------------------------------------
```

## Function-Level Documentation

### Every Exported Function Gets a Doc Comment

Describe what it does, not how. Include parameter meaning if not obvious from the name. Include return value semantics.

**Go:**
```go
// ValidateAPIKey checks the provided plaintext key against stored hashes.
// Returns the associated user if the key is valid, not expired, and not revoked.
// Returns an error describing the specific failure (expired, revoked, not found).
func ValidateAPIKey(plaintext string) (*User, error) {
```

**TypeScript:**
```typescript
/**
 * Create a new API key for the authenticated user.
 *
 * The plaintext key is included in the response ONCE — it is not stored
 * and cannot be retrieved later. The caller must present it to the user
 * immediately.
 *
 * @returns The created key metadata plus the plaintext key
 */
export async function createAPIKey(name: string, scopes: string[], expiresAt?: Date): Promise<APIKeyWithPlaintext> {
```

### Internal Helpers — Comment When Non-Obvious

Don't document trivial helpers. Do document anything where the *why* isn't clear from the code:

```go
// normalizeEmail lowercases and trims the email address. We also strip dots
// from the local part for Gmail addresses, where "j.eff" and "jeff" are the
// same mailbox — this prevents duplicate account creation.
func normalizeEmail(email string) string {
```

## Inline Comments — The Why, Not the What

```go
// BAD: increment counter
counter++

// BAD: check if user is admin
if user.Role == "admin" {

// GOOD: Rate limit check uses a 5-minute sliding window. We chose 5 minutes
// (not per-second) because legitimate users often retry failed logins
// quickly, and we don't want to lock them out for typos.
if !rateLimiter.Allow(ip, 5*time.Minute, 10) {

// GOOD: We use a separate write connection with MaxOpenConns(1) because
// SQLite only supports one writer at a time. Reads use a separate pool.
db.SetMaxOpenConns(1)
```

## Naming Conventions

### Be Descriptive, Not Clever

```go
// BAD
func proc(d []byte) (*R, error) {
u := getU()
ts := time.Now().Unix()

// GOOD
func processWebhookPayload(data []byte) (*WebhookResult, error) {
currentUser := getCurrentUser()
createdAt := time.Now().Unix()
```

### Accepted Abbreviations

These are fine — everything else should be spelled out:

| Abbreviation | Meaning |
|-------------|---------|
| `id` | Identifier |
| `db` | Database |
| `ctx` | Context |
| `req`, `res` | Request, Response |
| `err` | Error |
| `env` | Environment |
| `config`, `cfg` | Configuration |
| `fn` | Function (as a parameter) |
| `tx` | Transaction |
| `w`, `r` | http.ResponseWriter, *http.Request (Go convention) |
| `t` | *testing.T (Go convention) |

## Code Structure

### Keep Functions Short and Focused

Aim for functions under ~40 lines. If a function exceeds this, look for logical sub-steps to extract. Each function should do one thing.

### Use Early Returns

```go
// BAD: deeply nested
func handleRequest(r *Request) (*Response, error) {
    if r.Valid() {
        user, err := getUser(r.UserID)
        if err == nil {
            if user.Active {
                // ... actual logic buried 3 levels deep
            }
        }
    }
}

// GOOD: flat with early returns
func handleRequest(r *Request) (*Response, error) {
    if !r.Valid() {
        return nil, errors.New("invalid request")
    }
    user, err := getUser(r.UserID)
    if err != nil {
        return nil, fmt.Errorf("fetching user: %w", err)
    }
    if !user.Active {
        return nil, errors.New("user inactive")
    }
    // ... actual logic at the top level
}
```

### Group Related Code

Use blank lines and section dividers to create visual structure. Related functions should be adjacent in the file. The file should read top-to-bottom in a logical order.

### Explicit Over Implicit

```go
// BAD: magic number
time.Sleep(5000 * time.Millisecond)

// GOOD: named constant with explanation
const gracefulShutdownTimeout = 30 * time.Second
```

```typescript
// BAD: anonymous object shape
function createUser(data: { n: string, e: string, r: string }) {

// GOOD: named type with clear fields
interface CreateUserRequest {
  username: string;
  email: string;
  role: "user" | "admin";
}
function createUser(data: CreateUserRequest) {
```

## Error Messages

Error messages should help the developer (or user) understand what went wrong and what to do about it:

```go
// BAD
return errors.New("failed")
return fmt.Errorf("error: %w", err)

// GOOD — says what was being done, wraps the underlying error
return fmt.Errorf("creating user %q: %w", username, err)
return fmt.Errorf("applying migration %s: %w", filename, err)
```

For user-facing errors, be helpful:
```
"Email address is already registered. Try logging in instead."
"API key has expired. Create a new one in Settings > API Keys."
```

## Type Definitions Document the Domain

Types are documentation. Use them to make the domain model explicit:

```go
// User represents an authenticated user of the application.
type User struct {
    ID          string    `json:"id"`           // UUID, generated on creation
    Username    string    `json:"username"`      // Unique, user-chosen
    Email       string    `json:"email"`         // Unique, used for notifications
    DisplayName string    `json:"display_name"`  // Shown in the UI
    Role        string    `json:"role"`          // "user" or "admin"
    CreatedAt   time.Time `json:"created_at"`
    LastLoginAt time.Time `json:"last_login_at"` // Updated on each successful auth
}
```

## Consistency Rules

1. **Match existing patterns.** If the codebase uses `getUser`/`createUser`, don't introduce `fetchUser`/`addUser`.
2. **One pattern per concern.** Don't have some handlers using `c.JSON()` and others using `writeJSON()`.
3. **Same error handling everywhere.** If the pattern is `if err != nil { return fmt.Errorf("doing X: %w", err) }`, use it everywhere.
4. **Same file organization everywhere.** If handler files have section headers, all handler files have section headers.

## Code Review Checklist (Before Committing)

1. Can Jeff understand each file's purpose from its top-of-file comment?
2. Are non-obvious decisions explained with *why* comments?
3. Are all exported functions/types documented?
4. Are variable names descriptive (not abbreviated beyond the accepted list)?
5. Are functions under ~40 lines? If not, can they be decomposed?
6. Do error messages say what was being done and what went wrong?
7. Is the code formatted? (`mise run fmt`)
8. Are there any TODO or FIXME comments that should be addressed now?
