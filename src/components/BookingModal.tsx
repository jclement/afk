/**
 * Modal form for booking (or editing) a vacation. Handles the three valid
 * shapes — multi-day, single full day, single partial day — by toggling
 * fields based on user input.
 */

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import {
  useCategories,
  useCreateVacation,
  useUpdateVacation,
} from "../api/hooks";
import { validateVacationShape } from "@shared/vacation-math";
import type { Vacation } from "@shared/types";

interface Props {
  open: boolean;
  year: number;
  editing?: Vacation | null;
  onClose: () => void;
}

const PARTIAL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Full day" },
  { value: 0.75, label: "¾ day" },
  { value: 0.5, label: "½ day" },
  { value: 0.25, label: "¼ day" },
];

export function BookingModal({ open, year, editing, onClose }: Props) {
  const cats = useCategories();
  const create = useCreateVacation(year);
  const update = useUpdateVacation(year);

  const [categoryId, setCategoryId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [partial, setPartial] = useState<number>(1);
  const [publicDesc, setPublicDesc] = useState("");
  const [internalDesc, setInternalDesc] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Reset form fields when the modal opens. The lint rule prefers a
    // remount-via-key pattern, but resetting state from a prop transition
    // is fine here — the modal is closed when not in use, so this fires
    // at most once per open/edit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    if (editing) {
      setCategoryId(editing.category_id);
      setStartDate(editing.start_date);
      setEndDate(editing.end_date);
      setPartial(editing.partial_amount ?? 1);
      setPublicDesc(editing.public_desc);
      setInternalDesc(editing.internal_desc);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      setCategoryId(cats.data?.[0]?.id ?? "");
      setStartDate(today);
      setEndDate(today);
      setPartial(1);
      setPublicDesc("");
      setInternalDesc("");
    }
  }, [open, editing, cats.data]);

  // Single-day mode is implied when start === end. Partial only valid then.
  const sameDay = startDate === endDate;
  const partialAmount = sameDay && partial < 1 ? partial : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!categoryId) {
      setError("Pick a category.");
      return;
    }
    const issue = validateVacationShape({
      start_date: startDate,
      end_date: endDate,
      partial_amount: partialAmount,
    });
    if (issue) {
      setError(issue);
      return;
    }
    const body = {
      category_id: categoryId,
      start_date: startDate,
      end_date: endDate,
      partial_amount: partialAmount,
      public_desc: publicDesc.trim(),
      internal_desc: internalDesc.trim(),
    };
    if (editing) {
      update.mutate(
        { id: editing.id, ...body },
        {
          onSuccess: onClose,
          onError: (e) => setError((e as Error).message),
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: onClose,
        onError: (e) => setError((e as Error).message),
      });
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit vacation" : "Book vacation"}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="booking-form"
            className="btn btn-primary"
            disabled={create.isPending || update.isPending}
          >
            {create.isPending || update.isPending ? "Saving…" : editing ? "Save" : "Book it"}
          </button>
        </>
      }
    >
      <form id="booking-form" className="grid gap-4" onSubmit={handleSubmit}>
        <div>
          <label className="label">Category</label>
          <select
            className="select"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {(cats.data ?? [])
              .filter((c) => !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Start</label>
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
            />
          </div>
          <div>
            <label className="label">End</label>
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">
            Day amount {sameDay ? "" : "(only available for single-day entries)"}
          </label>
          <div className="flex flex-wrap gap-2">
            {PARTIAL_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt.value}
                disabled={!sameDay && opt.value !== 1}
                onClick={() => setPartial(opt.value)}
                className={`btn ${partial === opt.value ? "btn-primary" : "btn-secondary"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Public description (manager / team)</label>
          <input
            type="text"
            className="input"
            placeholder="Out of Office"
            maxLength={200}
            value={publicDesc}
            onChange={(e) => setPublicDesc(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Internal description (just for you)</label>
          <textarea
            className="textarea"
            rows={4}
            placeholder={"Booked the cabin. Bringing the dog. Don't tell Greg.\n\nMarkdown works: **bold**, _italic_, lists, [links](https://…)."}
            maxLength={2000}
            value={internalDesc}
            onChange={(e) => setInternalDesc(e.target.value)}
          />
          <div className="text-[11px] text-muted mt-1">
            Markdown supported. Used as the body of the calendar invite emailed to you.
          </div>
        </div>
        {error && (
          <div className="text-sm text-[color:var(--color-danger)]">{error}</div>
        )}
      </form>
    </Modal>
  );
}
