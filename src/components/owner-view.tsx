/**
 * My Work › Owner (owner, Oct 1): who is doing what they should be doing, when they should be
 * doing it — one row per person (Role, Due today, Overdue, Done this week, Open opportunities,
 * Last activity), a totals row and a one-line digest above. Admins only: My Work renders this
 * only under `visibleToOwner(profile)`, and `listOwnerView` refuses anyone else on the server.
 * Definitions are in src/lib/owner-view.ts.
 *
 * Each number links into My Work for that person (`who`) with the List preset (`bucket`);
 * opportunity numbers link to the Opportunities list's open / overdue filter. Refreshes when the
 * window regains focus, every 60 s and on mount, like the counts strip.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import { listOwnerView } from "@/lib/owner-view.functions";
import {
  activityLabel,
  digestLine,
  dueTotal,
  myWorkHref,
  ownerTotals,
  visibleToOwner,
  type DueCounts,
} from "@/lib/owner-view";
import { OPP_ALL_OPEN } from "@/lib/work-counts";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const OWNER_VIEW_KEY = ["owner-view"] as const;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const linkCls = "font-semibold tabular-nums underline-offset-4 hover:underline";

/** "2 tickets · 1 task" — the non-zero parts of a Due today number. */
function dueParts(d: DueCounts): string {
  const parts: string[] = [];
  if (d.tickets) parts.push(`${d.tickets} ticket${d.tickets === 1 ? "" : "s"}`);
  if (d.tasks) parts.push(`${d.tasks} task${d.tasks === 1 ? "" : "s"}`);
  if (d.followups) parts.push(`${d.followups} follow-up${d.followups === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function OwnerView() {
  const { session, profile } = useAuth();
  const fn = useServerFn(listOwnerView);
  const q = useQuery({
    queryKey: OWNER_VIEW_KEY,
    queryFn: () => fn(),
    enabled: !!session && visibleToOwner(profile),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });

  // Errors toast the server's message.
  const errMsg = q.error ? errText(q.error) : null;
  useEffect(() => {
    if (errMsg) toast.error(`Could not load the owner view: ${errMsg}`, { id: "owner-view" });
  }, [errMsg]);

  const data = q.data;
  const totals = data ? ownerTotals(data.rows) : null;
  const now = new Date();

  return (
    <div className="space-y-3">
      {/* Blank until the numbers arrive (never a placeholder 0). */}
      <p className="min-h-5 text-sm font-medium">{totals ? digestLine(totals) : ""}</p>

      {errMsg && !data ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">Could not load the owner view: {errMsg}</p>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Due today</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="text-right">Done this week</TableHead>
                <TableHead className="text-right">Open opportunities</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-16 text-center text-muted-foreground">
                    {q.isLoading ? "Loading…" : ""}
                  </TableCell>
                </TableRow>
              ) : (
                data.rows.map((r) => {
                  const due = dueTotal(r.dueToday);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.role}</TableCell>
                      <TableCell className="text-right" title={dueParts(r.dueToday)}>
                        <Link {...myWorkHref(r.id, "today")} className={linkCls}>
                          {due}
                        </Link>
                        {due > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {dueParts(r.dueToday)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right ${r.overdue > 0 ? "text-destructive" : ""}`}
                      >
                        <Link {...myWorkHref(r.id, "overdue")} className={linkCls}>
                          {r.overdue}
                        </Link>
                        {r.overdueOpps > 0 && (
                          <div className="text-xs">
                            <Link
                              to="/opportunities"
                              search={{ status: OPP_ALL_OPEN, overdue: 1 }}
                              className="underline-offset-4 hover:underline"
                            >
                              incl. {r.overdueOpps} opportunit{r.overdueOpps === 1 ? "y" : "ies"}
                            </Link>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link {...myWorkHref(r.id, "done")} className={linkCls}>
                          {r.doneThisWeek}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to="/opportunities"
                          search={{ status: OPP_ALL_OPEN }}
                          className={linkCls}
                        >
                          {r.openOpps}
                        </Link>
                        {r.oppValue > 0 && (
                          <div className="text-xs text-muted-foreground">{usd(r.oppValue)}</div>
                        )}
                      </TableCell>
                      <TableCell
                        className={r.stale ? "font-medium text-destructive" : ""}
                        title={r.lastActivity ? new Date(r.lastActivity).toLocaleString() : ""}
                      >
                        {activityLabel(r.lastActivity, now)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
            {data && totals && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right">
                    <Link {...myWorkHref("all", "today")} className={linkCls}>
                      {totals.dueTickets + totals.dueTasks + totals.dueFollowups}
                    </Link>
                  </TableCell>
                  <TableCell
                    className={`text-right ${totals.overdue > 0 ? "text-destructive" : ""}`}
                  >
                    <Link {...myWorkHref("all", "overdue")} className={linkCls}>
                      {totals.overdue}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link {...myWorkHref("all", "done")} className={linkCls}>
                      {totals.doneThisWeek}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link to="/opportunities" search={{ status: OPP_ALL_OPEN }} className={linkCls}>
                      {totals.openOpps}
                    </Link>
                    {totals.oppValue > 0 && (
                      <div className="text-xs text-muted-foreground">{usd(totals.oppValue)}</div>
                    )}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      )}
      {data && !data.auditLog && (
        <p className="text-xs text-muted-foreground">
          Last activity: tickets, contact log, tasks and time entries (no audit log yet).
        </p>
      )}
    </div>
  );
}
