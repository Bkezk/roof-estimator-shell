/**
 * The Margin report (owner, Oct 21), under the tiles of the Owner page's Business tab: a date
 * range (the last 12 months to start with), a Group by (Month, Customer, Technician), a Compare
 * select, the charts (components/margin-charts.tsx), one table with a Totals row, the paid / sent
 * / final split under it, and Export CSV (the inventory export's way: toCsv + downloadBlob, no
 * server round trip — the rows on screen are the rows in the file). The numbers come from
 * lib/margin-report.functions.ts; the words for the help text and the columns are
 * lib/margin-report.ts's; the comparison's presets, alignment and change math are
 * lib/margin-compare.ts's. Admins only — the server refuses anyone else; the tab is only offered
 * to them.
 *
 * Extended the same day ("add more detail to the margin section and add some charts to track over
 * time with the ability to compare months/years"; "keep it before tax" — every figure here is the
 * invoice subtotal before tax, no toggle):
 *  - Hours and Avg / invoice columns.
 *  - Each group row expands (one at a time) to the invoices behind it, each linked to its page
 *    (/service/invoices?id=…), from the per-invoice rows the server already sent.
 *  - Compare: Off, This year vs last year, This month vs same month last year (both from today's
 *    local date), Custom (a second From/To pair, blank until filled). The earlier figure and the
 *    change sit under revenue, cost, margin and margin % in grey; the charts draw the earlier
 *    period faded; the CSV carries both periods.
 *
 * Won bids (owner, Oct 21: "do bids that are accepted go into that report? if not please add
 * them and have it to where you can filter just service, just bids, or both"; "there also needs
 * to be a way to adjust the date the bid was won"): an Include select after Group by — Service
 * and bids (the default), Service only, Bids only — in the query key, so the server reads only
 * what is asked for. A won bid is a row like an invoice (lib/margin-report.ts has the rules): in
 * the drill-down it links to the estimator with a small Bid badge, reads Won, and its Day cell is
 * a date box (Won on) that moves the day it counts on (bids.functions.ts setBidWonOn) and reloads
 * the report. A fourth status tile, Won bids, shows when bids are included. Won bids saved before
 * their cost figures existed are not counted; an amber notice lists them with links so each can
 * be opened and saved once.
 *
 * Read-only otherwise, so no number box; a loss reads in red like the invoice page's Internal
 * fold. The table scrolls sideways on a phone; a refetch holds the previous frame instead of
 * flashing. Theme tokens only (dark mode).
 */
import { Fragment, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { MarginCharts } from "@/components/margin-charts";
import { STATUS_LABELS, downloadBlob, money } from "@/components/service/invoice-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth-store";
import { STATUS_LABELS as BID_STATUS_LABELS } from "@/lib/bid-status";
import { setBidWonOn } from "@/lib/bids.functions";
import {
  COMPARE_LABELS,
  COMPARE_MODES,
  compareMargin,
  comparePreset,
  marginCsvRows,
  type CompareMode,
  type Compared,
  type Delta,
} from "@/lib/margin-compare";
import {
  MARGIN_AVG_LABELS,
  MARGIN_COUNT_LABELS,
  MARGIN_GROUPS,
  MARGIN_GROUP_LABELS,
  MARGIN_SOURCES,
  MARGIN_SOURCE_LABELS,
  MARGIN_SPLIT_STATUSES,
  STATUS_SPLIT_LABELS,
  defaultMarginRange,
  marginCsvFileName,
  marginGroupKey,
  marginRangeValid,
  statusSplit,
  type MarginGroupBy,
  type MarginInvoiceRow,
  type MarginReportResult,
  type MarginSource,
  type MarginTotals,
} from "@/lib/margin-report";
import { listMarginReport } from "@/lib/margin-report.functions";
import { toCsv } from "@/lib/review-export";
import { localYmd } from "@/lib/tasks";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);
/** "2.5", "10" — hours as written. */
const hours = (n: number) => String(Math.round(n * 100) / 100);
const signed = (n: number, f: (n: number) => string) =>
  n > 0 ? `+${f(n)}` : n < 0 ? `−${f(-n)}` : f(0);
/** "+$234.50 (+23.5%)" — the change in dollars and in percent of the earlier figure. */
const change = (d: Delta) =>
  `${signed(d.amount, money)}${d.pct === null ? "" : ` (${signed(d.pct, (p) => `${p.toFixed(1)}%`)})`}`;

const COLUMNS = 12;

/** The earlier figure and the change under a money cell (grey); "—" when the row has no earlier match. */
function Earlier({ earlier, delta }: { earlier: number | null; delta: Delta | null }) {
  return (
    <span className="block text-xs font-normal text-muted-foreground">
      {earlier === null || !delta ? "—" : `${money(earlier)} · ${change(delta)}`}
    </span>
  );
}

