/**
 * Root route — renders the app shell. Centralised auth-redirect logic
 * lives here so individual routes don't have to re-check the user.
 */

import { Link, Outlet, createRootRouteWithContext, useLocation, useNavigate } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthStatus, useMe } from "../api/hooks";
import { Header } from "../components/Header";
import { pickTagline } from "@shared/taglines";

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

  const onAuthRoute = location.pathname === "/login" || location.pathname === "/setup";
  // /about is public — accessible whether or not the visitor is signed in.
  const onPublicRoute = location.pathname === "/about";

  useEffect(() => {
    if (!status.data || me.isLoading) return;
    if (onPublicRoute) return;
    // First-ever visitor (no users yet) lands on the create-account screen.
    if (!status.data.has_users && location.pathname !== "/setup") {
      navigate({ to: "/setup", replace: true });
      return;
    }
    // Unauthenticated visitor on a protected route → send them to login.
    // /setup is allowed for anyone wanting to create a new account.
    if (status.data.has_users && !me.data && !onAuthRoute) {
      navigate({ to: "/login", replace: true });
      return;
    }
    // Already signed in → don't loiter on auth screens.
    if (me.data && onAuthRoute) {
      navigate({ to: "/", replace: true });
    }
  }, [status.data, me.data, me.isLoading, location.pathname, navigate, onAuthRoute, onPublicRoute]);

  if (status.isLoading || me.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-alt">
        <div className="text-sm text-muted animate-pulse">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface-alt">
      {me.data && <Header user={me.data} />}
      <main className="flex-1 flex flex-col">
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
