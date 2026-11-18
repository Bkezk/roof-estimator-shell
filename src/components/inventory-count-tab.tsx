/**
 * Inventory › Count (owner, Nov 16: "is it as efficient and good as it could be especially with
 * the reconciliation part" … "Go with all 6"). Until now a count could only be set one item at
 * a time (Set count on a stock row). This is a whole count in one go:
 *
 *   1. Start a count: pick the place (the shop or one vehicle) and the day. A count may be dated
 *      before today (a December 31 count typed in on January 3); the sheet then shows what
 *      inventory held at the end of that day.
 *   2. The count sheet: every item inventory has ever held there with what it expects, a box to
 *      type each count in, the difference as it is typed, and ONE save for the whole sheet. A
 *      line left blank is not counted and a save leaves it alone; "Count every blank line as
 *      zero" is for a shelf that was counted in full.
 *   3. Past counts: every saved count is kept, and can be opened and exported.
 *
 * Dollars are an admin's and a manager's (owner, Oct 15), and the SERVER says who is reading:
 * `sheet.dollars` and each saved count's `dollars`. When it is false there is no dollar column,
 * no cost box and no amount anywhere on this screen.
 *
 * What a save does is decided on the server, in one transaction (inventory-count.functions.ts):
 * it reads what inventory expected again, so the differences shown here are a preview. What the
 * boxes mean, the preview's arithmetic and what a save sends are in inventory-count-sheet.ts,
 * where they are tested.
 *
 * The count boxes are text boxes with a number keypad, not number boxes: a number box changes
 * its value when the mouse wheel passes over it or an arrow key is pressed, and on a sheet of a
 * few hundred boxes that is a count changed without anyone typing it. They start blank; a blank
 * box is never read as 0.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList, FileDown, History, Loader2, Plus, Printer, X } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";

import { downloadBlob } from "@/components/service/invoice-utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDollars } from "@/lib/inventory-cost";
import {
  exportCountCsv,
  getCount,
  getCountSheet,
  listCounts,
  saveCount,
  type saveCountSchema,
} from "@/lib/inventory-count.functions";
import {
  BLANK_LINE,
  earlierIds,
  fmtDay,
  laterBanner,
  laterCount,
  laterLine,
  laterOf,
  withEarlier,
  groupByCategory,
  lineFromProduct,
  lineKey,
  lineState,
  matchesSearch,
  printSheetFileName,
  printSheetRows,
  saveLines,
  searchProducts,
  sheetSummary,
  signedQty,
  typedCount,
  type CountProduct,
  type SheetLine,
  type TypedLine,
} from "@/lib/inventory-count-sheet";
import { officeToday } from "@/lib/inventory-year-end";
import type { InventoryLocation } from "@/lib/inventory.functions";
import { toCsv } from "@/lib/review-export";
import { describeStock, packUnitLabel, plural } from "@/lib/stock-units";
import { cn } from "@/lib/utils";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
const csvBlob = (csv: string) => new Blob([csv], { type: "text/csv;charset=utf-8" });

// Every box a person types in is 16px at every width: iOS zooms the page when a smaller one
// takes the focus, and the counter loses their place on the sheet.
const BOX = "h-10 text-base md:text-base";
// More and less than expected. The sign is always written too; colour is only a second cue.
const MORE = "text-green-700 dark:text-green-400";
const LESS = "text-destructive";
const toneOf = (n: number) => (n > 0 ? MORE : n < 0 ? LESS : "text-muted-foreground");

/** A dollar difference with its sign; a dash when the cost is not known. */
const signedDollars = (n: number | null) => (n != null && n > 0 ? "+" : "") + fmtDollars(n);

/** A day the sheet can be asked for: a whole date, this century, not after today. */
const usableDay = (v: string, today: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "2000-01-01" && v <= today;

/** Enter goes to the next count box, so a shelf is typed top to bottom without the mouse. */
function nextBoxOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const boxes = Array.from(
    e.currentTarget
      .closest("[data-count-tab]")
      ?.querySelectorAll<HTMLInputElement>("input[data-count-input], input[data-count-pieces]") ??
      [],
  );
  const next = boxes[boxes.indexOf(e.currentTarget) + 1];
  if (!next) return;
  next.focus();
  next.select();
}

type SaveInput = z.input<typeof saveCountSchema>;

interface Switch {
  locationId?: string;
  day?: string;
}

