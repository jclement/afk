/**
 * Newest-first list of vacation entries for the selected year. Each row
 * shows the date range (or partial label), category pill, day cost,
 * descriptions, and cancel/delete actions.
 */

import { Trash2, Ban, Pencil } from "lucide-react";
import type { Category, Vacation } from "@shared/types";
import { describeVacation, vacationDayCost } from "@shared/vacation-math";

interface Props {
  vacations: Array<Vacation & { category: Category | null }>;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (v: Vacation) => void;
}

export function VacationList({ vacations, onCancel, onDelete, onEdit }: Props) {
  if (vacations.length === 0) {
    return (
      <div className="card p-8 text-center">
        <div className="text-sm text-subtle">
          No vacations yet. Suspicious. Click <span className="font-semibold text-heading">Book Vacation</span> and
          remedy that.
        </div>
      </div>
    );
  }
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[color:var(--color-surface-alt)]">
          <tr className="text-left text-[11px] uppercase tracking-wide text-subtle">
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Days</th>
            <th className="px-3 py-2 hidden md:table-cell">Note</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {vacations.map((v) => {
            const cost = vacationDayCost(v);
            return (
              <tr
                key={v.id}
                className={`border-t border-subtle ${v.cancelled_at ? "text-muted" : "text-body"}`}
              >
                <td className={`px-3 py-2 font-mono ${v.cancelled_at ? "line-through" : ""}`}>
                  {describeVacation(v)}
                </td>
                <td className="px-3 py-2">
                  {v.category ? (
                    <span
                      className="pill"
                      style={{ backgroundColor: v.category.color }}
                    >
                      {v.category.name}
                    </span>
                  ) : (
                    <span className="text-muted text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono">{cost.toString()}</td>
                <td className="px-3 py-2 hidden md:table-cell text-subtle truncate max-w-[280px]">
                  {v.public_desc || v.internal_desc || ""}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-1">
                    {!v.cancelled_at && (
                      <button
                        type="button"
                        onClick={() => onEdit(v)}
                        title="Edit"
                        aria-label="Edit"
                        className="p-1 rounded hover:bg-hover"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {!v.cancelled_at && (
                      <button
                        type="button"
                        onClick={() => onCancel(v.id)}
                        title="Cancel"
                        aria-label="Cancel"
                        className="p-1 rounded hover:bg-hover text-[color:var(--color-warning)]"
                      >
                        <Ban className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(v.id)}
                      title="Delete"
                      aria-label="Delete"
                      className="p-1 rounded hover:bg-hover text-[color:var(--color-danger)]"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
