/**
 * /opportunities's search params (src/routes/opportunities.tsx validateSearch). Pure, so the
 * parsing is tested without the route.
 *
 *   ?id=<uuid>                 open that opportunity
 *   ?new=1                     a blank one
 *   ?status=<filter>[&overdue=1]
 *                              the list with its status chip preset — a single status or
 *                              `allopen` (every non-closing status) — and, with overdue=1, only
 *                              open opportunities past their expected close (the Customers page
 *                              counts strip)
 *   &assignee=<uuid>           the list: only that person's opportunities (the Owner view's
 *                              per-person numbers, owner-view.ts oppsHref)
 */
import { OPP_ALL_OPEN } from "@/lib/work-counts";

/** The statuses (OPP_STATUSES in opportunities.functions.ts; the test checks they agree). */
export const STATUS_VALUES = ["open", "contacted", "quoted", "won", "lost", "no_response"] as const;
export type StatusValue = (typeof STATUS_VALUES)[number];
/** The list's status chip: everything, "All open", or one status. */
export type StatusFilter = "all" | typeof OPP_ALL_OPEN | StatusValue;

export interface OpportunitiesSearch {
  id?: string;
  new?: 1;
  /** List only: the status chip to preset. */
  status?: Exclude<StatusFilter, "all">;
  /** List only: show only overdue open opportunities. */
  overdue?: 1;
  /** List only: show only the opportunities assigned to this user (a profile id). */
  assignee?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A profile id, or undefined for anything else. */
export const parseAssignee = (v: unknown): string | undefined =>
  typeof v === "string" && UUID.test(v) ? v : undefined;

/** The list filter `assignee=` presets (none = everyone's). */
export const matchesAssignee = (
  o: { assignee_id: string | null },
  assignee: string | undefined,
): boolean => !assignee || o.assignee_id === assignee;

const isOne = (v: unknown) => v === 1 || v === "1" || v === true;

export function parseStatusFilter(v: unknown): Exclude<StatusFilter, "all"> | undefined {
  if (v === OPP_ALL_OPEN) return OPP_ALL_OPEN;
  return typeof v === "string" && (STATUS_VALUES as readonly string[]).includes(v)
    ? (v as StatusValue)
    : undefined;
}

export function parseOpportunitiesSearch(s: Record<string, unknown>): OpportunitiesSearch {
  const id = s["id"];
  if (typeof id === "string" && id) return { id };
  if (isOne(s["new"])) return { new: 1 };
  const status = parseStatusFilter(s["status"]);
  const assignee = parseAssignee(s["assignee"]);
  return {
    ...(status ? { status } : {}),
    ...(isOne(s["overdue"]) ? { overdue: 1 as const } : {}),
    ...(assignee ? { assignee } : {}),
  };
}