export function InventoryCountTab(props: {
  /** Active places, the shop first. */
  locations: InventoryLocation[];
  /** Every product that can be stocked, for "Add an item". */
  products: CountProduct[];
  /** The page refreshes its stock after a count is saved. */
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const sheetFn = useServerFn(getCountSheet);
  const saveFn = useServerFn(saveCount);
  const rootRef = useRef<HTMLDivElement>(null);

  const [picked, setPicked] = useState<string | null>(null);
  // Null = today. The server then dates the sheet by its own clock, not this phone's.
  const [day, setDay] = useState<string | null>(null);
  // What the date box shows while it does not hold a usable day (a year half typed).
  const [dayDraft, setDayDraft] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState<Record<string, TypedLine>>({});
  const [added, setAdded] = useState<SheetLine[]>([]);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<Switch | null>(null);
  const [askZero, setAskZero] = useState(false);
  const [askSave, setAskSave] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  // Entries typed in since the count day that the office says happened on or before it (owner,
  // Nov 18, of the audit): by entry id. Only a past day's sheet has any to tick.
  const [before, setBefore] = useState<ReadonlySet<number>>(() => new Set());
  const [browserToday] = useState(() => officeToday());

  const locationId =
    (picked != null && props.locations.some((l) => l.id === picked) ? picked : null) ??
    props.locations[0]?.id ??
    "";
  const sheetQ = useQuery({
    queryKey: ["inventory-count-sheet", locationId, day ?? browserToday],
    queryFn: () =>
      sheetFn({
        data:
          day == null ? { location_id: locationId } : { location_id: locationId, counted_on: day },
      }),
    enabled: locationId !== "",
  });
  const sheet = sheetQ.data;
  const today = sheet?.today ?? browserToday;
  const countedOn = day ?? sheet?.counted_on ?? browserToday;
  const dollars = sheet?.dollars === true;

  const allLines = useMemo(() => {
    if (!sheet) return [];
    const onSheet = new Set(sheet.lines.map(lineKey));
    // A ticked entry counts as before the count: the line's Expected takes it in (withEarlier),
    // so the difference shown is the one the save will make.
    return [...sheet.lines, ...added.filter((l) => !onSheet.has(lineKey(l)))].map((l) =>
      withEarlier(l, before),
    );
  }, [sheet, added, before]);
  const laterEntries = useMemo(() => laterCount(sheet?.lines ?? []), [sheet]);
  const onTickBefore = useCallback((id: number, on: boolean) => {
    setBefore((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const addedKeys = useMemo(() => new Set(added.map(lineKey)), [added]);
  const onSheetKeys = useMemo(() => new Set(allLines.map(lineKey)), [allLines]);
  const states = useMemo(
    () => allLines.map((l) => lineState(l, typed[lineKey(l)], { opening, dollars })),
    [allLines, typed, opening, dollars],
  );
  const summary = useMemo(() => sheetSummary(states), [states]);
  const blankKeys = useMemo(
    () =>
      allLines
        .filter((l) => {
          const t = typed[lineKey(l)] ?? BLANK_LINE;
          return typedCount(t.packs, t.pieces, l.unit, l.piece) == null;
        })
        .map(lineKey),
    [allLines, typed],
  );
  const groups = useMemo(
    () =>
      groupByCategory(
        allLines.filter((l) => matchesSearch(l, search)),
        (l) => l.category,
      ),
    [allLines, search],
  );
  const hasTyped =
    added.length > 0 || Object.values(typed).some((t) => `${t.packs}${t.pieces}${t.cost}`.trim());

  // Leaving with counts typed asks first: a shelf of counts is an hour's work, and nothing is
  // kept until Save. Another Inventory tab, the menu and a link all go through the router (the
  // tab row would otherwise drop the sheet without a word); closing or reloading the page keeps
  // the browser's own warning. The ref is what the blocker reads.
  const typedRef = useRef(false);
  typedRef.current = hasTyped;
  const blocker = useBlocker({
    shouldBlockFn: () => typedRef.current,
    withResolver: true,
    enableBeforeUnload: () => typedRef.current,
  });

  const focusLine = (key: string) => {
    const rows = Array.from(rootRef.current?.querySelectorAll("[data-count-line]") ?? []);
    const row = rows.find((r) => r.getAttribute("data-count-line") === key);
    if (!row) return;
    row.scrollIntoView({ block: "center" });
    row.querySelector<HTMLInputElement>("input[data-count-input]")?.focus();
  };
  // A line asked for before it is on the page (just added, or hidden by the search) gets the
  // focus once it has been drawn.
  const wantFocus = useRef<string | null>(null);
  useEffect(() => {
    const key = wantFocus.current;
    if (key == null) return;
    wantFocus.current = null;
    focusLine(key);
  });

  const onType = useCallback((key: string, patch: Partial<TypedLine>) => {
    setTyped((prev) => ({ ...prev, [key]: { ...(prev[key] ?? BLANK_LINE), ...patch } }));
  }, []);
  const onRemove = useCallback((key: string) => {
    setAdded((prev) => prev.filter((l) => lineKey(l) !== key));
    setTyped((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)));
  }, []);

  const clearSheet = () => {
    setTyped({});
    setAdded([]);
    setSearch("");
    setBefore(new Set());
  };
  const applySwitch = (next: Switch) => {
    if (next.locationId != null) setPicked(next.locationId);
    if (next.day != null) setDay(next.day);
    clearSheet();
  };
  /** Another place or day is another sheet: with counts typed, ask before they are lost. */
  const requestSwitch = (next: Switch) => {
    const same =
      (next.locationId == null || next.locationId === locationId) &&
      (next.day == null || next.day === countedOn);
    if (same) return;
    if (hasTyped) setPendingSwitch(next);
    else applySwitch(next);
  };

  const addProduct = (p: CountProduct) => {
    const line = lineFromProduct(p);
    const key = lineKey(line);
    if (onSheetKeys.has(key)) {
      toast.info("Already on the sheet");
      if (search === "") {
        focusLine(key);
        return;
      }
    } else setAdded((prev) => [...prev, line]);
    // The line is drawn (or shown again, once the search is cleared) on the next render.
    wantFocus.current = key;
    setSearch("");
  };

  const save = useMutation({
    mutationFn: (data: SaveInput) => saveFn({ data }),
    onSuccess: (r) => {
      toast.success(`Count saved: ${many(r.lines, "line", "lines")}, ${r.differences} corrected`);
      clearSheet();
      // The next count is not an opening count unless it is ticked again.
      setOpening(false);
      void qc.invalidateQueries({ queryKey: ["inventory-count-sheet"] });
      void qc.invalidateQueries({ queryKey: ["inventory-counts"] });
      props.onSaved();
      setViewId(r.id);
    },
    onError: (e) => toast.error(errText(e), { duration: 10000 }),
    onSettled: () => setAskSave(false),
  });
  const canSave = !!sheet && summary.counted > 0 && summary.errors === 0 && !save.isPending;
  const doSave = () => {
    if (!sheet || !canSave) return;
    save.mutate({
      location_id: sheet.location_id,
      counted_on: sheet.counted_on,
      opening,
      note: note.trim() || null,
      lines: saveLines(allLines, typed, { opening, dollars }),
      // The ticked entries of the counted lines; none on today's sheet.
      ...(before.size
        ? { before_ids: earlierIds(allLines, typed, { opening, dollars }, before) }
        : {}),
    });
  };

  const fillBlanks = () => {
    setTyped((prev) => {
      const next = { ...prev };
      for (const key of blankKeys) next[key] = { ...(prev[key] ?? BLANK_LINE), packs: "0" };
      return next;
    });
    setAskZero(false);
  };
  const downloadSheet = () => {
    if (!sheet) return;
    downloadBlob(
      csvBlob(toCsv(printSheetRows({ lines: allLines }))),
      printSheetFileName(sheet.location_name, sheet.counted_on),
    );
  };

  const placeName =
    sheet?.location_name ?? props.locations.find((l) => l.id === locationId)?.name ?? "";
  const columns = dollars ? 5 : 4;

  return (
    <div className="space-y-4" data-count-tab ref={rootRef}>
      <Card data-card="count-start">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" /> Start a count
          </CardTitle>
          <CardDescription>
            Pick the place and the day, then type what is really there. Nothing changes in inventory
            until you save the count.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {props.locations.length === 0 ? (
            <p className="text-muted-foreground">No places are set up yet.</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="count-place">Place</Label>
                  <Select
                    value={locationId}
                    onValueChange={(v) => requestSwitch({ locationId: v })}
                    disabled={save.isPending}
                  >
                    <SelectTrigger id="count-place" className="h-10 text-base md:text-base">
                      <SelectValue placeholder="Pick a place" />
                    </SelectTrigger>
                    <SelectContent>
                      {props.locations.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="count-day">Counted on</Label>
                  <Input
                    id="count-day"
                    type="date"
                    className={BOX}
                    max={today}
                    value={dayDraft ?? countedOn}
                    disabled={save.isPending}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (usableDay(v, today)) {
                        setDayDraft(null);
                        requestSwitch({ day: v });
                      } else setDayDraft(v);
                    }}
                    onBlur={() => setDayDraft(null)}
                  />
                  {dayDraft != null && (
                    <p className="text-xs text-destructive">Pick a day up to today.</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Counting for an earlier day? Pick that day. The count is compared with what
                    inventory held at the end of it.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="count-note">Note</Label>
                  <Input
                    id="count-note"
                    className={BOX}
                    maxLength={500}
                    placeholder="Year-end count"
                    value={note}
                    disabled={save.isPending}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional. Kept with the count so it is easy to find later.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="count-opening"
                  className="mt-0.5"
                  checked={opening}
                  disabled={save.isPending}
                  onCheckedChange={(v) => setOpening(v === true)}
                />
                <div className="space-y-0.5">
                  <Label htmlFor="count-opening" className="cursor-pointer">
                    This is the opening count
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Tick this only for the first count, when stock is being loaded into inventory.
                    Stock you count comes in as opening stock.
                  </p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {locationId !== "" && (
        <Card data-card="count-sheet">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Count sheet{placeName ? `: ${placeName}, ${fmtDay(countedOn)}` : ""}
            </CardTitle>
            <CardDescription>
              Every item inventory has ever held at this place.{" "}
              {countedOn === today
                ? "Expected is what inventory holds there now."
                : "Expected is what inventory held there at the end of that day."}{" "}
              Type what you counted. A line you leave blank is not counted and is not changed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {sheetQ.error && (
              <p className="text-destructive">Could not load: {errText(sheetQ.error)}</p>
            )}
            {!sheet && !sheetQ.error && (
              <p className="text-muted-foreground">Loading the count sheet…</p>
            )}
            {sheet && (
              <>
                {laterBanner(laterEntries, sheet.counted_on) && (
                  <p
                    className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
                    data-count-later-banner
                  >
                    {laterBanner(laterEntries, sheet.counted_on)}
                  </p>
                )}
                <p className="font-medium" data-count-summary>
                  {summary.counted} of {many(summary.lines, "line", "lines")} counted ·{" "}
                  {many(summary.differ, "differs", "differ")}
                  {dollars && <> · net difference {signedDollars(summary.value)}</>}
                  {dollars && summary.missingCost && " (some items have no cost)"}
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[12rem] flex-1 space-y-1">
                    <Label htmlFor="count-search">Find a line</Label>
                    <Input
                      id="count-search"
                      type="search"
                      className={BOX}
                      placeholder="Item name, colour or item #"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    aria-expanded={adding}
                    onClick={() => setAdding((a) => !a)}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add an item
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    disabled={blankKeys.length === 0 || save.isPending}
                    onClick={() => setAskZero(true)}
                  >
                    Count every blank line as zero
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    disabled={allLines.length === 0}
                    onClick={downloadSheet}
                  >
                    <Printer className="mr-2 h-4 w-4" /> Download the sheet to print
                  </Button>
                </div>
                {adding && (
                  <AddItemPanel
                    products={props.products}
                    onSheet={onSheetKeys}
                    onPick={addProduct}
                    onClose={() => setAdding(false)}
                  />
                )}
                {allLines.length === 0 ? (
                  <p className="text-muted-foreground">
                    Inventory has never held anything at {sheet.location_name}. Use Add an item to
                    count what is there.
                  </p>
                ) : groups.length === 0 ? (
                  <p className="text-muted-foreground">
                    No line matches “{search.trim()}”. Counts you typed on other lines are kept.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table data-count-sheet>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Expected</TableHead>
                          <TableHead>Counted</TableHead>
                          <TableHead className="text-right">Difference</TableHead>
                          {dollars && <TableHead className="text-right">Difference ($)</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groups.map((g) => (
                          <CategoryRows
                            key={g.category}
                            category={g.category}
                            columns={columns}
                            lines={g.rows}
                            typed={typed}
                            addedKeys={addedKeys}
                            opening={opening}
                            dollars={dollars}
                            disabled={save.isPending}
                            onType={onType}
                            onRemove={onRemove}
                            before={before}
                            countedOn={sheet.counted_on}
                            onTickBefore={onTickBefore}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <p className="text-xs text-muted-foreground">
                    {summary.errors > 0
                      ? `${many(summary.errors, "line has", "lines have")} something that is not a number. Fix ${summary.errors === 1 ? "it" : "them"} before saving.`
                      : summary.counted === 0
                        ? "Type at least one count to save. Press Enter to go to the next line."
                        : "Saving corrects inventory to what you counted. Blank lines are not changed."}
                  </p>
                  <Button
                    type="button"
                    className="h-10"
                    disabled={!canSave}
                    onClick={() => setAskSave(true)}
                    data-count-save
                  >
                    {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save the count
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <PastCounts viewId={viewId} onView={setViewId} />

      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(o) => {
          if (!o && blocker.status === "blocked") blocker.reset();
        }}
      >
        <AlertDialogContent data-count-leave>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave the count sheet?</AlertDialogTitle>
            <AlertDialogDescription>
              You have typed counts that are not saved. If you leave now they are lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay on the sheet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (blocker.status === "blocked") blocker.proceed();
              }}
            >
              Leave without saving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingSwitch != null}
        onOpenChange={(o) => {
          if (!o) setPendingSwitch(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to another sheet?</AlertDialogTitle>
            <AlertDialogDescription>
              You have typed counts on this sheet. Switch and lose them?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my counts</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSwitch) applySwitch(pendingSwitch);
                setPendingSwitch(null);
              }}
            >
              Switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={askZero} onOpenChange={setAskZero}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Count every blank line as zero?</AlertDialogTitle>
            <AlertDialogDescription>
              Every line you left blank will be counted as 0. Use this when the shelf has been fully
              counted and anything not typed is gone. That is{" "}
              {many(blankKeys.length, "line", "lines")}
              {search.trim() ? ", including lines the search is hiding." : "."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={fillBlanks}>Count them as 0</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={askSave}
        onOpenChange={(o) => {
          if (!o && !save.isPending) setAskSave(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Save this count of {placeName} for {fmtDay(sheet?.counted_on ?? countedOn)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {many(summary.counted, "line", "lines")} counted,{" "}
              {many(summary.differ, "differs", "differ")}. Inventory will be corrected to what you
              counted. Lines left blank are not changed.
              {opening &&
                " This is saved as the opening count: stock you counted comes in as opening stock."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={save.isPending}>Not yet</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canSave}
              onClick={(e) => {
                // Stay open until the server answers, so a second tap cannot save twice.
                e.preventDefault();
                doSave();
              }}
            >
              {save.isPending ? "Saving…" : "Save the count"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface RowHandlers {
  onType: (key: string, patch: Partial<TypedLine>) => void;
  onRemove: (key: string) => void;
  /** The ticked "happened on or before the count day" entries, and the tick itself. */
  before: ReadonlySet<number>;
  countedOn: string;
  onTickBefore: (id: number, on: boolean) => void;
}

/** A category's heading and its lines. */
function CategoryRows(
  props: RowHandlers & {
    category: string;
    columns: number;
    lines: SheetLine[];
    typed: Record<string, TypedLine>;
    addedKeys: ReadonlySet<string>;
    opening: boolean;
    dollars: boolean;
    disabled: boolean;
  },
) {
  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell
          colSpan={props.columns}
          className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {props.category}
        </TableCell>
      </TableRow>
      {props.lines.map((l) => {
        const key = lineKey(l);
        return (
          <SheetRow
            key={key}
            line={l}
            typed={props.typed[key]}
            added={props.addedKeys.has(key)}
            opening={props.opening}
            dollars={props.dollars}
            disabled={props.disabled}
            onType={props.onType}
            onRemove={props.onRemove}
            before={props.before}
            countedOn={props.countedOn}
            onTickBefore={props.onTickBefore}
          />
        );
      })}
    </>
  );
}

/**
 * One line of the sheet. Memoised: typing in one box redraws that line only, so a sheet of a
 * few hundred lines keeps up with the keyboard.
 */
const SheetRow = memo(function SheetRow(
  props: RowHandlers & {
    line: SheetLine;
    typed: TypedLine | undefined;
    /** Put on the sheet by hand with Add an item. */
    added: boolean;
    opening: boolean;
    dollars: boolean;
    disabled: boolean;
  },
) {
  const { line, dollars } = props;
  const key = lineKey(line);
  const t = props.typed ?? BLANK_LINE;
  const s = lineState(line, props.typed, { opening: props.opening, dollars });
  const piece = line.piece && line.piece.perPack > 0 ? line.piece : null;
  const name = line.colour ? `${line.item} · ${line.colour}` : line.item;
  const units = packUnitLabel(2, line.unit);
  return (
    <TableRow data-count-line={key}>
      <TableCell className="min-w-[11rem] text-sm font-medium">
        {name}
        {line.item_nos.length > 0 && (
          <span className="block font-mono text-xs font-normal text-muted-foreground">
            #{line.item_nos.join(", #")}
          </span>
        )}
        {/* Typed in since the count day (owner, Nov 18): each one is ticked if it happened on or
            before that day, so the count does not take it off twice. */}
        {laterOf(line).length > 0 && (
          <div
            className="mt-1.5 space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs font-normal text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
            data-count-later={key}
          >
            <p className="font-semibold">Typed in since {fmtDay(props.countedOn)}</p>
            {laterOf(line).map((e) => (
              <label key={e.id} className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  className="mt-0.5"
                  checked={props.before.has(e.id)}
                  disabled={props.disabled}
                  onCheckedChange={(v) => props.onTickBefore(e.id, v === true)}
                  data-count-later-tick={e.id}
                />
                <span>
                  {laterLine(e, line.unit)}
                  <span className="block text-amber-900/80 dark:text-amber-100/80">
                    {props.before.has(e.id)
                      ? `Counted as on or before ${fmtDay(props.countedOn)}: it is in Expected.`
                      : `Tick if it happened on or before ${fmtDay(props.countedOn)}.`}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
        {props.added && (
          <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-muted-foreground">
            Added to this count
            <button
              type="button"
              className="rounded p-0.5 hover:bg-muted"
              aria-label={`Take ${name} off the sheet`}
              title="Take it off the sheet"
              disabled={props.disabled}
              onClick={() => props.onRemove(key)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </TableCell>
      <TableCell
        className={cn(
          "whitespace-nowrap text-right text-sm tabular-nums",
          line.expected < 0 && "text-destructive",
        )}
      >
        {describeStock(line.expected, line.unit, null)}
        {piece && (
          <span className="block text-xs text-muted-foreground">
            {describeStock(line.expected, line.unit, piece)}
          </span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-start gap-2">
          <div className="space-y-0.5">
            <Input
              data-count-input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className={cn(BOX, "w-24", s.error && "border-destructive")}
              aria-label={`${piece ? `Whole ${units}` : `Counted, in ${units}`}: ${name}`}
              aria-invalid={s.error != null}
              value={t.packs}
              disabled={props.disabled}
              onChange={(e) => props.onType(key, { packs: e.target.value })}
              onKeyDown={nextBoxOnEnter}
            />
            <span className="block text-xs text-muted-foreground">
              {piece ? `whole ${units}` : units}
            </span>
          </div>
          {piece && (
            <div className="space-y-0.5">
              <Input
                data-count-pieces
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className={cn(BOX, "w-24", s.error && "border-destructive")}
                aria-label={`Loose ${plural(2, piece.name)}: ${name}`}
                aria-invalid={s.error != null}
                value={t.pieces}
                disabled={props.disabled}
                onChange={(e) => props.onType(key, { pieces: e.target.value })}
                onKeyDown={nextBoxOnEnter}
              />
              <span className="block text-xs text-muted-foreground">
                loose {plural(2, piece.name)}
              </span>
            </div>
          )}
        </div>
        {s.error && <p className="text-xs text-destructive">{s.error}</p>}
        {piece && s.counted != null && (
          <p className="text-xs text-muted-foreground">
            = {describeStock(s.counted, line.unit, null)}
          </p>
        )}
      </TableCell>
      <TableCell
        data-count-diff
        className={cn(
          "whitespace-nowrap text-right text-sm font-semibold tabular-nums",
          s.diff != null && toneOf(s.diff),
        )}
      >
        {s.diff != null && (
          <>
            {signedQty(s.diff)}{" "}
            <span className="text-xs font-normal">{packUnitLabel(s.diff, line.unit)}</span>
            {piece && s.diff !== 0 && (
              <span className="block text-xs font-normal text-muted-foreground">
                {signedQty(s.diff * piece.perPack)} {plural(s.diff * piece.perPack, piece.name)}
              </span>
            )}
          </>
        )}
      </TableCell>
      {dollars && (
        <TableCell data-count-value className="min-w-[9rem] text-right text-sm tabular-nums">
          {s.diff != null && (
            <span className={cn("font-semibold", s.value != null && toneOf(s.value))}>
              {signedDollars(s.value)}
            </span>
          )}
          {s.diff != null && line.estimated && (
            <span
              className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground"
              title="An entry for this item came in with no price typed"
            >
              estimate
            </span>
          )}
          {dollars && s.costShown && (
            <label className="mt-1 ml-auto block w-36 space-y-0.5 text-left">
              <span className="block text-xs font-medium">Cost per {line.unit}</span>
              <Input
                data-count-cost
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className={cn(BOX, s.costError && "border-destructive")}
                aria-invalid={s.costError != null}
                value={t.cost}
                disabled={props.disabled}
                onChange={(e) => props.onType(key, { cost: e.target.value })}
              />
              <span
                className={cn(
                  "block text-xs",
                  s.costError ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {s.costError ??
                  (props.opening
                    ? `What one ${line.unit} cost`
                    : props.added
                      ? "Optional. Leave blank if you do not know it."
                      : "Inventory has no cost for this item. Leave blank if you do not know it.")}
              </span>
            </label>
          )}
        </TableCell>
      )}
    </TableRow>
  );
});

/** "Add an item": find something the place has never held and put it on the sheet at 0. */
function AddItemPanel(props: {
  products: CountProduct[];
  onSheet: ReadonlySet<string>;
  onPick: (p: CountProduct) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const matches = useMemo(() => searchProducts(props.products, text), [props.products, text]);
  return (
    <div className="space-y-2 rounded-md border p-3" data-count-add>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="count-add">Add an item that is not on the sheet</Label>
        <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
          Done
        </Button>
      </div>
      <Input
        id="count-add"
        autoFocus
        type="search"
        className={BOX}
        placeholder="Type the product name or item #…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {text.trim() !== "" && (
        <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No product matches.</li>
          )}
          {matches.map((p) => {
            const here = props.onSheet.has(lineKey(p.ref));
            return (
              <li key={p.key}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    props.onPick(p);
                    setText("");
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {p.variant ? `${p.name} · ${p.variant}` : p.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {p.category}
                      {p.itemNos.length > 0 && (
                        <span className="ml-1 font-mono">#{p.itemNos.join(", #")}</span>
                      )}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {here ? "Already on the sheet" : "Add"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        The item is added with 0 expected. Showing at most 20 matches; type more to narrow them.
      </p>
    </div>
  );
}

/** Every saved count, newest first, each to open and to export. */
function PastCounts(props: { viewId: string | null; onView: (id: string | null) => void }) {
  const listFn = useServerFn(listCounts);
  const exportFn = useServerFn(exportCountCsv);
  const q = useQuery({ queryKey: ["inventory-counts"], queryFn: () => listFn() });
  const counts = q.data ?? [];
  const pastDollars = counts.some((c) => c.dollars);
  const exp = useMutation({
    mutationFn: (id: string) => exportFn({ data: { id } }),
    onSuccess: (r) => {
      downloadBlob(csvBlob(r.csv), r.file_name);
      toast.success(`Exported ${many(r.count, "line", "lines")}`);
    },
    onError: (e) => toast.error(`Could not export: ${errText(e)}`),
  });
  return (
    <Card data-card="count-past">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" /> Past counts
        </CardTitle>
        <CardDescription>
          Every count that was saved, newest first. A saved count is kept as it was counted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {q.error && <p className="text-destructive">Could not load: {errText(q.error)}</p>}
        {q.isPending ? (
          <p className="text-muted-foreground">Loading past counts…</p>
        ) : counts.length === 0 ? (
          !q.error && <p className="text-muted-foreground">No counts saved yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table data-count-past>
              <TableHeader>
                <TableRow>
                  <TableHead>Counted on</TableHead>
                  <TableHead>Place</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Differences</TableHead>
                  {pastDollars && (
                    <TableHead className="text-right">Value of differences</TableHead>
                  )}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {counts.map((c) => (
                  <TableRow
                    key={c.id}
                    data-count-past-row={c.id}
                    className={cn(props.viewId === c.id && "bg-muted/50")}
                  >
                    <TableCell className="min-w-[9rem] text-sm">
                      <span className="whitespace-nowrap font-medium">{fmtDay(c.counted_on)}</span>
                      {c.opening && (
                        <span className="ml-1 whitespace-nowrap rounded bg-primary/15 px-1 py-0.5 text-[10px] font-medium">
                          Opening count
                        </span>
                      )}
                      {c.note && (
                        <span className="block text-xs text-muted-foreground">{c.note}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{c.location_name}</TableCell>
                    <TableCell className="text-sm">{c.by_name ?? "(unknown)"}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{c.lines}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {c.differences}
                    </TableCell>
                    {pastDollars && (
                      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                        {c.dollars ? fmtDollars(c.value) : ""}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-expanded={props.viewId === c.id}
                          onClick={() => props.onView(props.viewId === c.id ? null : c.id)}
                        >
                          {props.viewId === c.id ? "Close" : "View"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={exp.isPending}
                          onClick={() => exp.mutate(c.id)}
                        >
                          {exp.isPending && exp.variables === c.id ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <FileDown className="mr-1 h-4 w-4" />
                          )}
                          Export
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {props.viewId != null && (
          <CountView key={props.viewId} id={props.viewId} onClose={() => props.onView(null)} />
        )}
      </CardContent>
    </Card>
  );
}

/** One saved count, read only: what was expected, what was counted and the difference. */
function CountView(props: { id: string; onClose: () => void }) {
  const fn = useServerFn(getCount);
  const q = useQuery({
    queryKey: ["inventory-count", props.id],
    queryFn: () => fn({ data: { id: props.id } }),
  });
  // Most lines of a count match; the ones that did not are what a person opens a count to see.
  const [onlyDiffer, setOnlyDiffer] = useState(true);
  const panel = useRef<HTMLDivElement>(null);
  // Opened from a row far up the page, or straight after a save: bring it into view.
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const count = q.data;
  const countDollars = count?.dollars === true;
  const lines = count ? (onlyDiffer ? count.lines.filter((l) => l.diff !== 0) : count.lines) : [];
  const toggleId = `count-only-differ-${props.id}`;
  return (
    <div className="space-y-3 rounded-md border p-3" data-count-view={props.id} ref={panel}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            {count ? `Count of ${count.location_name}, ${fmtDay(count.counted_on)}` : "Saved count"}
          </h3>
          {count && (
            <p className="text-xs text-muted-foreground">
              {many(count.lines.length, "line", "lines")} counted,{" "}
              {many(count.differences, "differs", "differ")}
              {count.by_name ? ` · by ${count.by_name}` : ""}
              {count.opening ? " · opening count" : ""}
              {count.note ? ` · ${count.note}` : ""}
            </p>
          )}
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      </div>
      {q.error && <p className="text-destructive">Could not load: {errText(q.error)}</p>}
      {q.isPending && <p className="text-muted-foreground">Loading the count…</p>}
      {count && (
        <>
          <div className="flex items-center gap-2">
            <Checkbox
              id={toggleId}
              checked={onlyDiffer}
              onCheckedChange={(v) => setOnlyDiffer(v === true)}
            />
            <Label htmlFor={toggleId} className="cursor-pointer">
              Only lines that differed
            </Label>
          </div>
          {lines.length === 0 ? (
            <p className="text-muted-foreground">
              {count.lines.length === 0
                ? "This count has no lines."
                : "Every line matched what inventory expected."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Counted</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    {countDollars && <TableHead className="text-right">Difference ($)</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={lineKey(l)}>
                      <TableCell className="min-w-[11rem] text-sm font-medium">
                        {l.colour ? `${l.item} · ${l.colour}` : l.item}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {l.category}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                        {describeStock(l.expected, l.unit, null)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                        {describeStock(l.counted, l.unit, null)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "whitespace-nowrap text-right text-sm font-semibold tabular-nums",
                          toneOf(l.diff),
                        )}
                      >
                        {signedQty(l.diff)}
                      </TableCell>
                      {countDollars && (
                        <TableCell
                          className={cn(
                            "whitespace-nowrap text-right text-sm tabular-nums",
                            l.value != null && toneOf(l.value),
                          )}
                        >
                          {signedDollars(l.value)}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
