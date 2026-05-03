/**
 * React Query hooks for every backend endpoint. Components never call
 * fetch() directly — they use a hook from this file.
 *
 * Pattern:
 *   - useQuery for reads (key + fetcher)
 *   - useMutation for writes; on success, invalidate the affected queries.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE, api } from "../lib/api";
import type {
  Allowance,
  BossMode,
  BossRelationship,
  Category,
  CategorySummary,
  ICalToken,
  PasskeyMeta,
  User,
  Vacation,
} from "@shared/types";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthStatus {
  has_users: boolean;
  auth_suppressed: boolean;
}

export function useAuthStatus() {
  return useQuery({
    queryKey: ["auth", "status"],
    queryFn: () => api<AuthStatus>(`${API_BASE}/auth/status`),
    // Refetch on focus so a tab returning to the foreground after a long
    // delay notices that another tab logged in/out.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useMe(opts?: { enabled?: boolean }) {
  return useQuery<User | null>({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      try {
        return await api<User>(`${API_BASE}/auth/me`);
      } catch (e) {
        if ((e as { status?: number }).status === 401) return null;
        throw e;
      }
    },
    enabled: opts?.enabled ?? true,
    // Treat as stale immediately + refetch on focus — sessions can disappear
    // (logout in another tab, expiry, cookie cleared) and we want the UI to
    // catch up the moment the user comes back to the tab.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`${API_BASE}/auth/logout`, { method: "POST" }),
    onSuccess: () => {
      // Drop everything rather than refetch — every cached query is about
      // to 401 anyway, and refetching just churns the network on the way
      // out. The next page mount will re-fetch what it needs.
      qc.removeQueries();
      qc.setQueryData(["auth", "me"], null);
    },
  });
}

// ---------------------------------------------------------------------------
// Email + verification
// ---------------------------------------------------------------------------

export function useSetEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      api<{ email: string; verified: boolean }>(`${API_BASE}/me/email`, {
        method: "PATCH",
        json: { email },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

export function useResendEmailVerification() {
  return useMutation({
    mutationFn: () =>
      api<{ email: string; verified: boolean }>(`${API_BASE}/me/email/resend`, {
        method: "POST",
      }),
  });
}

export function useClearEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`${API_BASE}/me/email`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

export function useSetTimezone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (timezone: string) =>
      api<{ timezone: string }>(`${API_BASE}/me/timezone`, {
        method: "PATCH",
        json: { timezone },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>(`${API_BASE}/categories`),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; accrues?: boolean }) =>
      api<Category>(`${API_BASE}/categories`, { method: "POST", json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<Category>) =>
      api<Category>(`${API_BASE}/categories/${id}`, {
        method: "PATCH",
        json: body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${API_BASE}/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Allowances
// ---------------------------------------------------------------------------

export function useAllowances(year: number) {
  return useQuery({
    queryKey: ["allowances", year],
    queryFn: () => api<Allowance[]>(`${API_BASE}/categories/allowances/${year}`),
  });
}

export function useUpsertAllowance(year: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      category_id: string;
      days_allotted: number;
      days_carryover: number;
      notes?: string | null;
    }) =>
      api<Allowance>(`${API_BASE}/categories/allowances/${year}/${body.category_id}`, {
        method: "PUT",
        json: body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["allowances", year] });
      qc.invalidateQueries({ queryKey: ["summary", year] });
    },
  });
}

// ---------------------------------------------------------------------------
// Vacations + summary
// ---------------------------------------------------------------------------

export interface YearSummaryResponse {
  year: number;
  categories: CategorySummary[];
  vacations: Array<Vacation & { category: Category | null }>;
}

export function useYearSummary(year: number) {
  return useQuery({
    queryKey: ["summary", year],
    queryFn: () => api<YearSummaryResponse>(`${API_BASE}/vacations/summary/${year}`),
  });
}

// Vacation mutations invalidate ALL year summaries — a Dec 30 → Jan 3 entry
// affects two years' totals, and a category/allowance change can ripple too.
// React Query's prefix-match makes ["summary"] cover ["summary", N] for any N.

export function useCreateVacation(_year: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      category_id: string;
      start_date: string;
      end_date: string;
      partial_amount: number | null;
      public_desc: string;
      internal_desc: string;
    }) => api<Vacation>(`${API_BASE}/vacations`, { method: "POST", json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["summary"] }),
  });
}

export function useUpdateVacation(_year: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api<Vacation>(`${API_BASE}/vacations/${id}`, {
        method: "PATCH",
        json: body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["summary"] }),
  });
}

export function useCancelVacation(_year: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<Vacation>(`${API_BASE}/vacations/${id}/cancel`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["summary"] }),
  });
}

export function useUncancelVacation(_year: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<Vacation>(`${API_BASE}/vacations/${id}/uncancel`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["summary"] }),
  });
}

export function useDeleteVacation(_year: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${API_BASE}/vacations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["summary"] }),
  });
}

// ---------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------

export function usePasskeys() {
  return useQuery({
    queryKey: ["passkeys"],
    queryFn: () => api<PasskeyMeta[]>(`${API_BASE}/passkeys`),
  });
}

export function useDeletePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${API_BASE}/passkeys/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["passkeys"] }),
  });
}

export function useRenamePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, nickname }: { id: string; nickname: string }) =>
      api(`${API_BASE}/passkeys/${id}`, {
        method: "PATCH",
        json: { nickname },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["passkeys"] }),
  });
}

// ---------------------------------------------------------------------------
// iCal tokens
// ---------------------------------------------------------------------------

export function useICalTokens() {
  return useQuery({
    queryKey: ["ical-tokens"],
    queryFn: () => api<ICalToken[]>(`${API_BASE}/ical-tokens`),
  });
}

export function useCreateICalToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { scope: "private" | "public"; label: string }) =>
      api<ICalToken>(`${API_BASE}/ical-tokens`, {
        method: "POST",
        json: body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ical-tokens"] }),
  });
}

export function useDeleteICalToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${API_BASE}/ical-tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ical-tokens"] }),
  });
}

// ---------------------------------------------------------------------------
// Boss / approver
// ---------------------------------------------------------------------------

export function useBoss() {
  return useQuery<BossRelationship | null>({
    queryKey: ["boss"],
    queryFn: () => api<BossRelationship | null>(`${API_BASE}/boss`),
  });
}

export function useUpsertBoss() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { boss_email: string; boss_display_name: string; mode: BossMode }) =>
      api<BossRelationship>(`${API_BASE}/boss`, {
        method: "PUT",
        json: body,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boss"] }),
  });
}

export function useResendBossConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<BossRelationship>(`${API_BASE}/boss/resend-consent`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boss"] }),
  });
}

export function useDeleteBoss() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api(`${API_BASE}/boss`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boss"] }),
  });
}
