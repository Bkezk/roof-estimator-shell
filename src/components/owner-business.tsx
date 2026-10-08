/**
 * The Owner view's Business tab (owner, Oct 8): four money tiles — Waiting to invoice, Unpaid,
 * Invoiced this month, Pipeline — then purchase orders waiting, Won / Lost, and a "Going stale"
 * strip. Every tile is a link to the list already filtered to what it counts. Blank until the
 * numbers arrive (never a placeholder 0); an empty queue reads "—".
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth-store";
import { localYmd } from "@/lib/tasks";
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
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <a
      href={href}
      className={className}
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
  tone = "",
}: {
  title: string;
  value: ReactNode;
  sub?: ReactNode;
  href: string;
  tone?: string;
}) {
  return (
    <Go
      href={href}
      className={`block rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50 ${tone}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-1 min-h-8 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="min-h-4 text-xs text-muted-foreground">{sub}</p>
    </Go>
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
  const lastMonth = d?.invoiced.lastMonth;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          title="Waiting to invoice"
          href={BUSINESS_HREFS.toInvoice}
          value={d ? (d.toInvoice.count === 0 ? "—" : d.toInvoice.count) : ""}
          sub={
            d
              ? d.toInvoice.count
                ? `Done tickets · ${days(d.toInvoice.oldestDays)}`
                : "Nothing waiting"
              : ""
          }
          tone={d && d.toInvoice.count > 0 ? "border-amber-300 dark:border-amber-700" : ""}
        />
        <Tile
          title="Unpaid"
          href={BUSINESS_HREFS.unpaid}
          value={d ? money(d.unpaid.total, d.unpaid.count) : ""}
          sub={
            d
              ? d.unpaid.count
                ? `${count(d.unpaid.count, "invoice")} · ${days(d.unpaid.oldestDays)}`
                : "Nothing outstanding"
              : ""
          }
          tone={d && d.unpaid.count > 0 ? "border-amber-300 dark:border-amber-700" : ""}
        />
        <Tile
          title="Invoiced this month"
          href={BUSINESS_HREFS.invoiced}
          value={d ? money(d.invoiced.month.total, d.invoiced.month.count) : ""}
          sub={
            d
              ? `${count(d.invoiced.month.count, "invoice")}${lastMonth ? ` · last month ${lastMonth.count ? USD.format(lastMonth.total) : "—"}` : ""}`
              : ""
          }
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
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Tile
          title="Purchase orders waiting for approval"
          href={BUSINESS_HREFS.pos}
          value={d ? money(d.pos.total, d.pos.count) : ""}
          sub={d ? (d.pos.count ? count(d.pos.count, "purchase order") : "None waiting") : ""}
          tone={d && d.pos.count > 0 ? "border-amber-300 dark:border-amber-700" : ""}
        />
        <Tile
          title="Won / Lost this month"
          href={BUSINESS_HREFS.pipeline}
          value={d ? `${d.pipeline.wonThisMonth} / ${d.pipeline.lostThisMonth}` : ""}
          sub={d ? "By the opportunity's last update" : ""}
        />
      </div>
      <section className="rounded-lg border p-3">
        <h2 className="text-sm font-semibold">Going stale</h2>
        <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <li>
            <Go href={BUSINESS_HREFS.pastDue} className="hover:underline">
              <span className="font-semibold tabular-nums">{d ? d.stale.pastDue : ""}</span> tickets
              past their scheduled day
            </Go>
          </li>
          <li>
            <Go href={BUSINESS_HREFS.untouched} className="hover:underline">
              <span className="font-semibold tabular-nums">
                {d ? (d.stale.untouchedTickets ?? "n/a") : ""}
              </span>{" "}
              tickets untouched past Setup&apos;s limit
            </Go>
          </li>
          <li>
            <Go href={BUSINESS_HREFS.untouched} className="hover:underline">
              <span className="font-semibold tabular-nums">
                {d ? (d.stale.untouchedOpps ?? "n/a") : ""}
              </span>{" "}
              opportunities untouched past Setup&apos;s limit
            </Go>
          </li>
          <li>
            <Go href={BUSINESS_HREFS.snoozed} className="hover:underline">
              <span className="font-semibold tabular-nums">{d ? d.stale.snoozed : ""}</span>{" "}
              follow-ups snoozed right now
            </Go>
          </li>
        </ul>
      </section>
    </div>
  );
}
