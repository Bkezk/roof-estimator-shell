/**
 * The Margin report (owner, Oct 21), the Owner page's Margin tab: a date range (the last 12
 * months to start with), a Group by (Month, Customer, Technician), one table with a Totals row,
 * and Export CSV (the inventory export's way: toCsv + downloadBlob, no server round trip — the
 * rows on screen are the rows in the file). The numbers come from lib/margin-report.functions.ts;
 * the words for the help text and the columns are lib/margin-report.ts's. Admins only — the
 * server refuses anyone else; the tab is only offered to them.
 *
 * Read-only, so no number box; a loss reads in red like the invoice page's Internal fold. The
 * table scrolls sideways on a phone. Theme tokens only (dark mode).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { downloadBlob, money } from "@/components/service/invoice-utils";
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
import {
  MARGIN_GROUPS,
  MARGIN_GROUP_LABELS,
  defaultMarginRange,
  marginCsvFileName,
  marginCsvRows,
  marginRangeValid,
  type MarginGroupBy,
  type MarginReportResult,
  type MarginTotals,
} from "@/lib/margin-report";
import { listMarginReport } from "@/lib/margin-report.functions";
import { toCsv } from "@/lib/review-export";
import { localYmd } from "@/lib/tasks";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

/** One row of money cells (a group or the Totals), a loss in red. */
function MoneyCells({ t }: { t: MarginTotals }) {
  const loss = t.margin < 0 ? "text-destructive" : "";
  return (
    <>
      <TableCell className="text-right tabular-nums">{t.invoices}</TableCell>
      <TableCell className="text-right tabular-nums">{money(t.revenue)}</TableCell>
      <TableCell className="text-right tabular-nums">{money(t.material)}</TableCell>
      <TableCell className="text-right tabular-nums">{money(t.labor)}</TableCell>
      <TableCell className="text-right tabular-nums">{money(t.purchaseOrders)}</TableCell>
      <TableCell className="text-right tabular-nums">{money(t.other)}</TableCell>
      <TableCell className="text-right tabular-nums">{money(t.cost)}</TableCell>
      <TableCell className={`text-right font-medium tabular-nums ${loss}`}>
        {money(t.margin)}
      </TableCell>
      <TableCell className={`text-right tabular-nums ${loss}`}>{pct(t.marginPct)}</TableCell>
    </>
  );
}

export function MarginReport() {
  const { session } = useAuth();
  const fn = useServerFn(listMarginReport);
  const [range] = useState(() => defaultMarginRange(localYmd(new Date())));
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [groupBy, setGroupBy] = useState<MarginGroupBy>("month");
  const valid = marginRangeValid(from, to);
  const q = useQuery({
    queryKey: ["margin-report", from, to, groupBy],
    queryFn: () => fn({ data: { from, to, groupBy } }),
    enabled: !!session && valid,
    refetchOnWindowFocus: false,
  });
  const d: MarginReportResult | undefined = q.data;

  const exportCsv = () => {
    if (!d) return;
    const csv = toCsv(marginCsvRows(d));
    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      marginCsvFileName(d.groupBy, d.from, d.to),
    );
    toast.success(`Exported ${d.rows.length} row${d.rows.length === 1 ? "" : "s"} and the totals`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Margin</h2>
        <p className="text-sm text-muted-foreground">
          Final, sent and paid invoices only. Revenue is the invoice subtotal, before tax. Cost =
          material + labor &amp; travel + other lines + the ticket&apos;s approved purchase orders
          (each counted once, on the ticket&apos;s first invoice). Margin = revenue − cost; Margin %
          = margin ÷ revenue.
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
      {d && d.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No finalized invoices in this range.</p>
      )}
      {d && d.rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[56rem]">
            <TableHeader>
              <TableRow>
                <TableHead>{MARGIN_GROUP_LABELS[d.groupBy]}</TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
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
              {d.rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="whitespace-nowrap font-medium">{r.label}</TableCell>
                  <MoneyCells t={r} />
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">Totals</TableCell>
                <MoneyCells t={d.totals} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
