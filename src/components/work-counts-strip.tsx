/**
 * The counts strip above the Customers page (owner, Oct 1): open and overdue service tickets,
 * open and overdue opportunities. Each tile links to the list with that filter preset
 * (lib/work-counts.ts tileHref; definitions there). The numbers are counted under the caller's
 * login (work-counts.functions.ts), so they are what this user can see.
 *
 * Refreshes when the window regains focus, every 60 s, on mount, and whenever the ticket or
 * opportunity lists are invalidated (a save) while it is on screen.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth-store";
import { localYmd } from "@/lib/my-work";
import { getWorkCounts } from "@/lib/work-counts.functions";
import { tileHref, WORK_TILES } from "@/lib/work-counts";
import { tileBlockedTitle } from "@/lib/work-tile-access";

export const WORK_COUNTS_KEY = ["work-counts"] as const;
/** Query keys whose invalidation (a ticket or opportunity save) also refreshes the counts. */
const SOURCE_KEYS = new Set(["service-jobs", "opportunities"]);

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function WorkCountsStrip() {
  const { session, profile } = useAuth();
  const qc = useQueryClient();
  const countsFn = useServerFn(getWorkCounts);
  // The viewer's own day (audit, Oct 2: Work Overview, the Opportunities list, the Owner view and
  // this strip must agree on "today"); the key carries it so a new day refetches.
  const today = localYmd(new Date());
  const counts = useQuery({
    queryKey: [...WORK_COUNTS_KEY, today],
    queryFn: () => countsFn({ data: { today } }),
    enabled: !!session,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (counts.error)
      toast.error(`Could not load the counts: ${errText(counts.error)}`, { id: "work-counts" });
  }, [counts.error]);

  useEffect(
    () =>
      qc.getQueryCache().subscribe((ev) => {
        if (ev.type !== "updated" || ev.action.type !== "invalidate") return;
        const head = ev.query.queryKey[0];
        if (typeof head === "string" && SOURCE_KEYS.has(head))
          void qc.invalidateQueries({ queryKey: WORK_COUNTS_KEY });
      }),
    [qc],
  );

  const data = counts.data;
  return (
    <nav aria-label="Open and overdue work" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {WORK_TILES.map((t) => {
        const n = data ? data[t.kind] : null;
        const red = t.overdue && n !== null && n > 0;
        const body = (
          <>
            {/* Blank until the count arrives (never a placeholder 0). */}
            <span
              className={`min-h-9 text-3xl font-bold tabular-nums leading-9 ${
                t.overdue && !red ? "text-muted-foreground" : ""
              }`}
            >
              {n === null ? "" : n}
            </span>
            <span className={`text-sm font-medium ${red ? "" : "text-muted-foreground"}`}>
              {t.label}
            </span>
          </>
        );
        const tone = red ? "border-destructive/40 bg-destructive/10 text-destructive" : "bg-card";
        // A tile links only to a page this user may open (the gate would bounce them to My
        // Work); otherwise the number stands alone, titled "Needs Service access".
        const blocked = tileBlockedTitle(profile, t.kind);
        if (blocked)
          return (
            <div
              key={t.kind}
              title={blocked}
              data-tile-blocked=""
              className={`flex flex-col gap-1 rounded-lg border p-3 ${tone}`}
            >
              {body}
            </div>
          );
        return (
          <Link
            key={t.kind}
            {...tileHref(t.kind)}
            className={`flex flex-col gap-1 rounded-lg border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone} ${
              red ? "hover:bg-destructive/15" : "hover:bg-muted/50"
            }`}
          >
            {body}
          </Link>
        );
      })}
    </nav>
  );
}
