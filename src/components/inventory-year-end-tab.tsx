/**
 * Inventory › Year end (owner, Nov 16: "as far as reporting for EOY stuff, is it as efficient
 * and good as it could be especially with the reconciliation part" … "How does it handle a
 * situation where there's stock bought for x amount of dollars then the same material bought
 * later for more/less money?" … "Go with all 6, also is it exportable?").
 *
 * Before this, inventory's value was today's Setup price times what was on hand: nothing kept
 * what stock cost when it came in, and there was no summary of a year. Now every entry that
 * brings stock in can carry the price paid, each item has an average cost, and the server
 * (inventory-cost.functions.ts getYearEnd) works out a summary whose lines add up to the closing
 * value. This tab is that summary for a bookkeeper at year end, top to bottom:
 *
 *  1. Period: This year, Last year (calendar years on the office's clock) or any From..To, and
 *     Export this summary (the same CSV as the Export dialog's Year summary).
 *  2. Warnings, only when there is something to warn about. The numbers are only as good as the
 *     prices typed, so the page says so before it shows a single dollar: entries with no price
 *     (the dollars are an estimate), items with no cost at all (left out of the dollars), items
 *     below zero (the count is wrong, so the value is).
 *  3. Totals: the year as one sum, each line with its sign, ending in the closing value.
 *  4. By category: the same lines per item, quantity over dollars.
 *  5. Entries that need a price: the fix for warning one. Typing what was paid here corrects
 *     every number that followed from that entry, so this list is how an estimate becomes a
 *     figure the bookkeeper can sign.
 *
 * Admins and managers only: the page mounts this tab only for them and the server refuses anyone
 * else (dollars in inventory are theirs, owner, Oct 15), so dollars show throughout with no
 * second check here.
 *
 * The readers are office staff: the words are plain, the help under each total is printed (a
 * hover note does not exist on a phone) and also set as the hover note, the price box starts
 * blank, and every sentence and sum that could be tested without a browser lives in
 * lib/inventory-year-range.ts.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarRange,
  ChevronDown,
  ChevronRight,
  FileDown,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { downloadBlob } from "@/components/service/invoice-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDollars } from "@/lib/inventory-cost";
import { getYearEnd, setEntryPrice } from "@/lib/inventory-cost.functions";
import { exportInventoryCsv } from "@/lib/inventory-export.functions";
import {
  officeToday,
  type UnpricedEntry,
  type YearEnd,
  type YearEndGroup,
  type YearEndRow,
} from "@/lib/inventory-year-end";
import {
  entryDate,
  hasQty,
  itemName,
  lastYear,
  lineTotal,
  periodTitle,
  perUnit,
  plural,
  poLine,
  priceProblem,
  priceToSave,
  qtyText,
  rangeProblem,
  tableColumns,
  thisYear,
  totalLines,
  unitDollars,
  usedMeanwhile,
  visibleColumns,
  WARNING_KINDS,
  warningText,
  type TotalLine,
  type YearColumn,
  type YearRange,
} from "@/lib/inventory-year-range";
import { packUnitLabel } from "@/lib/stock-units";
import { cn } from "@/lib/utils";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The shared Input drops to 14px from a tablet's width up, and iOS zooms the page into any box
// under 16px when it is tapped. These boxes stay at 16px at every width.
const BOX_TEXT = "text-base md:text-base";

// The sign of a total line said aloud: a screen reader skips "+" and "−" or reads them oddly.
const SIGN_WORD: Record<TotalLine["sign"], string> = {
  "+": "plus",
  "−": "minus",
  "=": "equals",
  "": "",
};

// A tag's words carry its meaning; the tint only helps the eye find it (never colour alone).
const TAG =
  "ml-1.5 inline-block whitespace-nowrap rounded border px-1 py-0.5 text-[10px] font-medium";
const NOTE =
  "flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200";

export function InventoryYearEndTab(props: { onChanged: () => void }) {
  const yearFn = useServerFn(getYearEnd);
  const exportFn = useServerFn(exportInventoryCsv);
  const qc = useQueryClient();
  // Today on the office's clock, so "This year" does not turn over early for someone working
  // late on New Year's Eve in another time zone.
  const today = officeToday();
  const [range, setRange] = useState<YearRange>(() => thisYear(today));
  const { from, to } = range;
  const problem = rangeProblem(from, to);
  const q = useQuery({
    queryKey: ["inventory-year-end", from, to],
    queryFn: () => yearFn({ data: { from, to } }),
    // A From after a To is not a period: say so and ask the server nothing.
    enabled: problem === null,
  });
  const y = problem === null ? q.data : undefined;

  const exportRun = useMutation({
    mutationFn: (r: YearRange) =>
      exportFn({ data: { report: "year", from: r.from, to: r.to, with_value: true } }),
    onSuccess: (r) => {
      if (r.count === 0) {
        toast.info("Nothing in inventory for that period.");
        return;
      }
      downloadBlob(new Blob([r.csv], { type: "text/csv;charset=utf-8" }), r.file_name);
      toast.success("Summary exported");
    },
    onError: (e) => toast.error(`Could not export: ${errText(e)}`),
  });

  // A price typed on one entry changes this summary and what the Stock tab says inventory is
  // worth, so both are asked again.
  const priceSaved = () => {
    void qc.invalidateQueries({ queryKey: ["inventory-year-end"] });
    props.onChanged();
  };

  const presets: { label: string; range: YearRange }[] = [
    { label: "This year", range: thisYear(today) },
    { label: "Last year", range: lastYear(today) },
  ];

  return (
    <div className="space-y-4" data-year-end-tab>
      <Card data-card="year-end-period">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="h-4 w-4" /> Year end
          </CardTitle>
          <CardDescription>
            What inventory was worth at the start of a period, what came in and went out, and what
            it was worth at the end. Stock is valued at what was paid for it, averaged per item.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-2" data-year-presets>
              {presets.map((p) => {
                const on = p.range.from === from && p.range.to === to;
                return (
                  <Button
                    key={p.label}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    aria-pressed={on}
                    onClick={() => setRange(p.range)}
                  >
                    {p.label}
                  </Button>
                );
              })}
            </div>
            <div className="space-y-1">
              <Label htmlFor="year-end-from" className="text-xs">
                From
              </Label>
              <Input
                id="year-end-from"
                type="date"
                className={cn("w-auto", BOX_TEXT)}
                value={from}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="year-end-to" className="text-xs">
                To
              </Label>
              <Input
                id="year-end-to"
                type="date"
                className={cn("w-auto", BOX_TEXT)}
                value={to}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-year-export
              disabled={problem !== null || exportRun.isPending}
              onClick={() => exportRun.mutate(range)}
            >
              {exportRun.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="mr-2 h-4 w-4" />
              )}
              Export this summary
            </Button>
          </div>
          {problem && (
            <p className="text-destructive" role="alert" data-year-problem>
              {problem}
            </p>
          )}
        </CardContent>
      </Card>

      {problem === null && q.error && (
        <p className="text-sm text-destructive" role="alert" data-year-error>
          Could not load: {errText(q.error)}
        </p>
      )}
      {problem === null && q.isPending && (
        <p className="text-sm text-muted-foreground" data-year-loading>
          Working out the year…
        </p>
      )}
      {/* After a price is saved the old numbers stay up for the seconds the new ones take. Without
          a word here the entry just sits in its list, and the price looks as if it did not save. */}
      {y && q.isFetching && (
        <p className="text-sm text-muted-foreground" role="status" data-year-updating>
          Working out the numbers again…
        </p>
      )}

      {y && <YearEndReport year={y} onPriceSaved={priceSaved} />}
    </div>
  );
}

