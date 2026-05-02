# Testing Skill

You are writing and running tests. **Every code change must be validated by running tests.** It is unacceptable to generate code that fails tests or linting.

## Core Rules

1. **Run tests after every change.** Not at the end — after each logical change.
2. **Run linters after every change.** `go vet`, `staticcheck`, `go fmt`, `tsc --noEmit`, `eslint`.
3. **Fix failures immediately.** Never leave failing tests or lint errors for later. If a test breaks, **stop all other work** and fix it before writing any more code. Do not push forward with a broken test suite.
4. **Add tests for every feature and bugfix.** No exceptions.
5. **Follow existing test patterns.** Match the style of existing tests in the codebase.
6. **Format before testing.** Always run `mise run fmt` before `mise run test` — formatting changes can affect test output.

## What to Run (and When)

| Changed | Run |
|---------|-----|
| Go code | `mise run test:api` then `mise run lint` |
| Frontend code | `mise run test:ui` then `mise run lint` |
| Both | `mise run test` then `mise run lint` |
| User-visible behavior | All above + `mise run test:e2e` |
| Any code before commit | `mise run lint && mise run test` |

## Go Testing

### Commands

```bash
mise run test          # All tests
mise exec -- go test -v -race -cover ./...  # Verbose with race detector
mise exec -- go test -run TestSpecific ./internal/api/  # Single test
```

### Patterns

- **Race detector always on:** `-race` flag on every test run
- **Table-driven tests:** Standard Go pattern for multiple cases
- **`t.Helper()`** on all test helper functions
- **`t.Cleanup()`** for teardown (not `defer` in test helpers)
- **`net/http/httptest`** for HTTP handler tests
- **In-memory SQLite** for store/database tests
- **Golden files** for complex output comparison (TUI views, templates)

### Example: Handler Test

```go
func TestGetUser(t *testing.T) {
    store := setupTestStore(t)  // in-memory SQLite, auto-migrated
    srv := NewServer(store)

    req := httptest.NewRequest("GET", "/api/v1/users/123", nil)
    req.Header.Set("Authorization", "Bearer test-token")
    w := httptest.NewRecorder()

    srv.ServeHTTP(w, req)

    if w.Code != http.StatusOK {
        t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
    }
    // ... assert response body
}
```

### Example: Store Test

```go
func setupTestStore(t *testing.T) *Store {
    t.Helper()
    db, err := sql.Open("sqlite", ":memory:")
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() { db.Close() })
    runMigrations(db)
    return &Store{db: db}
}
```

## Go Linting

```bash
mise exec -- go vet ./...
mise exec -- staticcheck ./...
mise exec -- go fmt ./...
```

- `go vet` catches common mistakes (printf format strings, unreachable code, etc.)
- `staticcheck` catches more subtle bugs and style issues
- `go fmt` is not optional — code must be formatted

**If staticcheck is not installed:**
```toml
# mise.toml
[tools]
"go:honnef.co/go/tools/cmd/staticcheck" = "latest"
```

## Frontend Testing (Vitest + React Testing Library)

### Commands

```bash
mise exec -- npx vitest run          # All tests
mise exec -- npx vitest run --watch  # Watch mode
mise exec -- npx vitest run src/components/Modal.test.tsx  # Single file
```

### Patterns

- Co-locate tests: `Component.tsx` + `Component.test.tsx`
- Use React Testing Library — query by role, text, placeholder (accessible selectors)
- MSW (Mock Service Worker) for API mocking
- Test user interactions, not implementation details

### Example: Component Test

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

test("closes when clicking Cancel", () => {
  const onClose = vi.fn();
  render(<Modal open onClose={onClose}><p>Content</p></Modal>);

  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onClose).toHaveBeenCalled();
});
```

## Worker/Backend Tests (Cloudflare/Bun)

### Patterns

- Use `app.request()` from Hono for handler tests
- Create test helpers: `authedFetch()`, `createTestUser()`, `applyMigrations()`
- In-memory SQLite via `bun:sqlite` for test database
- Test pure functions directly (validation, token generation, etc.)

### Example: Handler Test

```typescript
import { describe, it, expect } from "vitest";
import { app } from "../router";
import { testEnv, createTestUser, authedFetch } from "../test-utils";

describe("GET /api/users", () => {
  it("returns user list", async () => {
    const { userId } = await createTestUser(testEnv);
    const res = await authedFetch(app, "/api/users", { userId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
  });
});
```

## E2E Tests (Playwright)

### When to Write E2E Tests

- New pages or routes
- Changed forms or workflows
- New buttons or interactive elements
- Authentication flows
- Any user-visible behavior change

### Commands

```bash
mise run test:e2e                    # All E2E tests
mise exec -- npx playwright test     # Direct
mise exec -- npx playwright test --ui  # Interactive UI mode
```

### Patterns

- Use accessible selectors: `page.getByRole()`, `page.getByText()`, `page.getByPlaceholder()`
- Create fixture helpers: `register()`, `login()`, `createTestData()`
- Tests run against the dev server (auto-started by Playwright config)
- Support `TEST_MODE` env var for bypassing auth in E2E (direct session creation)

### Example: E2E Test

```typescript
import { test, expect } from "@playwright/test";
import { login, createDemoProject } from "./helpers/fixtures";

test("can create a new item", async ({ page }) => {
  await login(page);
  await createDemoProject(page);

  await page.getByRole("button", { name: /add/i }).click();
  await page.getByPlaceholder("Name").fill("Test Item");
  await page.getByRole("button", { name: /save/i }).click();

  await expect(page.getByText("Test Item")).toBeVisible();
});
```

## Pre-Commit Checklist

Before any code is considered done:

1. `mise run fmt` — format all code
2. `mise run lint` — zero warnings
3. `mise run test` — all passing
4. If user-visible changes: `mise run test:e2e` — all passing
5. If changed API: update OpenAPI spec and regenerate clients
6. If changed UI: test on mobile viewport (375px)

## Test Infrastructure Setup

### Vitest Config

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    exclude: ["tests/**", "node_modules/**", "e2e/**"],
  },
});
```

### Playwright Config

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:5173",
  },
  webServer: {
    command: "mise run dev",
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
});
```

## Test Coverage

- Aim for meaningful coverage, not 100%
- Every handler/endpoint needs at least a happy-path test
- Every business logic function needs tests for edge cases
- Don't test trivial getters/setters or framework boilerplate
- Do test: validation, authorization, error handling, business rules
