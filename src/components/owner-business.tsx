/**
 * The Owner view's Business tab (owner, Oct 8): the money in flight — Authorized, not invoiced
 * (the Awaiting invoice queue; owner, Oct 12, item 6), Pipeline, Won / Lost — and the follow-ups
 * on hold. "Invoiced this month" left on Oct 21 (owner: redundant — the margin report under
 * these tiles has the month, before tax, with its cost); "Purchase orders waiting for approval"
 * left on Oct 28 (owner: approval is gone, every PO is a cost). On Nov 16 the owner took off
 * everything the People tab's Needs attention list already shows ("i dont want double info"):
 * the Done tickets awaiting authorization, the Unpaid tile, tickets past their day and the
 * untouched tickets and opportunities. Every tile is a link to the list already filtered to
 * what it counts. Blank until the numbers arrive (never a placeholder 0); an empty queue reads
 * "—".
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth-store";
import { localYmd } from "@/lib/tasks";
import { OFFER_DAYS, OFFER_REPORT_KEY, OFFER_REPORT_NOTE, offerLine } from "@/lib/care-plan-offers";
import { listCarePlanOffers } from "@/lib/care-plan-offers.functions";
import { BUSINESS_HREFS, USD, money, type BusinessNumbers } from "@/lib/owner-business";
import { listOwnerBusiness } from "@/lib/owner-business.functions";
import { visibleToOwner } from "@/lib/owner-view";
import { Button } from "@/components/ui/button";

export const OWNER_BUSINESS_KEY = ["owner-business"] as const;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const days = (n: number | null) =>
  n === null ? "" : n === 0 ? "oldest today" : `oldest ${n} day${n === 1 ? "" : "s"}`;

/** A link that may carry a query string (the typed <Link to> takes route paths only). */
function Go({
  href,
  className,
  title,
  children,
}: {
  href: string;
  className?: string;
  /** Help text (the browser's tooltip) saying what the number counts. */
  title?: string | undefined;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <a
      href={href}
      className={className}
      title={title}
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

function Tile({
  title,
  value,
  sub,
  href,
  help,
  tone = "",
}: {
  title: string;
  value: ReactNode;
  sub?: ReactNode;
  href: string;
  /** What the number counts, as the tile's tooltip. */
  help?: string;
  tone?: string;
}) {
  return (
    <Go
      href={href}
      title={help}
      className={`block rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50 ${tone}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-1 min-h-8 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="min-h-4 text-xs text-muted-foreground">{sub}</p>
    </Go>
  );
}

/**
 * Was the Roof Care plan offered? (owner, Nov 19): for each technician, on how many of the
 * tickets they finished Care Plan was opened. The ones who open it least come first.
 */
function CarePlanOffered() {
  const { session, profile } = useAuth();
  const fn = useServerFn(listCarePlanOffers);
  const q = useQuery({
    queryKey: OFFER_REPORT_KEY,
    queryFn: () => fn({ data: { today: localYmd(new Date()) } }),
    enabled: !!session && visibleToOwner(profile),
    refetchOnMount: "always",
    staleTime: 60_000,
  });
  const d = q.data;
  return (
    <section className="rounded-lg border p-3" data-business-care-offers>
      <h2 className="text-sm font-semibold">Care Plan offered, last {OFFER_DAYS} days</h2>
      {q.error && (
        <p className="mt-2 text-sm text-destructive">Could not load it: {errText(q.error)}</p>
      )}
      {d && d.rows.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          No ticket was finished at a property without a plan.
        </p>
      )}
      {d && d.rows.length > 0 && (
        <>
          <p className="mt-2 text-sm font-medium" data-care-offers-total>
            {offerLine(d.total)}
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {d.rows.map((r) => (
              <li key={r.id ?? "none"} data-care-offers-row={r.id ?? "none"}>
                <span className="font-medium">{r.name}:</span>{" "}
                <span className={r.shown < r.finished ? "text-amber-700 dark:text-amber-400" : ""}>
                  {offerLine(r)}
                </span>
                {r.missed.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    Not opened on{" "}
                    {r.missed.slice(0, 8).map((m, n) => (
                      <span key={m.id}>
                        {n > 0 && ", "}
                        <Go href={`/service?id=${m.id}`} className="underline underline-offset-2">
                          #{m.number ?? "?"}
                        </Go>
                      </span>
                    ))}
                    {r.missed.length > 8 ? `, and ${r.missed.length - 8} more` : ""}.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{OFFER_REPORT_NOTE}</p>
    </section>
  );
}

export function OwnerBusiness() {
  const { session, profile } = useAuth();
  const fn = useServerFn(listOwnerBusiness);
  const q = useQuery({
    queryKey: OWNER_BUSINESS_KEY,
    queryFn: () => fn({ data: { today: localYmd(new Date()) } }),
    enabled: !!session && visibleToOwner(profile),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const errMsg = q.error ? errText(q.error) : null;
  useEffect(() => {
    if (errMsg) toast.error(`Could not load the business numbers: ${errMsg}`, { id: "owner-biz" });
  }, [errMsg]);
  const d: BusinessNumbers | undefined = q.data;

  if (errMsg && !d)
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">Could not load the business numbers: {errMsg}</p>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
          Try again
        </Button>
      </div>
    );

  const count = (n: number | undefined, word: string) =>
    n === undefined ? "" : `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          title="Authorized, not invoiced"
          help="Tickets marked Authorized that are not invoiced yet (one with a draft still counts) — the Invoices page's Awaiting invoice queue and Work Overview's Authorized — to invoice group. Aged from the day they were authorized."
          href={BUSINESS_HREFS.toInvoice}
          value={d ? (d.toInvoice.count === 0 ? "—" : d.toInvoice.count) : ""}
          sub={
            d
              ? d.toInvoice.count
                ? `Authorized tickets not invoiced yet · ${days(d.toInvoice.oldestDays)}`
                : "Nothing authorized is waiting for an invoice"
              : ""
          }
          tone={d && d.toInvoice.count > 0 ? "border-amber-300 dark:border-amber-700" : ""}
        />
        <Tile
          title="Pipeline"
          href={BUSINESS_HREFS.pipeline}
          value={d ? money(d.pipeline.open.value, d.pipeline.open.count) : ""}
          sub={
            d
              ? `${count(d.pipeline.open.count, "open opportunity").replace("opportunitys", "opportunities")}${
                  d.pipeline.closingThisMonth.count
                    ? ` · ${d.pipeline.closingThisMonth.count} closing this month (${USD.format(d.pipeline.closingThisMonth.value)})`
                    : ""
                }`
              : ""
          }
        />
        <Tile
          title="Won / Lost this month"
          help="Bids marked Won, by their Won-on day (editable in the estimator and in the margin report), and bids marked Lost, by the day the status changed."
          href={BUSINESS_HREFS.bids}
          value={d ? `${d.pipeline.wonThisMonth} / ${d.pipeline.lostThisMonth}` : ""}
          sub={d ? "Bids, by the Won-on day · lost by status change" : ""}
        />
      </div>
      {/* Owner, Nov 16: tickets past their day and the untouched tickets and opportunities left
          this strip (the Needs attention list on the People tab has them). The holds stay:
          that list only says how many of ITS rows are held. */}
      <CarePlanOffered />
      <section className="rounded-lg border p-3" data-business-holds>
        <h2 className="text-sm font-semibold">On hold</h2>
        <p className="mt-2 text-sm">
          <Go href={BUSINESS_HREFS.snoozed} className="hover:underline">
            <span className="font-semibold tabular-nums">{d ? d.stale.snoozed : ""}</span>{" "}
            follow-ups snoozed right now
          </Go>
        </p>
      </section>
    </div>
  );
}
