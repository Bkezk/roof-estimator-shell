/**
 * Setup's own History (owner, Nov 10: "a change on Setup leaves no record of who made it").
 * The database writes a row for every change to a service rate, the settings beside the rates
 * (authorizer, email wording, terms, tax, the confirm stamp), the material markup, a material's
 * price and the inspection checklist (triggers and save_checklist_items, migration
 * 20261110214000_setup_history.sql), one audit entity per Setup tab. Each tab shows who changed
 * it last and folds the last few lines.
 *
 * Pure: no database, no server imports (unit tested in setup-history-nov10b.test.ts).
 */
import type { AuditRow } from "@/lib/audit";

/** The Setup tabs that keep a History (Vehicles & drivers keeps its own driver history). */
export const SETUP_HISTORY_TABS = ["rates", "materials", "inspection"] as const;
export type SetupHistoryTab = (typeof SETUP_HISTORY_TABS)[number];

/** audit_log.entity for each tab (the entity check lists exactly these three for Setup). */
export const SETUP_HISTORY_ENTITY = {
  rates: "setup_rates",
  materials: "setup_materials",
  inspection: "setup_checklist",
} as const satisfies Record<SetupHistoryTab, string>;
export type SetupAuditEntity = (typeof SETUP_HISTORY_ENTITY)[SetupHistoryTab];
export const SETUP_AUDIT_ENTITIES: readonly SetupAuditEntity[] =
  Object.values(SETUP_HISTORY_ENTITY);

/** How many lines a tab's fold shows. */
export const SETUP_HISTORY_LIMIT = 20;

/**
 * "Last changed by Claude, Nov 10, 2026" from the newest row; null when nothing is logged yet
 * (every change before Nov 10, 2026 went unrecorded, so an empty list is not "never changed").
 */
export function lastChangedLine(
  rows: readonly Pick<AuditRow, "at" | "by_name">[],
  timeZone?: string,
): string | null {
  const r = rows[0];
  if (!r) return null;
  const when = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(r.at));
  return `Last changed by ${(r.by_name ?? "").trim() || "someone"}, ${when}`;
}
