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
  feed_url: string;
}

export interface PasskeyMeta {
  id: string;
  nickname: string | null;
  device_type: string | null;
  backed_up: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiError {
  error: { message: string; code: string };
}

export interface ApiData<T> {
  data: T;
}
