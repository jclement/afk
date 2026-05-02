/**
 * Shared types between the worker and the React frontend.
 *
 * All fields use snake_case to match the JSON shape the API returns. Don't
 * camelCase these — the API contract is "the database shape, escaped".
 */

export type CategoryUnit = "days" | "weeks";

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
  unit: CategoryUnit;
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
  remaining_days: number;
  total_days: number;
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
