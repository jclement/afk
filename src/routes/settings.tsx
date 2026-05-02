/**
 * Settings — categories, allowances, passkeys, iCal feeds. One scrollable
 * page, four sections.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, KeyRound, Copy, Check } from "lucide-react";
import {
  useAllowances,
  useCategories,
  useCreateCategory,
  useCreateICalToken,
  useDeleteCategory,
  useDeleteICalToken,
  useDeletePasskey,
  useICalTokens,
  usePasskeys,
  useRenamePasskey,
  useUpsertAllowance,
} from "../api/hooks";
import { registerPasskey } from "../lib/passkey-client";
import { useMe } from "../api/hooks";
import { categoryUnitToDays, daysToCategoryUnit } from "@shared/vacation-math";
import type { CategoryUnit } from "@shared/types";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const year = new Date().getFullYear();
  return (
    <div className="max-w-3xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 flex flex-col gap-6">
      <h1 className="text-base font-semibold text-heading">Settings</h1>
      <CategoriesSection year={year} />
      <PasskeysSection />
      <ICalSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories + allowances (combined for ergonomics)
// ---------------------------------------------------------------------------
function CategoriesSection({ year }: { year: number }) {
  const cats = useCategories();
  const allowances = useAllowances(year);
  const createCat = useCreateCategory();
  const deleteCat = useDeleteCategory();
  const upsert = useUpsertAllowance(year);

  const [name, setName] = useState("");
  const [unit, setUnit] = useState<CategoryUnit>("weeks");

  function add() {
    if (!name.trim()) return;
    createCat.mutate(
      { name: name.trim(), unit },
      {
        onSuccess: () => setName(""),
      },
    );
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-heading mb-3">
        Categories &amp; allowances ({year})
      </h2>
      {cats.data && cats.data.length > 0 && (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-subtle">
              <tr>
                <th className="px-3 py-1 text-left">Name</th>
                <th className="px-3 py-1 text-left">Unit</th>
                <th className="px-3 py-1 text-left">Allotted</th>
                <th className="px-3 py-1 text-left">Carryover</th>
                <th className="px-3 py-1 text-right">…</th>
              </tr>
            </thead>
            <tbody>
              {cats.data.map((c) => {
                const a =
                  allowances.data?.find((al) => al.category_id === c.id) ?? null;
                return (
                  <CategoryRow
                    key={c.id}
                    name={c.name}
                    unit={c.unit}
                    color={c.color}
                    archived={c.archived}
                    allotted={daysToCategoryUnit(a?.days_allotted ?? 0, c.unit)}
                    carryover={daysToCategoryUnit(a?.days_carryover ?? 0, c.unit)}
                    onSave={(allotted, carryover) =>
                      upsert.mutate({
                        category_id: c.id,
                        days_allotted: categoryUnitToDays(allotted, c.unit),
                        days_carryover: categoryUnitToDays(carryover, c.unit),
                      })
                    }
                    onDelete={() => {
                      if (
                        confirm(
                          `Delete category "${c.name}"? Cancel its entries first if it has any.`,
                        )
                      )
                        deleteCat.mutate(c.id);
                    }}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[140px]">
          <label className="label">New category</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sick"
          />
        </div>
        <div>
          <label className="label">Unit</label>
          <select
            className="select"
            value={unit}
            onChange={(e) => setUnit(e.target.value as CategoryUnit)}
          >
            <option value="weeks">Weeks</option>
            <option value="days">Days</option>
          </select>
        </div>
        <button type="button" className="btn btn-primary" onClick={add}>
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>
      {createCat.isError && (
        <div className="text-sm text-[color:var(--color-danger)] mt-2">
          {(createCat.error as Error).message}
        </div>
      )}
    </section>
  );
}

interface RowProps {
  name: string;
  unit: CategoryUnit;
  color: string;
  archived: boolean;
  allotted: number;
  carryover: number;
  onSave: (allotted: number, carryover: number) => void;
  onDelete: () => void;
}

function CategoryRow(p: RowProps) {
  const [allotted, setAllotted] = useState<string>(p.allotted.toString());
  const [carryover, setCarryover] = useState<string>(p.carryover.toString());
  const dirty =
    Number(allotted) !== p.allotted || Number(carryover) !== p.carryover;
  return (
    <tr className="border-t border-subtle">
      <td className="px-3 py-2">
        <span className="pill" style={{ backgroundColor: p.color }}>
          {p.name}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-subtle">{p.unit}</td>
      <td className="px-3 py-2">
        <input
          type="number"
          min="0"
          step="0.25"
          className="input w-20"
          value={allotted}
          onChange={(e) => setAllotted(e.target.value)}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min="0"
          step="0.25"
          className="input w-20"
          value={carryover}
          onChange={(e) => setCarryover(e.target.value)}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex gap-1">
          {dirty && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => p.onSave(Number(allotted), Number(carryover))}
            >
              Save
            </button>
          )}
          <button
            type="button"
            className="p-1 rounded hover:bg-hover text-[color:var(--color-danger)]"
            onClick={p.onDelete}
            aria-label="Delete category"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------
function PasskeysSection() {
  const passkeys = usePasskeys();
  const me = useMe();
  const del = useDeletePasskey();
  const ren = useRenamePasskey();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPasskey() {
    setError(null);
    if (!me.data) return;
    setAdding(true);
    try {
      await registerPasskey({
        username: me.data.username,
        display_name: me.data.display_name,
        nickname: prompt("Nickname for this passkey?") || "Additional passkey",
      });
      await qc.invalidateQueries({ queryKey: ["passkeys"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-heading mb-3">Passkeys</h2>
      <div className="flex flex-col gap-2">
        {(passkeys.data ?? []).map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2 border-t border-subtle py-2 first:border-t-0 first:pt-0"
          >
            <KeyRound className="w-4 h-4 text-subtle shrink-0" />
            <div className="flex-1 min-w-0">
              <input
                className="input"
                defaultValue={p.nickname ?? ""}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== p.nickname) {
                    ren.mutate({ id: p.id, nickname: e.target.value.trim() });
                  }
                }}
              />
              <div className="text-[11px] text-muted mt-1">
                {p.device_type ?? "passkey"} · added {p.created_at.slice(0, 10)} ·{" "}
                {p.last_used_at ? `last used ${p.last_used_at.slice(0, 10)}` : "never used"}
              </div>
            </div>
            <button
              type="button"
              className="p-1 rounded hover:bg-hover text-[color:var(--color-danger)]"
              onClick={() => {
                if (confirm("Delete this passkey?")) del.mutate(p.id);
              }}
              aria-label="Delete passkey"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-secondary mt-3"
        onClick={addPasskey}
        disabled={adding}
      >
        <Plus className="w-4 h-4" />
        {adding ? "Registering…" : "Add another passkey"}
      </button>
      {error && (
        <div className="text-sm text-[color:var(--color-danger)] mt-2">{error}</div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// iCal feeds
// ---------------------------------------------------------------------------
function ICalSection() {
  const tokens = useICalTokens();
  const create = useCreateICalToken();
  const del = useDeleteICalToken();
  const [copied, setCopied] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  function copy(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-heading mb-3">Calendar feeds (iCal)</h2>
      <p className="text-xs text-subtle mb-3">
        Mint a feed URL and paste it into Outlook, Google Calendar, or Apple Calendar.
        Public feeds expose only the public description; private feeds include internal notes
        and category names.
      </p>
      <div className="flex flex-col gap-2">
        {(tokens.data ?? []).map((t) => (
          <div
            key={t.id}
            className="border-t border-subtle py-2 first:border-t-0 first:pt-0 flex flex-col gap-1"
          >
            <div className="flex items-center gap-2">
              <span
                className="pill"
                style={{
                  backgroundColor: t.scope === "private" ? "#dc2626" : "#16a34a",
                }}
              >
                {t.scope}
              </span>
              <span className="text-sm">{t.label || "(unnamed)"}</span>
              <div className="flex-1" />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => copy(t.feed_url)}
                title={t.feed_url}
              >
                {copied === t.feed_url ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied === t.feed_url ? "Copied" : "Copy URL"}
              </button>
              <button
                type="button"
                className="p-1 rounded hover:bg-hover text-[color:var(--color-danger)]"
                onClick={() => {
                  if (confirm("Revoke this feed? Subscribers will start 404ing.")) del.mutate(t.id);
                }}
                aria-label="Revoke feed"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[11px] text-muted font-mono truncate">{t.feed_url}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[140px]">
          <label className="label">Feed label</label>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. for manager"
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            create.mutate(
              { scope: "public", label },
              { onSuccess: () => setLabel("") },
            )
          }
          disabled={create.isPending}
        >
          <Plus className="w-4 h-4" />
          New public
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            create.mutate(
              { scope: "private", label },
              { onSuccess: () => setLabel("") },
            )
          }
          disabled={create.isPending}
        >
          <Plus className="w-4 h-4" />
          New private
        </button>
      </div>
    </section>
  );
}
