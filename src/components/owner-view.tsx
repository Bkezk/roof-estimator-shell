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
 *
 * Clicking a person's row (or its chevron) expands it in place (owner, Oct 1: "a bit more detail
 * per person"): their Today / Overdue / Done this week items — exactly the ones the numbers
 * count — and their last five actions, loaded on demand per person (`getOwnerPersonDetail`,
 * cached 60 s). "Expand all / Collapse all" above the table. On a phone the detail sits under
 * its row inside the table and scrolls with it.
 */
import { Fragment, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import { ymdParts } from "@/lib/my-work";
import { getOwnerPersonDetail, listOwnerView } from "@/lib/owner-view.functions";
import {
  DETAIL_KIND_LABELS,
  activityLabel,
  activityWhen,
  digestLine,
  dueTotal,
  myWorkHref,
  ownerTotals,
  visibleToOwner,
  type DetailKind,
  type DueCounts,
} from "@/lib/owner-view";
import { OPP_ALL_OPEN } from "@/lib/work-counts";
import { Badge } from "@/components/ui/badge";
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
/** One person's expanded detail (cached 60 s per person). */
const ownerPersonKey = (userId: string) => ["owner-view-person", userId] as const;
const DETAIL_STALE_MS = 60_000;

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

  // Expanded rows by person id; one row's expansion leaves the others as they are.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOpen = !!data && data.rows.length > 0 && data.rows.every((r) => open.has(r.id));
  // A click on the row toggles it, except on its links and buttons (they do their own thing).
  const onRowClick = (id: string) => (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest("a, button")) return;
    toggle(id);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Blank until the numbers arrive (never a placeholder 0). */}
        <p className="min-h-5 text-sm font-medium">{totals ? digestLine(totals) : ""}</p>
        {data && data.rows.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen(allOpen ? new Set() : new Set(data.rows.map((r) => r.id)))}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        )}
      </div>

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
                  const isOpen = open.has(r.id);
                  const detailId = `owner-detail-${r.id}`;
                  return (
                    <Fragment key={r.id}>
                      <TableRow
                        className="cursor-pointer"
                        aria-expanded={isOpen}
                        onClick={onRowClick(r.id)}
                      >
                        <TableCell className="font-medium">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-left font-medium hover:underline"
                            aria-expanded={isOpen}
                            aria-controls={isOpen ? detailId : undefined}
                            aria-label={`${isOpen ? "Hide" : "Show"} ${r.name}'s items`}
                            onClick={() => toggle(r.id)}
                          >
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
                            )}
                            {r.name}
                          </button>
                        </TableCell>
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
                      {isOpen && (
                        <TableRow id={detailId} className="hover:bg-transparent">
                          <TableCell colSpan={7} className="bg-muted/30 p-3 align-top">
                            <PersonDetail userId={r.id} name={r.name} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
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

const DETAIL_KIND_CLASS: Record<DetailKind, string> = {
  ticket:
    "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
  inspection:
    "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200",
  task: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  followup:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  opportunity:
    "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
};

/** "Wed, Sep 30" for a YYYY-MM-DD day (a calendar day, no time zone shift). */
const dayLabel = (ymd: string) => {
  const [y, m, d] = ymdParts(ymd);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

/** An in-app link (a plain href such as "/service?id=…"), opened by the router. */
function ItemLink({ href, children }: { href: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <a
      href={href}
      className="font-medium underline-offset-4 hover:underline"
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        void navigate({ href });
      }}
    >
      {children}
    </a>
  );
}

interface DetailLine {
  key: string;
  kind: DetailKind;
  title: string;
  where: string | null;
  when: string;
  href: string;
}

function DetailGroup({
  title,
  empty,
  lines,
}: {
  title: string;
  empty: string;
  lines: DetailLine[];
}) {
  // Owner (Oct 1): "a bit more standardized … so the text isn't so up and down": every group is a
  // bordered card with a header bar, and every line is the same three cells — badge, title with
  // the customer / property under it, the date right-aligned — divided by rules.
  return (
    <section className="min-w-0 overflow-hidden rounded-md border">
      <h4 className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-sm font-semibold">
        {title}
        <span className="font-normal tabular-nums text-muted-foreground">{lines.length}</span>
      </h4>
      {lines.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">
          {lines.map((l) => (
            <li
              key={l.key}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-2 text-sm"
            >
              <Badge variant="outline" className={`mt-0.5 shrink-0 ${DETAIL_KIND_CLASS[l.kind]}`}>
                {DETAIL_KIND_LABELS[l.kind]}
              </Badge>
              <span className="min-w-0">
                <span className="block truncate leading-snug" title={l.title}>
                  <ItemLink href={l.href}>{l.title}</ItemLink>
                </span>
                {l.where && (
                  <span className="block truncate text-xs text-muted-foreground" title={l.where}>
                    {l.where}
                  </span>
                )}
              </span>
              <span className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                {l.when}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The expanded row: one person's items (what the numbers count) and last five actions. */
function PersonDetail({ userId, name }: { userId: string; name: string }) {
  const fn = useServerFn(getOwnerPersonDetail);
  const q = useQuery({
    queryKey: ownerPersonKey(userId),
    queryFn: () => fn({ data: { userId } }),
    staleTime: DETAIL_STALE_MS,
  });
  // Errors toast the server's message.
  const errMsg = q.error ? errText(q.error) : null;
  useEffect(() => {
    if (errMsg)
      toast.error(`Could not load ${name}'s items: ${errMsg}`, { id: `owner-person-${userId}` });
  }, [errMsg, name, userId]);

  const d = q.data;
  if (!d) {
    return errMsg ? (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-destructive">
          Could not load {name}'s items: {errMsg}
        </p>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
          Try again
        </Button>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );
  }
  const now = new Date();
  const dated = (date: string | null) => (date ? dayLabel(date) : "No date");
  return (
    <div className="grid gap-4 whitespace-normal md:grid-cols-2 xl:grid-cols-4">
      <DetailGroup
        title="Today"
        empty="Nothing due today"
        lines={d.today.map((i) => ({ ...i, when: dated(i.date) }))}
      />
      <DetailGroup
        title="Overdue"
        empty="Nothing overdue"
        lines={d.overdue.map((i) => ({ ...i, when: dated(i.date) }))}
      />
      <DetailGroup
        title="Done this week"
        empty="Nothing done this week"
        lines={d.doneThisWeek.map((i) => ({
          key: `${i.kind}:${i.id}`,
          kind: i.kind,
          title: i.title,
          where: i.customer,
          when: activityWhen(i.when, now),
          href: i.href,
        }))}
      />
      <section className="min-w-0 overflow-hidden rounded-md border">
        <h4 className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-sm font-semibold">
          Last activity
          <span className="font-normal tabular-nums text-muted-foreground">{d.recent.length}</span>
        </h4>
        {d.recent.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">No activity yet</p>
        ) : (
          <ul className="divide-y">
            {d.recent.map((a, i) => (
              <li
                key={`${a.at}-${i}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-2 text-sm"
              >
                <span className="min-w-0 break-words leading-snug">
                  {a.href ? <ItemLink href={a.href}>{a.text}</ItemLink> : a.text}
                </span>
                <span className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                  {activityWhen(a.at, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
