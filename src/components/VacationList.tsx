/**
 * Newest-first list of vacation entries for the selected year. Renders as
 * a table on `md` and up, and as a stack of cards on phones — same data,
 * same actions, different shape.
 */

import { Trash2, Ban, Pencil, RotateCcw, Mail } from "lucide-react";
import type { Category, Vacation } from "@shared/types";
import { describeVacation, vacationDayCost } from "@shared/vacation-math";

type VacationWithCategory = Vacation & { category: Category | null };

interface Props {
  vacations: VacationWithCategory[];
  /** When any of these are missing the row renders read-only — the action
   *  column / button bar is hidden entirely. Used by the public share view. */
  onCancel?: (id: string) => void;
  onUncancel?: (id: string) => void;
  onDelete?: (id: string) => void;
  onEdit?: (v: Vacation) => void;
  /** Open the resend-invite modal for this vacation. Optional — passing
   *  undefined hides the action button entirely (e.g. on the public share
   *  view, which has no notion of "your inbox"). */
  onResend?: (v: Vacation) => void;
  /** When true the list hides `internal_desc` from the Note column. The
   *  share API already strips it server-side, but the view also defends. */
  hideInternalDesc?: boolean;
}

export function VacationList(props: Props) {
  const { vacations, onCancel, onUncancel, onDelete, onEdit } = props;
  const readOnly = !onCancel || !onUncancel || !onDelete || !onEdit;
  if (vacations.length === 0) {
    return (
      <div className="card p-8 text-center">
        <div className="text-sm text-subtle">
          {readOnly ? (
            "Nothing booked here yet."
          ) : (
            <>
              No vacations yet. Suspicious. Click{" "}
              <span className="font-semibold text-heading">Book Vacation</span> and remedy that.
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Mobile: stack of cards */}
      <div className="flex flex-col gap-2 md:hidden">
        {vacations.map((v) => (
          <VacationCard key={v.id} v={v} {...props} />
        ))}
      </div>

      {/* Desktop: dense table */}
      <div className="card overflow-hidden hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--color-surface-alt)]">
            <tr className="text-left text-[11px] uppercase tracking-wide text-subtle">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Days</th>
              <th className="px-3 py-2">Note</th>
              {!readOnly && <th className="px-3 py-2 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {vacations.map((v) => (
              <VacationRow key={v.id} v={v} {...props} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function VacationRow({
  v,
  onCancel,
  onUncancel,
  onDelete,
  onEdit,
  onResend,
  hideInternalDesc,
}: { v: VacationWithCategory } & Omit<Props, "vacations">) {
  const cost = vacationDayCost(v);
  const isCancelled = !!v.cancelled_at;
  const note = hideInternalDesc ? v.public_desc : v.public_desc || v.internal_desc || "";
  const readOnly = !onCancel || !onUncancel || !onDelete || !onEdit;
  return (
    <tr className={`border-t border-subtle ${isCancelled ? "text-muted" : "text-body"}`}>
      <td className={`px-3 py-2 font-mono ${isCancelled ? "line-through" : ""}`}>
        {describeVacation(v)}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <CategoryPill category={v.category} />
          <ApprovalBadge state={v.approval_state} />
        </div>
      </td>
      <td className="px-3 py-2 font-mono">{cost.toString()}</td>
      <td className="px-3 py-2 text-subtle truncate max-w-[280px]">{note}</td>
      {!readOnly && (
        <td className="px-3 py-2 text-right">
          <ActionButtons
            v={v}
            onEdit={onEdit}
            onCancel={onCancel}
            onUncancel={onUncancel}
            onDelete={onDelete}
            onResend={onResend}
          />
        </td>
      )}
    </tr>
  );
}

function VacationCard({
  v,
  onCancel,
  onUncancel,
  onDelete,
  onEdit,
  onResend,
  hideInternalDesc,
}: { v: VacationWithCategory } & Omit<Props, "vacations">) {
  const cost = vacationDayCost(v);
  const isCancelled = !!v.cancelled_at;
  const note = hideInternalDesc ? v.public_desc : v.public_desc || v.internal_desc || "";
  const readOnly = !onCancel || !onUncancel || !onDelete || !onEdit;
  return (
    <div className={`card p-3 flex flex-col gap-2 ${isCancelled ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <CategoryPill category={v.category} />
        <ApprovalBadge state={v.approval_state} />
        <span className="font-mono text-xs text-subtle ml-auto">{cost.toString()} d</span>
      </div>
      <div
        className={`text-sm font-mono text-heading ${isCancelled ? "line-through text-muted" : ""}`}
      >
        {describeVacation(v)}
      </div>
      {note && <div className="text-xs text-subtle line-clamp-2">{note}</div>}
      {isCancelled && <div className="text-[11px] text-muted italic">Cancelled</div>}
      {!readOnly && (
        <div className="flex justify-end pt-1 -mb-1">
          <ActionButtons
            v={v}
            onEdit={onEdit}
            onCancel={onCancel}
            onUncancel={onUncancel}
            onDelete={onDelete}
            onResend={onResend}
          />
        </div>
      )}
    </div>
  );
}

function CategoryPill({ category }: { category: Category | null }) {
  if (!category) return <span className="text-muted text-xs">—</span>;
  return (
    <span className="pill" style={{ backgroundColor: category.color }}>
      {category.name}
    </span>
  );
}

/**
 * Approval state pill — only renders when there's something to say. Pending
 * is the visible one (the user is waiting on the boss); approved/rejected
 * are usually combined with the cancelled-strikethrough so we don't shout.
 */
function ApprovalBadge({ state }: { state: import("@shared/types").ApprovalState | null }) {
  if (!state || state === "approved") return null;
  const bg = state === "pending" ? "var(--color-warning)" : "var(--color-danger)"; // rejected
  const label = state === "pending" ? "Pending manager" : "Rejected";
  return (
    <span className="pill" style={{ backgroundColor: bg }} title={label}>
      {label}
    </span>
  );
}

/**
 * Render the per-row action buttons. The owning render path always passes
 * all four callbacks; the read-only render path skips this whole subtree
 * (see `readOnly` checks above) so the non-null assertions here are safe.
 */
function ActionButtons({
  v,
  onEdit,
  onCancel,
  onUncancel,
  onDelete,
  onResend,
}: { v: VacationWithCategory } & Omit<Props, "vacations">) {
  const isCancelled = !!v.cancelled_at;
  return (
    <div className="inline-flex gap-1">
      {onResend && (
        // Available regardless of cancelled state — resending a CANCEL is
        // exactly the recovery path for "the manager still has it on their
        // calendar after I cancelled."
        <button
          type="button"
          onClick={() => onResend(v)}
          title="Resend invite"
          aria-label="Resend invite"
          className="p-1 rounded hover:bg-hover"
        >
          <Mail className="w-4 h-4" />
        </button>
      )}
      {!isCancelled && (
        <>
          <button
            type="button"
            onClick={() => onEdit!(v)}
            title="Edit"
            aria-label="Edit"
            className="p-1 rounded hover:bg-hover"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onCancel!(v.id)}
            title="Cancel"
            aria-label="Cancel"
            className="p-1 rounded hover:bg-hover text-[color:var(--color-warning)]"
          >
            <Ban className="w-4 h-4" />
          </button>
        </>
      )}
      {isCancelled && (
        <button
          type="button"
          onClick={() => onUncancel!(v.id)}
          title="Restore"
          aria-label="Restore"
          className="p-1 rounded hover:bg-hover"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onDelete!(v.id)}
        title="Delete"
        aria-label="Delete"
        className="p-1 rounded hover:bg-hover text-[color:var(--color-danger)]"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
