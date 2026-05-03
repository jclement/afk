/**
 * User data export — single source of truth for what gets included in a
 * "download my data" request. Two output formats:
 *
 *   - JSON: complete machine-readable dump of every user-owned row across
 *     every table. The shape is stable enough to round-trip into a future
 *     import feature.
 *   - CSV: a flat vacations-with-category-info view, optimised for opening
 *     in a spreadsheet. Includes the *computed* day cost so the spreadsheet
 *     totals match what the dashboard shows.
 *
 * **Contract for future work:** any new user-data column or table MUST be
 * added here AND covered by an export test, or users lose data when they
 * try to migrate off. See CLAUDE.md "Data export contract".
 */

import type {
  Allowance,
  BossRelationship,
  Category,
  ShareToken,
  User,
  Vacation,
} from "../../shared/types.js";
import { vacationDayCost } from "../../shared/vacation-math.js";

/** Schema version of the JSON dump — bump if the shape changes incompatibly. */
export const EXPORT_SCHEMA_VERSION = 1;

export interface JsonExport {
  schema_version: number;
  exported_at: string;
  app: { name: "AFK"; version: string };
  user: {
    id: string;
    username: string;
    display_name: string;
    role: "user" | "admin";
    email: string | null;
    email_verified_at: string | null;
    timezone: string;
    created_at: string;
    last_login_at: string | null;
  };
  categories: Category[];
  allowances: Allowance[];
  vacations: Vacation[];
  /**
   * Boss relationship if any. Single object (the schema supports one per
   * user). Token fields are deliberately NOT included — they're credential
   * material. Approval history per vacation lives on `vacations.approval_state`.
   */
  boss: BossRelationship | null;
  /**
   * Read-only dashboard share links the user minted. The actual `token`
   * value (and the resulting `share_url`) is NOT included — it's a
   * credential and exposing it in a downloadable file is a leak risk. The
   * user-authored metadata (label, scope, when, last viewed) is preserved
   * so a migrating user has a record of which links existed.
   */
  share_tokens: Array<Pick<ShareToken, "id" | "scope" | "label" | "created_at" | "last_viewed_at">>;
}

export function buildJsonExport(input: {
  user: User;
  categories: Category[];
  allowances: Allowance[];
  vacations: Vacation[];
  boss: BossRelationship | null;
  shareTokens: ShareToken[];
  appVersion: string;
  now?: Date;
}): JsonExport {
  const now = input.now ?? new Date();
  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: now.toISOString(),
    app: { name: "AFK", version: input.appVersion },
    user: {
      id: input.user.id,
      username: input.user.username,
      display_name: input.user.display_name,
      role: input.user.role,
      email: input.user.email,
      email_verified_at: input.user.email_verified_at,
      timezone: input.user.timezone,
      created_at: input.user.created_at,
      last_login_at: input.user.last_login_at,
    },
    categories: input.categories,
    allowances: input.allowances,
    vacations: input.vacations,
    boss: input.boss,
    share_tokens: input.shareTokens.map((t) => ({
      id: t.id,
      scope: t.scope,
      label: t.label,
      created_at: t.created_at,
      last_viewed_at: t.last_viewed_at,
    })),
  };
}

/**
 * Vacations as CSV with category columns flattened in. Cancelled rows are
 * included (with a `cancelled_at` column) so the export is lossless — users
 * filtering in their spreadsheet can decide what to show.
 */
export function buildVacationsCsv(input: {
  categories: Category[];
  vacations: Vacation[];
}): string {
  const catsById = new Map(input.categories.map((c) => [c.id, c]));
  const headers = [
    "start_date",
    "end_date",
    "days",
    "partial_amount",
    "category_name",
    "category_color",
    "category_accrues",
    "public_desc",
    "internal_desc",
    "cancelled_at",
    "created_at",
    "updated_at",
    "id",
  ];
  const lines: string[] = [headers.join(",")];
  for (const v of input.vacations) {
    const cat = catsById.get(v.category_id);
    lines.push(
      [
        v.start_date,
        v.end_date,
        String(vacationDayCost(v)),
        v.partial_amount == null ? "" : String(v.partial_amount),
        cat?.name ?? "",
        cat?.color ?? "",
        cat?.accrues ? "true" : "false",
        v.public_desc,
        v.internal_desc,
        v.cancelled_at ?? "",
        v.created_at,
        v.updated_at,
        v.id,
      ]
        .map(csvField)
        .join(","),
    );
  }
  // Trailing CRLF per RFC 4180 — Excel needs it to recognise the last row.
  return lines.join("\r\n") + "\r\n";
}

/**
 * RFC 4180 field encoding: wrap in quotes and double inner quotes if the
 * value contains a comma, quote, CR, or LF.
 */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/**
 * Build a download-friendly filename for an export. Slugifies the username
 * so a Unicode display name doesn't trip Content-Disposition parsing.
 */
export function exportFilename(
  username: string,
  ext: "json" | "csv",
  now: Date = new Date(),
): string {
  const slug =
    username
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "user";
  const stamp = now.toISOString().slice(0, 10);
  return `afk-${slug}-${stamp}.${ext}`;
}
