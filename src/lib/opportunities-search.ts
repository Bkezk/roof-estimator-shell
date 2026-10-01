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
}

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
  return {
    ...(status ? { status } : {}),
    ...(isOne(s["overdue"]) ? { overdue: 1 as const } : {}),
  };
}