/** Everything under the Period card, once the server has answered. */
function YearEndReport(props: { year: YearEnd; onPriceSaved: () => void }) {
  const y = props.year;
  const warnings = WARNING_KINDS.map((kind) => ({ kind, n: y.counts[kind] })).filter(
    (w) => w.n > 0,
  );
  const columns = tableColumns(visibleColumns(y.groups));
  // A long list of categories opens as a list of headings with their values; a short one is
  // already short enough to read in full.
  const openGroups = y.groups.length <= 3;
  return (
    <>
      {warnings.length > 0 && (
        <div className="space-y-2" data-year-warnings>
          {warnings.map((w) => (
            <div key={w.kind} className={NOTE} data-year-warning={w.kind}>
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>{warningText(w.kind, w.n, { nothingToPrice: y.unpriced.length === 0 })}</p>
            </div>
          ))}
        </div>
      )}

      <Card data-card="year-end-totals">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{periodTitle(y.from, y.to)}</CardTitle>
          <CardDescription>
            The whole of inventory in dollars. The lines add up to the closing value.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="max-w-xl">
            {totalLines(y.dollars)
              .filter((l) => l.show)
              .map((l) => (
                <div
                  key={l.key}
                  title={l.help}
                  data-year-total={l.key}
                  className={cn(
                    "flex items-start gap-3 py-2",
                    // The rule a bookkeeper draws above the answer.
                    l.sign === "=" && "mt-1 border-t-2 border-foreground font-semibold",
                  )}
                >
                  <span className="w-4 shrink-0 text-center tabular-nums" aria-hidden>
                    {l.sign}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p>
                      {SIGN_WORD[l.sign] && <span className="sr-only">{SIGN_WORD[l.sign]} </span>}
                      {l.title}
                    </p>
                    <p className="text-xs font-normal text-muted-foreground">{l.help}</p>
                  </div>
                  <span className="whitespace-nowrap tabular-nums">{fmtDollars(l.amount)}</span>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      <Card data-card="year-end-categories">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">By category</CardTitle>
          <CardDescription>
            Every item that was on hand or had an entry in the period. In each box the count is on
            top and its dollars are underneath.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {y.groups.length === 0 ? (
            <p className="text-muted-foreground">Nothing in inventory for this period.</p>
          ) : (
            y.groups.map((g) => (
              <GroupSection key={g.category} group={g} columns={columns} startOpen={openGroups} />
            ))
          )}
        </CardContent>
      </Card>

      {y.unpriced.length > 0 && (
        <Card data-card="year-end-unpriced">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Entries that need a price</CardTitle>
            <CardDescription>
              These entries brought stock in with no price typed. Until a price is typed, inventory
              uses the cost shown, and the numbers above are estimates.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {/* Oldest first, as the server sends them: an early price changes later averages. */}
            {y.unpriced.map((u) => (
              <UnpricedBlock key={u.id} entry={u} onSaved={props.onPriceSaved} />
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** One category: a heading with its closing value that opens onto its items. */
function GroupSection(props: { group: YearEndGroup; columns: YearColumn[]; startOpen: boolean }) {
  const g = props.group;
  const [open, setOpen] = useState(props.startOpen);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border"
      data-year-group={g.category}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-muted/50"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1 font-semibold">{g.category || "No category"}</span>
          <span className="text-xs text-muted-foreground">
            {g.rows.length} {plural(g.rows.length, "item", "items")}
          </span>
          <span className="whitespace-nowrap font-semibold tabular-nums">
            <span className="mr-1 text-xs font-normal text-muted-foreground">Closing</span>
            {fmtDollars(g.dollars.closing)}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Ten columns do not fit a phone: the table scrolls sideways inside its own frame. */}
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Unit</TableHead>
                {props.columns.map((c) => (
                  <TableHead key={c.key} className="whitespace-nowrap text-right" title={c.help}>
                    {c.title}
                  </TableHead>
                ))}
                <TableHead
                  className="whitespace-nowrap text-right"
                  title="What one unit of the item cost, on average, at the end of the period."
                >
                  Average cost
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {g.rows.map((r) => (
                <ItemRow key={r.key} row={r} columns={props.columns} />
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold" colSpan={2}>
                  Total in dollars
                </TableCell>
                {props.columns.map((c) => (
                  <TableCell
                    key={c.key}
                    className="whitespace-nowrap text-right font-semibold tabular-nums"
                  >
                    {fmtDollars(g.dollars[c.key])}
                  </TableCell>
                ))}
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One item: its name and what to know about its numbers, then quantity over dollars. */
function ItemRow(props: { row: YearEndRow; columns: YearColumn[] }) {
  const r = props.row;
  return (
    <TableRow data-year-row={r.key}>
      <TableCell className="min-w-[12rem]">
        {itemName(r.item, r.colour)}
        {/* No cost outranks Estimate: with no cost there is no dollar figure to call estimated. */}
        {r.unknown ? (
          <span
            className={cn(TAG, "border-muted-foreground/40 text-muted-foreground")}
            title="No cost is known for this item, so its dollars are left out. Type a price on its entry in the list under these tables; if it has none there, give the item a cost in Setup."
            data-year-tag="no-cost"
          >
            No cost
          </span>
        ) : (
          r.estimated && (
            <span
              className={cn(
                TAG,
                "border-amber-400 text-amber-800 dark:border-amber-700 dark:text-amber-200",
              )}
              title="Some of this item's stock came in with no price typed, so its dollars are an estimate until the price is typed in the list under these tables."
              data-year-tag="estimate"
            >
              Estimate
            </span>
          )
        )}
        {r.below_zero && (
          <span
            className={cn(TAG, "border-destructive/50 text-destructive")}
            title="Inventory shows fewer than none of this item at the end of the period, so its count is wrong. Count it and save the count on the Reconcile tab."
            data-year-tag="below-zero"
          >
            Below zero
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{r.unit}</TableCell>
      {props.columns.map((c) => (
        <TableCell key={c.key} className="whitespace-nowrap text-right tabular-nums">
          {hasQty(c.key) && <div>{qtyText(r.qty[c.key], c.signed)}</div>}
          {/* An item with no cost has no dollars: a dash, never a $0.00 that reads as a value. */}
          <div className="text-xs text-muted-foreground">
            {r.unknown ? "—" : fmtDollars(r.dollars[c.key])}
          </div>
        </TableCell>
      ))}
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {unitDollars(r.avg)}
      </TableCell>
    </TableRow>
  );
}

/**
 * One entry with no price: what it was, what inventory has been using for it meanwhile, where to
 * read the real price (the ticket's purchase orders) and the box to type it in. Each block saves
 * by itself, so one slow save does not lock the rest of the list.
 */
function UnpricedBlock(props: { entry: UnpricedEntry; onSaved: () => void }) {
  const u = props.entry;
  const priceFn = useServerFn(setEntryPrice);
  // The box's TEXT, blank to start: a number already in a price box gets saved by people who
  // never read it, and this price ends up in the year's accounts.
  const [text, setText] = useState("");
  const save = useMutation({
    mutationFn: (unit_cost: number) => priceFn({ data: { movement_id: u.id, unit_cost } }),
    onSuccess: () => {
      toast.success("Price saved");
      setText("");
      props.onSaved();
    },
    onError: (e) => toast.error(errText(e), { duration: 10000 }),
  });
  const price = priceToSave(text);
  const total = lineTotal(text, u.qty);
  const problem = priceProblem(text);
  const setup = u.setup_cost;
  const boxId = `unpriced-price-${u.id}`;
  const amount = `${qtyText(u.qty)} ${packUnitLabel(u.qty, u.unit)}`;
  return (
    <div className="space-y-2 rounded-md border p-3" data-unpriced={u.id}>
      <div>
        <p className="font-semibold">
          {entryDate(u.at)} · {itemName(u.item, u.colour)} · +{amount} · {u.location_name}
        </p>
        <p className="text-xs text-muted-foreground">
          {u.reason}
          {u.job_name && (
            <>
              {" · "}
              {u.service_job_id ? (
                <Link
                  to="/service"
                  search={{ id: u.service_job_id }}
                  className="underline underline-offset-2"
                >
                  {u.job_name}
                </Link>
              ) : (
                u.job_name
              )}
            </>
          )}
          {u.by_name && <> · entered by {u.by_name}</>}
        </p>
      </div>
      <p data-unpriced-used>{usedMeanwhile(u.unit_cost, u.unit, u.source)}</p>
      {u.pos.length > 0 && (
        <div className="text-xs text-muted-foreground" data-unpriced-pos>
          <p>
            Purchase orders on this ticket (a purchase order holds one total, so the price{" "}
            {perUnit(u.unit)} is typed here):
          </p>
          <ul className="list-disc pl-5">
            {u.pos.map((po, i) => (
              <li key={i}>{poLine(po)}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor={boxId} className="text-xs">
          Price paid {perUnit(u.unit)}
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden>$</span>
          <Input
            id={boxId}
            data-unpriced-price
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className={cn("h-9 w-32", BOX_TEXT)}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={save.isPending}
            aria-invalid={problem !== null}
            onKeyDown={(e) => {
              if (e.key === "Enter" && price !== null && !save.isPending) save.mutate(price);
            }}
          />
          <Button
            type="button"
            size="sm"
            data-unpriced-save
            disabled={price === null || save.isPending}
            onClick={() => {
              if (price !== null) save.mutate(price);
            }}
          >
            Save price
          </Button>
          {setup != null && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-unpriced-setup
              disabled={save.isPending}
              onClick={() => save.mutate(setup)}
            >
              Keep the Setup cost ({unitDollars(setup)})
            </Button>
          )}
        </div>
        {problem && (
          <p className="text-xs text-destructive" data-unpriced-problem>
            {problem}
          </p>
        )}
        {total !== null && (
          <p className="text-xs text-muted-foreground" data-unpriced-total>
            = {fmtDollars(total)} for {amount}
          </p>
        )}
      </div>
    </div>
  );
}
