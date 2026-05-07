/**
 * Dashboard — year picker, "Book Vacation" button, category widgets, and
 * vacation list. The single most-used screen in the app.
 */

import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, FileDown, Calendar, LifeBuoy, X } from "lucide-react";
import {
  useCancelVacation,
  useDeleteVacation,
  useMe,
  useUncancelVacation,
  useYearSummary,
} from "../api/hooks";
import { currentYearInTimezone } from "@shared/vacation-math";
import { CategoryWidget } from "../components/CategoryWidget";
import { VacationList } from "../components/VacationList";
import { BookingModal } from "../components/BookingModal";
import type { Vacation } from "@shared/types";

export const Route = createFileRoute("/")({
  component: DashboardPage,
  validateSearch: (raw): { year?: number; recovery?: number } => ({
    year:
      typeof raw.year === "string"
        ? Number(raw.year)
        : typeof raw.year === "number"
          ? raw.year
          : undefined,
    recovery:
      // After a recovery-code login the login route appends ?recovery=1 so we
      // can show a one-line nudge. Anything else gets dropped silently.
      raw.recovery === 1 || raw.recovery === "1" ? 1 : undefined,
  }),
});

function DashboardPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const me = useMe();
  const tz = me.data?.timezone ?? "UTC";
  const year = search.year ?? currentYearInTimezone(tz);
  const summary = useYearSummary(year);
  const cancel = useCancelVacation(year);
  const uncancel = useUncancelVacation(year);
  const del = useDeleteVacation(year);

  const [bookingOpen, setBookingOpen] = useState(false);
  const [editing, setEditing] = useState<Vacation | null>(null);
  const [recoveryNudge, setRecoveryNudge] = useState(search.recovery === 1);

  function setYear(next: number) {
    navigate({ search: { year: next }, replace: true });
  }

  function dismissRecoveryNudge() {
    setRecoveryNudge(false);
    navigate({ search: { year: search.year }, replace: true });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this entry forever? Cancel hides it but keeps history.")) return;
    del.mutate(id);
  }

  function handleCancel(id: string) {
    if (!confirm("Cancel this vacation? It will stop counting against your balance.")) return;
    cancel.mutate(id);
  }

  return (
    <div className="max-w-5xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 flex flex-col gap-4">
      {/* Visually-hidden h1 for screen-reader users — the year picker doubles
          as the visual title. Document outline rule: every page gets one h1. */}
      <h1 className="sr-only">Dashboard — {year}</h1>
      {recoveryNudge && (
        <div
          className="rounded border px-3 py-2 flex items-start gap-2 text-xs"
          style={{
            borderColor: "var(--color-warning)",
            background: "color-mix(in srgb, var(--color-warning) 12%, transparent)",
          }}
          role="status"
        >
          <LifeBuoy
            className="w-4 h-4 mt-0.5 text-[color:var(--color-warning)] shrink-0"
            aria-hidden="true"
          />
          <div className="flex-1 text-subtle">
            Recovery code accepted.{" "}
            <Link to="/settings" className="underline text-heading">
              Add a new passkey in Settings
            </Link>{" "}
            to restore one-tap login.
          </div>
          <button
            type="button"
            className="p-1 rounded hover:bg-hover text-muted"
            onClick={dismissRecoveryNudge}
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center bg-surface border border-subtle rounded">
          <button
            type="button"
            onClick={() => setYear(year - 1)}
            className="p-2 hover:bg-hover min-w-[40px] min-h-[40px] flex items-center justify-center"
            aria-label="Previous year"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <div
            className="px-3 py-2 text-sm font-semibold text-heading flex items-center gap-2"
            aria-live="polite"
            aria-atomic="true"
          >
            <Calendar className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">Year:</span>
            {year}
          </div>
          <button
            type="button"
            onClick={() => setYear(year + 1)}
            className="p-2 hover:bg-hover min-w-[40px] min-h-[40px] flex items-center justify-center"
            aria-label="Next year"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1" />
        <a
          href={`/api/v1/pdf/${year}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary"
        >
          <FileDown className="w-4 h-4" />
          <span className="hidden sm:inline">Export PDF</span>
        </a>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setEditing(null);
            setBookingOpen(true);
          }}
        >
          <Plus className="w-4 h-4" />
          Book vacation
        </button>
      </div>

      {/* Widgets */}
      {summary.isLoading && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 w-24 bg-[color:var(--color-hover)] rounded mb-3" />
              <div className="h-8 w-32 bg-[color:var(--color-hover)] rounded mb-3" />
              <div className="h-2 w-full bg-[color:var(--color-hover)] rounded" />
            </div>
          ))}
        </div>
      )}
      {summary.data && summary.data.categories.length === 0 && (
        <div className="card p-6">
          <p className="text-sm">
            No categories yet. Head to{" "}
            <a className="underline" href="/settings">
              Settings
            </a>{" "}
            to set up Vacation, Flex, or whatever your HR jargon flavor of the year is.
          </p>
        </div>
      )}
      {summary.data && summary.data.categories.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {summary.data.categories.map((s) => (
            <CategoryWidget key={s.category.id} summary={s} />
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold text-heading mt-2">Vacations</h2>
      {summary.data && (
        <VacationList
          vacations={summary.data.vacations}
          onCancel={handleCancel}
          onUncancel={(id) => uncancel.mutate(id)}
          onDelete={handleDelete}
          onEdit={(v) => {
            setEditing(v);
            setBookingOpen(true);
          }}
        />
      )}

      <BookingModal
        open={bookingOpen}
        year={year}
        editing={editing}
        onClose={() => setBookingOpen(false)}
      />
    </div>
  );
}
