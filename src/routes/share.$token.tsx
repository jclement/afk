/**
 * Public read-only dashboard. The owner mints a token in Settings and
 * shares the URL with a manager / spouse / accountability buddy. The token
 * IS the auth — no AFK account on this side. Strictly view-only:
 *
 *   - Categories / allowances / balances
 *   - Vacation list (no internal_desc, no cancelled rows, no actions)
 *   - Year picker on `all-years` scope; locked to the owner's "now" on
 *     `current-year` scope
 *
 * Header/footer are intentionally bare — no Sign-out, no app-internal links.
 * Just the data, the year picker if applicable, and a brief footer.
 */

import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Calendar, Eye } from "lucide-react";
import { CategoryWidget } from "../components/CategoryWidget";
import { VacationList } from "../components/VacationList";
import { api } from "../lib/api";
import type { SharePublicPayload } from "@shared/types";

export const Route = createFileRoute("/share/$token")({
  component: SharePage,
  validateSearch: (raw): { year?: number } => ({
    year:
      typeof raw.year === "string"
        ? Number(raw.year)
        : typeof raw.year === "number"
          ? raw.year
          : undefined,
  }),
});

function SharePage() {
  const { token } = useParams({ from: "/share/$token" });
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const dash = useQuery({
    queryKey: ["share", token, search.year ?? null],
    queryFn: () =>
      api<SharePublicPayload>(
        `/api/v1/share/${encodeURIComponent(token)}/dashboard${
          search.year ? `?year=${encodeURIComponent(search.year)}` : ""
        }`,
      ),
    // The link is stable per token but we don't want stale data after the
    // owner books a new vacation. 60s feels right for a passive view.
    staleTime: 60_000,
    retry: false,
  });

  if (dash.isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-sm text-muted animate-pulse" role="status" aria-live="polite">
          Loading…
        </div>
      </div>
    );
  }

  if (dash.isError || !dash.data) {
    return (
      <div className="max-w-xl w-full mx-auto px-4 py-10">
        <div className="card p-6 text-center">
          <h1 className="text-base font-semibold text-heading mb-2">Link not available</h1>
          <p className="text-sm text-subtle">
            This share link isn't valid. It may have been revoked, expired, or copied incorrectly.
            Ask the person who shared it to send you a new one.
          </p>
        </div>
      </div>
    );
  }

  const { owner, scope, year, available_years, categories, vacations } = dash.data;

  function setYear(next: number) {
    navigate({ search: { year: next }, replace: true });
  }

  const canPickYear = scope === "all-years";

  return (
    <div className="max-w-5xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-subtle">
          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
          Read-only view
        </div>
        <h1 className="text-base font-semibold text-heading">
          {owner.display_name}'s vacation calendar
        </h1>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center bg-surface border border-subtle rounded">
          {canPickYear ? (
            <>
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
            </>
          ) : (
            <div
              className="px-3 py-2 text-sm font-semibold text-heading flex items-center gap-2"
              aria-live="polite"
              aria-atomic="true"
            >
              <Calendar className="w-4 h-4" aria-hidden="true" />
              {year}
            </div>
          )}
        </div>
        {canPickYear && available_years.length > 1 && (
          <select
            className="input"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="Jump to year"
          >
            {available_years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
      </div>

      {categories.length === 0 ? (
        <div className="card p-6">
          <p className="text-sm text-subtle">
            No categories set up yet — there's nothing to show for {year}.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {categories.map((s) => (
            <CategoryWidget key={s.category.id} summary={s} />
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold text-heading mt-2">Vacations</h2>
      {/* The share API strips `internal_desc` server-side, but the prop adds
          a UI-side guard: even if a future change ever leaked the field over
          the wire, the recipient still wouldn't see it. */}
      <VacationList
        vacations={vacations.map((v) => ({
          ...v,
          user_id: "",
          ical_sequence: 0,
          internal_desc: "",
        }))}
        hideInternalDesc
      />
    </div>
  );
}
