/**
 * Shared types between the worker and the React frontend.
 *
 * All fields use snake_case to match the JSON shape the API returns. Don't
 * camelCase these — the API contract is "the database shape, escaped".
 */

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: "user" | "admin";
  email: string | null;
  email_verified_at: string | null;
  /** IANA timezone name, e.g. "America/Vancouver". "UTC" if unset. */
  timezone: string;
  /** When the user was first created. ISO 8601 (TEXT in SQLite). */
  created_at: string;
  /** Most recent successful login. Null until the first login. */
  last_login_at: string | null;
  /** Null until the user finishes the first-run wizard. Drives the post-login
   *  redirect to /welcome for new + pre-existing users. */
  welcome_completed_at: string | null;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  /**
   * If true, days_allotted accrues throughout the year — `available_days`
   * scales with the elapsed fraction. Carryover is always fully available.
   */
  accrues: boolean;
  color: string;
  sort_order: number;
  archived: boolean;
  created_at: string;
}

export interface Allowance {
  id: string;
  user_id: string;
  category_id: string;
  year: number;
  days_allotted: number;
  days_carryover: number;
  notes: string | null;
}

export interface Vacation {
  id: string;
  user_id: string;
  category_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  partial_amount: number | null;
  public_desc: string;
  internal_desc: string;
  cancelled_at: string | null;
  /** Bumped on every change. Used as iCalendar SEQUENCE in invite emails. */
  ical_sequence: number;
  /**
   * Approval state when the user has a boss in approval mode. NULL when no
   * boss is set up or the boss is in notify mode (no gate). For pending the
   * vacation appears as TENTATIVE on the user's calendar; rejected behaves
   * like cancelled.
   */
  approval_state: ApprovalState | null;
  created_at: string;
  updated_at: string;
}

export interface CategorySummary {
  category: Category;
  allowance: Allowance;
  used_days: number;
  /**
   * Allotted + carryover. The full year's worth of days, regardless of
   * accrual. This is what shows up under "/ total".
   */
  total_days: number;
  /**
   * What the user is *allowed* to use right now. For non-accruing categories
   * this is `total_days`. For accruing ones it's
   * `days_carryover + days_allotted * elapsed_fraction`.
   */
  available_days: number;
  /**
   * `total_days - used_days`. Can go negative if they overbook the year.
   */
  remaining_days: number;
  /**
   * `max(0, used_days - available_days)`. Non-zero on accruing categories
   * means they've spent vacation they haven't accrued yet — used to drive
   * the dashboard's "borrowing from future you" warning.
   */
  over_accrual_days: number;
}

export interface YearSummary {
  year: number;
  categories: CategorySummary[];
  vacations: Array<Vacation & { category: Category }>;
}

export interface ICalToken {
  id: string;
  scope: "private" | "public";
  label: string;
  created_at: string;
  last_used_at: string | null;
  /**
   * Full feed URL. Only populated on creation (POST returns it once); list
   * endpoints omit it because tokens are stored as SHA-256 hashes server-side
   * and the plaintext is unrecoverable. Users who lose the URL must delete
   * the token and create a new one.
   */
  feed_url?: string;
}

export type ShareScope = "current-year" | "all-years";

export interface ShareToken {
  id: string;
  scope: ShareScope;
  label: string;
  created_at: string;
  last_viewed_at: string | null;
  /** Full URL the user copies to share. Only populated on creation — see
   *  ICalToken.feed_url for the rationale. */
  share_url?: string;
}

/**
 * Sanitised allowance for the public share payload. Drops `notes` (private
 * free-text the owner uses for accounting comments — "re-negotiated PTO with
 * HR Q3"), `id` and `user_id` (internal). The recipient only needs the
 * numeric inputs to render the dashboard widgets.
 */
export type PublicAllowance = Omit<Allowance, "id" | "user_id" | "notes">;

/** CategorySummary as exposed to public-share visitors — allowance scrubbed. */
export interface PublicCategorySummary extends Omit<CategorySummary, "allowance"> {
  allowance: PublicAllowance;
}

/**
 * Public-share dashboard payload. Mirrors `YearSummary` for a single year
 * but stripped of anything sensitive: no `internal_desc`, no cancelled rows,
 * no auth surface, no allowance notes. The owner is identified by
 * display_name only.
 */
export interface SharePublicPayload {
  owner: { display_name: string; timezone: string };
  scope: ShareScope;
  /** Year currently being shown (server-resolved when `scope=current-year`). */
  year: number;
  /** Years that have any non-cancelled vacations — for the year picker on
   *  `all-years` links. Empty array when scope is `current-year`. */
  available_years: number[];
  categories: PublicCategorySummary[];
  vacations: Array<
    Omit<Vacation, "internal_desc" | "user_id" | "ical_sequence"> & {
      category: Category | null;
    }
  >;
}

export interface PasskeyMeta {
  id: string;
  nickname: string | null;
  device_type: string | null;
  backed_up: boolean;
  created_at: string;
  last_used_at: string | null;
}

export type BossMode = "notify" | "approval";
export type BossConsentStatus = "pending" | "consented" | "revoked";
export type ApprovalState = "pending" | "approved" | "rejected";

export interface BossRelationship {
  id: string;
  user_id: string;
  boss_email: string;
  mode: BossMode;
  consent_status: BossConsentStatus;
  consented_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface VacationApproval {
  id: string;
  vacation_id: string;
  boss_relationship_id: string;
  state: ApprovalState;
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
}

export interface ApiError {
  error: { message: string; code: string };
}

export interface ApiData<T> {
  data: T;
}
