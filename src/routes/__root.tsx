/**
 * Root route — renders the app shell. Centralised auth-redirect logic
 * lives here so individual routes don't have to re-check the user.
 */

import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthStatus, useMe } from "../api/hooks";
import { Header } from "../components/Header";
import { pickTagline } from "@shared/taglines";

// Per-route document.title hints. Routes not listed fall through to the
// default title. We update document.title via useEffect so this stays
// SPA-friendly without pulling in @tanstack/react-router's <head> plumbing.
const TITLES: Record<string, string> = {
  "/": "Dashboard · AFK",
  "/login": "Sign in · AFK",
  "/setup": "Set up your account · AFK",
  "/welcome": "AFK — Away From Keyboard",
  "/settings": "Settings · AFK",
  "/about": "About & privacy · AFK",
};

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  const location = useLocation();
  const navigate = useNavigate();
  const status = useAuthStatus();
  const me = useMe();

  useEffect(() => {
    document.title = TITLES[location.pathname] ?? "AFK — Away From Keyboard";
  }, [location.pathname]);

  const onAuthRoute = location.pathname === "/login" || location.pathname === "/setup";
  // Public routes — no auth, no auto-redirect away. /welcome is the marketing
  // landing page; /about is the privacy/no-guarantees page; /share/:token is
  // the read-only dashboard handed out to managers/spouses (token IS the auth).
  const onPublicRoute =
    location.pathname === "/about" ||
    location.pathname === "/welcome" ||
    location.pathname.startsWith("/share/");

  useEffect(() => {
    if (!status.data || me.isLoading) return;
    // First-ever visitor (no users yet) lands on the create-account screen.
    if (!status.data.has_users && location.pathname !== "/setup") {
      navigate({ to: "/setup", replace: true });
      return;
    }
    // Already signed in → don't loiter on auth or marketing screens.
    if (me.data && (onAuthRoute || location.pathname === "/welcome")) {
      navigate({ to: "/", replace: true });
      return;
    }
    if (onPublicRoute) return;
    // Unauthenticated visitor on a protected route → send them to the
    // marketing landing page, not straight to the login form.
    if (status.data.has_users && !me.data && !onAuthRoute) {
      navigate({ to: "/welcome", replace: true });
    }
  }, [status.data, me.data, me.isLoading, location.pathname, navigate, onAuthRoute, onPublicRoute]);

  if (status.isLoading || me.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-alt">
        <div className="text-sm text-muted animate-pulse" role="status" aria-live="polite">
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface-alt">
      {/* Skip link is the first focusable element so a keyboard user can
          bypass the header on every page. Visually hidden until focused. */}
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      {me.data && <Header user={me.data} />}
      <main id="main" className="flex-1 flex flex-col">
        <Outlet />
      </main>
      <footer className="text-xs text-muted text-center py-3 safe-bottom flex flex-col items-center gap-1">
        <div className="italic">{pickTagline(new Date().toISOString().slice(0, 10))}</div>
        <div className="not-italic">
          <Link to="/about" className="underline hover:text-heading">
            About &amp; privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}
