/**
 * Top header bar. Always dark. Shows brand, current user, theme toggle,
 * and a logout button.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import { Sun, Moon, Monitor, LogOut, Settings, Calendar } from "lucide-react";
import type { User } from "@shared/types";
import { useTheme } from "../lib/theme";
import { useLogout } from "../api/hooks";

export function Header({ user }: { user: User }) {
  const { pref, cycle } = useTheme();
  const logout = useLogout();
  const navigate = useNavigate();

  const ThemeIcon = pref === "system" ? Monitor : pref === "light" ? Sun : Moon;

  return (
    <header className="h-12 bg-gray-900 text-white flex items-center px-3 sm:px-4 gap-3 shrink-0">
      <Link to="/" className="font-bold tracking-tight text-base sm:text-lg">
        AFK
      </Link>
      <span className="hidden sm:block text-xs text-gray-400 italic">Away From Keyboard</span>
      <div className="flex-1" />
      <Link
        to="/"
        className="px-2 py-1 text-xs rounded text-gray-300 hover:bg-gray-800 hover:text-white inline-flex items-center gap-1.5"
        activeProps={{ className: "bg-gray-700 text-white" }}
      >
        <Calendar className="w-4 h-4" />
        <span className="hidden sm:inline">Dashboard</span>
      </Link>
      <Link
        to="/settings"
        className="px-2 py-1 text-xs rounded text-gray-300 hover:bg-gray-800 hover:text-white inline-flex items-center gap-1.5"
        activeProps={{ className: "bg-gray-700 text-white" }}
      >
        <Settings className="w-4 h-4" />
        <span className="hidden sm:inline">Settings</span>
      </Link>
      <button
        type="button"
        onClick={cycle}
        className="p-1.5 rounded hover:bg-gray-800 text-gray-300 hover:text-white"
        aria-label={`Theme: ${pref}`}
        title={`Theme: ${pref}`}
      >
        <ThemeIcon className="w-4 h-4" />
      </button>
      <div className="hidden sm:flex items-center text-xs text-gray-300 px-1">@{user.username}</div>
      <button
        type="button"
        onClick={() =>
          logout.mutate(undefined, {
            onSuccess: () => navigate({ to: "/login" }),
          })
        }
        className="p-1.5 rounded hover:bg-gray-800 text-gray-300 hover:text-white"
        aria-label="Log out"
        title="Log out"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </header>
  );
}
