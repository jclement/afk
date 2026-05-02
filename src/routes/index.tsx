/**
 * Dashboard — year picker, "Book Vacation" button, category widgets, and
 * vacation list. The single most-used screen in the app.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, FileDown, Calendar } from "lucide-react";
import {
  useCancelVacation,
  useDeleteVacation,
  useUncancelVacation,
  useYearSummary,
} from "../api/hooks";
import { CategoryWidget } from "../components/CategoryWidget";
import { VacationList } from "../components/VacationList";
import { BookingModal } from "../components/BookingModal";
import type { Vacation } from "@shared/types";

export const Route = createFileRoute("/")({
  component: DashboardPage,
  validateSearch: (raw): { year?: number } => ({
    year:
      typeof raw.year === "string"
        ? Number(raw.year)
        : typeof raw.year === "number"
          ? raw.year
          : undefined,
  }),
});

function DashboardPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const year = search.year ?? new Date().getFullYear();
  const summary = useYearSummary(year);
  const cancel = useCancelVacation(year);
  const uncancel = useUncancelVacation(year);
  const del = useDeleteVacation(year);

  const [bookingOpen, setBookingOpen] = useState(false);
  const [editing, setEditing] = useState<Vacation | null>(null);

  function setYear(next: number) {
    navigate({ search: { year: next }, replace: true });
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
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center bg-surface border border-subtle rounded">
          <button
            type="button"
            onClick={() => setYear(year - 1)}
            className="p-2 hover:bg-hover"
            aria-label="Previous year"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="px-3 py-2 text-sm font-semibold text-heading flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            {year}
          </div>
          <button
            type="button"
            onClick={() => setYear(year + 1)}
            className="p-2 hover:bg-hover"
            aria-label="Next year"
          >
            <ChevronRight className="w-4 h-4" />
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