/** One row of money cells (a group or the Totals), a loss in red; with the comparison under each when on. */
function MoneyCells({ t, c }: { t: MarginTotals; c: Compared | null | undefined }) {
  const loss = t.margin < 0 ? "text-destructive" : "";
  const e = c?.earlier ?? null;
  return (
    <>
      <TableCell className="text-right tabular-nums">{t.invoices}</TableCell>
      <TableCell className="text-right tabular-nums">{hours(t.hours)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {money(t.revenue)}
        {c && <Earlier earlier={e ? e.revenue : null} delta={c.revenue} />}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {t.avgRevenue === null ? "—" : money(t.avgRevenue)}
      </TableCell>
      <TableCell className="text-right tabular-nums">{money(t.material)}</TableCell>
      <TableCell className="text-right tabular-nums">{money(t.labor)}</TableCell>
      <TableCell className="text-right tabular-nums">{money(t.purchaseOrders)}</TableCell>
      <TableCell className="text-right tabular-nums">{money(t.other)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {money(t.cost)}
        {c && <Earlier earlier={e ? e.cost : null} delta={c.cost} />}
      </TableCell>
      <TableCell className={`text-right font-medium tabular-nums ${loss}`}>
        {money(t.margin)}
        {c && <Earlier earlier={e ? e.margin : null} delta={c.margin} />}
      </TableCell>
      <TableCell className={`text-right tabular-nums ${loss}`}>
        {pct(t.marginPct)}
        {c && (
          <span className="block text-xs font-normal text-muted-foreground">
            {!e
              ? "—"
              : `${pct(e.marginPct)}${c.marginPct === null ? "" : ` · ${signed(c.marginPct, (p) => `${p.toFixed(1)} pts`)}`}`}
          </span>
        )}
      </TableCell>
    </>
  );
}

/** A row's status word: Won for a bid (lib/bid-status), the invoice labels otherwise. */
const rowStatus = (i: MarginInvoiceRow) =>
  i.status === "won" ? BID_STATUS_LABELS.won : STATUS_LABELS[i.status];

/**
 * The invoices and won bids behind an expanded group, newest first. A bid links to the estimator
 * and its Day is the Won on box: changing it moves the day the bid counts on (setBidWonOn) and
 * reloads the report. `source` picks the first column's heading.
 */
function InvoiceRows({ invoices, source }: { invoices: MarginInvoiceRow[]; source: MarginSource }) {
  const qc = useQueryClient();
  const wonOnFn = useServerFn(setBidWonOn);
  const moveWonOn = useMutation({
    mutationFn: (v: { id: string; wonOn: string }) => wonOnFn({ data: v }),
    onSuccess: (r) => {
      toast.success(`Won on ${r.won_on}`);
      void qc.invalidateQueries({ queryKey: ["margin-report"] });
    },
    onError: (e: unknown) => toast.error(`Could not move the won day: ${errText(e)}`),
  });
  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          <TableHead>
            {source === "bids" ? "Bid" : source === "both" ? "Invoice / bid" : "Invoice"}
          </TableHead>
          <TableHead>Day</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Technician / estimator</TableHead>
          <TableHead className="text-right">Hours</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Margin</TableHead>
          <TableHead className="text-right">Margin %</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((i) => {
          const loss = i.margin < 0 ? "text-destructive" : "";
          return (
            <TableRow key={i.id}>
              <TableCell className="whitespace-nowrap">
                {i.kind === "bid" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Link
                      to="/estimate"
                      search={{ bid: i.id }}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {i.number || "Bid"}
                    </Link>
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                      Bid
                    </Badge>
                  </span>
                ) : (
                  <Link
                    to="/service/invoices"
                    search={{ id: i.id }}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {i.number || "Invoice"}
                  </Link>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {i.kind === "bid" ? (
                  <Input
                    type="date"
                    aria-label="Won on"
                    title="The day the bid was won; the report counts it on this day."
                    className="h-7 w-[9.5rem] px-1.5 text-xs"
                    defaultValue={i.day}
                    key={`${i.id}-${i.day}`}
                    disabled={moveWonOn.isPending}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v && v !== i.day) moveWonOn.mutate({ id: i.id, wonOn: v });
                    }}
                  />
                ) : (
                  i.day
                )}
              </TableCell>
              <TableCell>{i.customer || "No customer name"}</TableCell>
              <TableCell>{i.ticket ? (i.technician ?? "Unassigned") : "No ticket"}</TableCell>
              <TableCell className="text-right tabular-nums">{hours(i.hours)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(i.revenue)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(i.cost)}</TableCell>
              <TableCell className={`text-right font-medium tabular-nums ${loss}`}>
                {money(i.margin)}
              </TableCell>
              <TableCell className={`text-right tabular-nums ${loss}`}>
                {pct(i.marginPct)}
              </TableCell>
              <TableCell>{rowStatus(i)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

const byDayDesc = (a: MarginInvoiceRow, b: MarginInvoiceRow) =>
  (a.day < b.day ? 1 : a.day > b.day ? -1 : 0) || a.number.localeCompare(b.number);

export function MarginReport() {
  const { session } = useAuth();
  const fn = useServerFn(listMarginReport);
  const [range] = useState(() => defaultMarginRange(localYmd(new Date())));
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [groupBy, setGroupBy] = useState<MarginGroupBy>("month");
  // Include (owner, Oct 21): service invoices, won bids, or both.
  const [source, setSource] = useState<MarginSource>("both");
  const [compareMode, setCompareMode] = useState<CompareMode>("off");
  // The comparison's own From / To: blank until a preset fills them or Custom is typed into.
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const valid = marginRangeValid(from, to);
  const comparing = compareMode !== "off";
  const compareValid = comparing && marginRangeValid(compareFrom, compareTo);
  const compare = compareValid ? { from: compareFrom, to: compareTo } : undefined;

  const pickCompare = (mode: CompareMode) => {
    setCompareMode(mode);
    if (mode === "year" || mode === "month") {
      const p = comparePreset(mode, localYmd(new Date()));
      setFrom(p.from);
      setTo(p.to);
      setCompareFrom(p.compare.from);
      setCompareTo(p.compare.to);
    } else {
      setCompareFrom("");
      setCompareTo("");
    }
  };

  const q = useQuery({
    queryKey: ["margin-report", from, to, groupBy, source, compare?.from ?? "", compare?.to ?? ""],
    queryFn: () => fn({ data: { from, to, groupBy, source, ...(compare ? { compare } : {}) } }),
    enabled: !!session && valid,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
  const d: MarginReportResult | undefined = q.data;
  const compared = d ? compareMargin(d) : null;
  const split = d ? statusSplit(d.invoices) : null;

  const exportCsv = () => {
    if (!d) return;
    const csv = toCsv(marginCsvRows(d));
    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      marginCsvFileName(d.groupBy, d.from, d.to, d.comparison),
    );
    toast.success(
      `Exported ${d.rows.length} row${d.rows.length === 1 ? "" : "s"} and the totals${d.comparison ? ", with the earlier period" : ""}`,
    );
  };

  const invoicesOf = (key: string) =>
    d ? d.invoices.filter((i) => marginGroupKey(i, d.groupBy).key === key).sort(byDayDesc) : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Margin</h2>
        <p className="text-sm text-muted-foreground">
          Final, sent and paid invoices only. Revenue is the invoice subtotal, before tax. Cost =
          material + labor &amp; travel + other lines + the ticket&apos;s purchase orders (each
          counted once, on the ticket&apos;s first invoice). Margin = revenue − cost; Margin % =
          margin ÷ revenue. Hours are the labor and travel hours on the invoices. Compare shows the
          earlier period in grey and the change beside each figure. Won bids count too (Include):
          revenue is the bid total before tax; cost is the bid&apos;s material, labor, subs and
          services, warranty, shipping, per diem and commission; counted on its Won-on day (editable
          here and in the estimator).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="margin-from">From</Label>
          <Input
            id="margin-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-[11rem]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="margin-to">To</Label>
          <Input
            id="margin-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-[11rem]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="margin-group">Group by</Label>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as MarginGroupBy)}>
            <SelectTrigger id="margin-group" className="w-[11rem]" aria-label="Group by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MARGIN_GROUPS.map((g) => (
                <SelectItem key={g} value={g}>
                  {MARGIN_GROUP_LABELS[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="margin-source">Include</Label>
          <Select value={source} onValueChange={(v) => setSource(v as MarginSource)}>
            <SelectTrigger id="margin-source" className="w-[11rem]" aria-label="Include">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MARGIN_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {MARGIN_SOURCE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="margin-compare">Compare</Label>
          <Select value={compareMode} onValueChange={(v) => pickCompare(v as CompareMode)}>
            <SelectTrigger id="margin-compare" className="w-[17rem]" aria-label="Compare">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPARE_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {COMPARE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {compareMode === "custom" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="margin-compare-from">Compare from</Label>
              <Input
                id="margin-compare-from"
                type="date"
                value={compareFrom}
                onChange={(e) => setCompareFrom(e.target.value)}
                className="w-[11rem]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="margin-compare-to">Compare to</Label>
              <Input
                id="margin-compare-to"
                type="date"
                value={compareTo}
                onChange={(e) => setCompareTo(e.target.value)}
                className="w-[11rem]"
              />
            </div>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={!d || d.rows.length === 0}
          onClick={exportCsv}
        >
          <FileDown className="mr-1.5 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {(compareMode === "year" || compareMode === "month") && compare && (
        <p className="text-sm text-muted-foreground">
          Comparing with {compare.from} to {compare.to}.
        </p>
      )}
      {compareMode === "custom" && !compareValid && (
        <p className="text-sm text-muted-foreground">
          Pick the comparison&apos;s from and to dates (from on or before to).
        </p>
      )}

      {!valid && (
        <p className="text-sm text-destructive">Pick a from and to date (from on or before to).</p>
      )}
      {valid && q.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      )}
      {valid && q.error && (
        <div className="space-y-2">
          <p className="text-sm text-destructive">
            Could not load the margin report: {errText(q.error)}
          </p>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {d && d.bidsWithoutFigures.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {d.bidsWithoutFigures.length} won bid{d.bidsWithoutFigures.length === 1 ? "" : "s"} have
          no cost figures yet (saved before Oct 21, 2026) and are not counted: open each in the
          estimator and save it once.{" "}
          {d.bidsWithoutFigures.map((b, n) => (
            <Fragment key={b.id}>
              {n > 0 && ", "}
              <Link
                to="/estimate"
                search={{ bid: b.id }}
                className="font-medium underline-offset-2 hover:underline"
              >
                {b.name || "Bid"}
              </Link>
            </Fragment>
          ))}
        </p>
      )}
      {d && d.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {d.source === "service"
            ? "No finalized invoices in this range."
            : d.source === "bids"
              ? "No won bids in this range."
              : "No finalized invoices or won bids in this range."}
        </p>
      )}
      {d && d.rows.length > 0 && (
        <div className={`space-y-4 ${q.isFetching ? "opacity-60 transition-opacity" : ""}`}>
          <MarginCharts d={d} />

          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[64rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>{MARGIN_GROUP_LABELS[d.groupBy]}</TableHead>
                  <TableHead className="text-right">{MARGIN_COUNT_LABELS[d.source]}</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">{MARGIN_AVG_LABELS[d.source]}</TableHead>
                  <TableHead className="text-right">Material</TableHead>
                  <TableHead className="text-right">Labor &amp; travel</TableHead>
                  <TableHead className="text-right">Purchase orders</TableHead>
                  <TableHead className="text-right">Other</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.rows.map((r) => {
                  const isOpen = open === r.key;
                  const c = compared?.rows.get(r.key);
                  const detailId = `margin-row-${r.key.replace(/[^\w-]/g, "_")}`;
                  return (
                    <Fragment key={r.key}>
                      <TableRow>
                        <TableCell className="whitespace-nowrap font-medium">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-expanded={isOpen}
                            aria-controls={detailId}
                            onClick={() => setOpen(isOpen ? null : r.key)}
                          >
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            {r.label}
                          </button>
                          {c?.earlierLabel && d.groupBy === "month" && (
                            <span className="block pl-5 text-xs font-normal text-muted-foreground">
                              vs {c.earlierLabel}
                            </span>
                          )}
                        </TableCell>
                        <MoneyCells t={r} c={compared ? c : null} />
                      </TableRow>
                      {isOpen && (
                        <TableRow id={detailId} className="bg-muted/40 hover:bg-muted/40">
                          <TableCell colSpan={COLUMNS} className="p-2 pl-6">
                            <InvoiceRows invoices={invoicesOf(r.key)} source={d.source} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">
                    Totals
                    {compared && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        vs {d.comparison?.from} to {d.comparison?.to}
                      </span>
                    )}
                  </TableCell>
                  <MoneyCells t={d.totals} c={compared?.totals} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {split && (
            <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {/* The Won bids tile only when bids are included (owner, Oct 21). */}
              {MARGIN_SPLIT_STATUSES.filter((s) => s !== "won" || source !== "service").map((s) => (
                <div key={s} className="rounded-md border px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{STATUS_SPLIT_LABELS[s]}</dt>
                  <dd className="flex items-baseline justify-between gap-2">
                    <span className="font-medium tabular-nums">{money(split[s].revenue)}</span>
                    <span className="text-xs text-muted-foreground">
                      {split[s].invoices} {s === "won" ? "bid" : "invoice"}
                      {split[s].invoices === 1 ? "" : "s"}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
