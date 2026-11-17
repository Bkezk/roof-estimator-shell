/**
 * Trade Bids, one bid (owner, Nov 16: "were talking about expanding into other areas so we need
 * a way to bid them … similar to the project bid calculator but simpler" … "a saved bid should
 * keep its own numbers" … "ensure if someone leaves the pages the pop up reminding to save or
 * giving the option to leave without saving is offered").
 *
 * A new bid of a trade (/trade-bids?new=<trade>) or a saved one (/trade-bids?bid=<bid>), read
 * top to bottom the way the job is thought about:
 *
 *  1. The job: its name, the customer, the due date, who is estimating, where it is and what the
 *     work is (those words print on the proposal).
 *  2. Measurements: one box for each thing this trade measures. This is all most bids type.
 *  3. Subcontractor quotes (owner, Nov 17): the work handed to a sub, who does it (picked from
 *     the vendor list) and the quote, typed here when it comes in. Always shown; a bid with
 *     nothing subbed out says so and offers to add a line. The lines are part of this bid's OWN
 *     copy of the setup, so they are saved by Save and asked about on leaving like the rest.
 *  4. The price: what to buy, the hours, the subs, and the sum from materials down to the price,
 *     worked out as the boxes are typed in (trade-bid.ts; the server works it out again on Save
 *     and keeps its own answer). A line that is missing a number says which, in place of its cost.
 *  5. The bar that stays at the bottom of the window (save-bar.tsx): where the form stands, the
 *     Rates and lines button and Save. Rates and lines opens a popup (owner, Nov 17) holding the
 *     same editor the trade is set up with, on this bid's OWN copy: the trade stays as it is. A
 *     sub line is switched between a set quote and a rate per measurement there.
 *
 * Under the price of a saved bid sits its Invoices block (owner, Nov 17; bid-invoices-card.tsx):
 * a won bid is invoiced from here. It is not part of this form: making an invoice saves nothing
 * of the bid and never makes it "not saved". It is only told whether the bid is Won and whether
 * there are changes not saved, because an invoice bills the saved price.
 *
 * What saves when:
 *  - Nothing of a new bid is saved until Save. The server needs the customer and, for a new
 *    bid, the due date; the screen asks for both in plain words before it sends anything.
 *  - Save is the only thing that saves the bid's contents. Leaving with changes not saved asks
 *    first: Stay, Leave without saving, or Save and leave.
 *  - The Status of a saved bid saves the moment it is changed, as it does on the Trade Bids
 *    list, and is no part of "changes not saved".
 *
 * Also here, because both screens show them: the price as it is laid out (`TradePrice`, the
 * setup screen's "Try it" shows the same), the leave dialog and the small loading pieces.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  FileText,
  Loader2,
  SlidersHorizontal,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";

import { AccountPicker, QuickAddCustomerDialog } from "@/components/crm/account-picker";
import { SiteSelect } from "@/components/crm/site-select";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { LostReasonDialog } from "@/components/lost-reason-dialog";
import { SAVE_BAR_ACTIONS, SaveBar } from "@/components/save-bar";
import { BidInvoicesCard } from "@/components/trade/bid-invoices-card";
import {
  BOX,
  InvalidBoxes,
  MeasureBoxes,
  SubQuoteRows,
  TradeLinesEditor,
} from "@/components/trade/trade-lines-editor";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-store";
import { BID_STATUSES, STATUS_LABELS, asBidStatus, type BidStatus } from "@/lib/bid-status";
import { setBidStatus } from "@/lib/bids.functions";
import { getAccount, type AccountHit } from "@/lib/crm.functions";
import { plainErrText } from "@/lib/plain-error";
import {
  calcTradeBid,
  fmtMoney,
  newTradeBid,
  type TradeBidData,
  type TradeResult,
  type TradeSetup,
} from "@/lib/trade-bid";
import {
  bidHeading,
  bidSaveProblems,
  customerToSend,
  fillJobAddress,
  isDirty,
  listOpenAt,
  markupBaseNote,
  problemsNotice,
  resultRows,
  resultTotals,
  setCustomerField,
  subRows,
  subsAsSaved,
  tidyQuantities,
  type CustomerField,
  type ResultRow,
  type TotalKey,
  type TotalLine,
} from "@/lib/trade-bid-form";
import {
  getTradeBid,
  getTradeType,
  saveTradeBid,
  type saveTradeBidSchema,
  type TradeBid,
  type TradeType,
} from "@/lib/trade-bids.functions";
import { cn } from "@/lib/utils";

// ── Pieces both screens show ───────────────────────────────────────────────────────────────────

const NOTE =
  "flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200";

/** The way back to the list, top left of both screens. */
export function BackToList() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link to="/trade-bids" search={{}}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Trade Bids
      </Link>
    </Button>
  );
}

export function Loading(props: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" /> {props.children}
    </p>
  );
}

/** Something could not be opened: what, why (the server's own sentence) and the way back. */
export function CouldNotOpen(props: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <BackToList />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{props.title}</CardTitle>
          <CardDescription>{props.children}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

/**
 * Reads a record and hands it to the form ONCE: the record as first read fresh from the server.
 * A later re-read (the window coming back into view) is not handed over: starting the form
 * again from it would drop whatever is being typed. Until then it says it is loading, or why
 * the record could not be opened (the server's own sentence).
 */
export function FirstRead<T>(props: {
  query: { data: T | undefined; isFetching: boolean; error: unknown };
  loading: string;
  failed: string;
  children: (first: T) => ReactNode;
}) {
  const q = props.query;
  const [first, setFirst] = useState<{ record: T } | null>(null);
  if (first === null && q.data !== undefined && !q.isFetching) setFirst({ record: q.data });
  if (first) return <>{props.children(first.record)}</>;
  if (q.error) return <CouldNotOpen title={props.failed}>{plainErrText(q.error)}</CouldNotOpen>;
  return <Loading>{props.loading}</Loading>;
}

/**
 * The question asked when someone leaves with changes that are not saved (owner, Nov 16: "the
 * pop up reminding to save or giving the option to leave without saving"). Three answers, the
 * same three as on an opportunity and in the roofing estimator.
 */
export function LeaveDialog(props: {
  open: boolean;
  /** "this bid", "this trade". */
  what: string;
  onStay: () => void;
  onLeave: () => void;
  onSaveAndLeave: () => void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={(open) => !open && props.onStay()}>
      <AlertDialogContent data-leave>
        <AlertDialogHeader>
          <AlertDialogTitle>Save your changes to {props.what}?</AlertDialogTitle>
          <AlertDialogDescription>
            You have changes that are not saved. Save them before you leave, or leave without
            saving. Changes you do not save are lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={props.onStay}>Stay</AlertDialogCancel>
          <Button variant="outline" onClick={props.onLeave}>
            Leave without saving
          </Button>
          <AlertDialogAction
            onClick={(e) => {
              // Not the dialog's own close: it goes away once the save has gone through.
              e.preventDefault();
              props.onSaveAndLeave();
            }}
          >
            Save and leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// The sign of a total line said aloud: a screen reader skips "+" and "=" or reads them oddly.
const SIGN_WORD = { "": "", "+": "plus", "=": "equals" } as const;

// The lines under the sum: the time and the margin.
const FACTS: ReadonlySet<TotalKey> = new Set(["hours", "days", "margin"]);

/** One line of the totals: its sign and name on the left, its amount on the right. */
function totalLine(t: TotalLine) {
  return (
    <div key={t.key} data-total={t.key} className={cn(t.sign === "=" && "border-t pt-1")}>
      <div
        className={cn(
          "flex items-baseline justify-between gap-3",
          t.strong && "text-base font-bold",
        )}
      >
        <span className="min-w-0">
          {t.sign && (
            <>
              <span aria-hidden className="mr-1.5 inline-block w-3 text-muted-foreground">
                {t.sign}
              </span>
              <span className="sr-only">{SIGN_WORD[t.sign]} </span>
            </>
          )}
          {t.label}
        </span>
        <span className="shrink-0 text-right tabular-nums">{t.value}</span>
      </div>
      {t.hint && <p className="text-xs text-muted-foreground">{t.hint}</p>}
    </div>
  );
}

function PriceTable(props: {
  kind: "materials" | "labor" | "fixed" | "subs";
  nameHead: string;
  /** The middle column's heading; none for flat costs and sub lines, which have no quantity. */
  qtyHead?: string;
  /**
   * A sub line says two things more, each a muted line: who does it, under its name (`under`),
   * and its own markup, under its cost (`note`).
   */
  rows: (ResultRow & { under?: string | null; note?: string | null })[];
}) {
  if (props.rows.length === 0) return null;
  return (
    // Fixed column widths and wrapping words: on a phone the table narrows, it never scrolls.
    <table className="w-full table-fixed text-sm" data-price-table={props.kind}>
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-1.5 pr-2 font-medium">{props.nameHead}</th>
          {props.qtyHead && <th className="w-[30%] py-1.5 pr-2 font-medium">{props.qtyHead}</th>}
          <th className="w-[32%] py-1.5 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r, i) => (
          <tr key={`${r.id}-${i}`} className="border-b align-top last:border-0">
            <td className="break-words py-1.5 pr-2">
              {r.name}
              {r.under && <span className="block text-xs text-muted-foreground">{r.under}</span>}
            </td>
            {props.qtyHead && (
              <td className="break-words py-1.5 pr-2 tabular-nums">{r.qty || "—"}</td>
            )}
            <td className="break-words py-1.5 text-right tabular-nums">
              {r.cost ?? (
                // The line cannot be priced: what it is waiting for, where its cost would be.
                <span className="font-medium text-amber-700 dark:text-amber-400">{r.problem}</span>
              )}
              {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The price, laid out: what is missing (when something is), the materials, the labor, the flat
 * costs, the subcontractors (only when there are sub lines: what, who, what the sub is paid, and
 * a line's own markup under its cost), then the sum down to the price, the time and the margin.
 * Every word and number comes from trade-bid-form.ts (resultRows, subRows, resultTotals,
 * markupBaseNote), where it is tested.
 */
export function TradePrice(props: { setup: TradeSetup; result: TradeResult }) {
  const { setup, result } = props;
  const rows = resultRows(setup, result);
  // A sub line in the table's own shape. Who does it sits under the line's name, not in a
  // column of its own: on a phone a third column would cut "No subcontractor picked" mid-word.
  const subs = subRows(setup, result).map((s) => ({
    id: s.id,
    name: s.name,
    qty: "",
    cost: s.cost,
    problem: s.problem,
    under: s.vendor,
    note: s.markup,
  }));
  const totals = resultTotals(setup, result);
  const sum = totals.filter((t) => !FACTS.has(t.key));
  const facts = totals.filter((t) => FACTS.has(t.key));
  const baseNote = markupBaseNote(result);
  const nothing = rows.materials.length + rows.labor.length + rows.fixed.length + subs.length === 0;
  return (
    <div className="space-y-4">
      {result.problems.length > 0 && (
        <div role="status" className={NOTE} data-problems={result.problems.length}>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 space-y-1">
            <p className="font-medium">{problemsNotice(result.problems.length)}</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {result.problems.map((p, i) => (
                <li key={`${i}-${p}`} className="break-words">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {nothing ? (
        <p className="text-sm text-muted-foreground">
          Nothing to price yet: this trade has no materials, labor, flat costs or subcontractors.
        </p>
      ) : (
        <>
          <PriceTable
            kind="materials"
            nameHead="Materials"
            qtyHead="To buy"
            rows={rows.materials}
          />
          <PriceTable kind="labor" nameHead="Labor" qtyHead="Hours" rows={rows.labor} />
          <PriceTable kind="fixed" nameHead="Flat costs" rows={rows.fixed} />
          <PriceTable kind="subs" nameHead="Subcontractors" rows={subs} />
        </>
      )}
      <div className="border-t pt-3 text-sm" data-price-totals>
        <div className="space-y-1">{sum.map(totalLine)}</div>
        {/* Overhead and profit were not worked on the whole cost: said under the sum, so the
            two lines can be checked by hand. */}
        {baseNote && (
          <p className="mt-2 text-xs text-muted-foreground" data-markup-base>
            {baseNote}
          </p>
        )}
        {/* The time and the margin are facts about the price, not part of the sum. */}
        <div className="mt-3 space-y-1 border-t pt-3">{facts.map(totalLine)}</div>
      </div>
    </div>
  );
}

// ── The bid ────────────────────────────────────────────────────────────────────────────────────

/** Everything Save sends. What is on screen is compared with the copy of this last saved. */
interface Draft {
  /** The job name; blank = the server names the bid after its customer. */
  name: string;
  data: TradeBidData;
  accountId: string | null;
  siteId: string | null;
  /** YYYY-MM-DD, or "" for none. */
  dueDate: string;
}

const draftOfBid = (bid: TradeBid): Draft => ({
  name: bid.name,
  data: { ...bid.data, quantities: tidyQuantities(bid.data.quantities, bid.data.setup) },
  accountId: bid.account_id,
  siteId: bid.site_id,
  dueDate: bid.due_date ?? "",
});

/** A new bid of a trade: the trade's setup copied in, the estimator the person signed in. */
const draftOfTrade = (trade: TradeType, estimator: string): Draft => {
  const data = newTradeBid(trade);
  return {
    name: "",
    data: { ...data, customer: setCustomerField(data.customer, "estimatorName", estimator) },
    accountId: null,
    siteId: null,
    dueDate: "",
  };
};

type SaveInput = z.input<typeof saveTradeBidSchema>;

const sentences = (parts: readonly string[]) =>
  parts.map((p) => (p.endsWith(".") ? p : `${p}.`)).join(" ");

export function TradeBidScreen(props: { bidId?: string; tradeTypeId?: string }) {
  if (props.bidId) return <SavedBid bidId={props.bidId} />;
  if (props.tradeTypeId) return <NewBid tradeTypeId={props.tradeTypeId} />;
  return (
    <CouldNotOpen title="No bid to show">
      Pick a bid from the Trade Bids list, or start a new one there.
    </CouldNotOpen>
  );
}

function SavedBid(props: { bidId: string }) {
  const { session } = useAuth();
  const getFn = useServerFn(getTradeBid);
  const q = useQuery({
    queryKey: ["trade-bid", props.bidId],
    queryFn: () => getFn({ data: { id: props.bidId } }),
    enabled: !!session,
    // A bid just saved here is already in hand: opening it does not read it a second time.
    staleTime: 10_000,
  });
  return (
    <FirstRead query={q} loading="Opening the bid…" failed="This bid could not be opened">
      {(bid) => <BidForm bid={bid} start={draftOfBid(bid)} />}
    </FirstRead>
  );
}

function NewBid(props: { tradeTypeId: string }) {
  const { session, profile } = useAuth();
  const getFn = useServerFn(getTradeType);
  const q = useQuery({
    queryKey: ["trade-type", props.tradeTypeId],
    queryFn: () => getFn({ data: { id: props.tradeTypeId } }),
    enabled: !!session,
  });
  const estimator = (profile?.full_name ?? "").trim();
  return (
    // Read fresh, not from an earlier visit: a new bid copies the trade as it is set up NOW.
    <FirstRead
      query={q}
      loading="Getting the trade's setup…"
      failed="This trade could not be opened"
    >
      {(trade) => <BidForm bid={null} start={draftOfTrade(trade, estimator)} />}
    </FirstRead>
  );
}

function BidForm(props: { bid: TradeBid | null; start: Draft }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const saveFn = useServerFn(saveTradeBid);
  const statusFn = useServerFn(setBidStatus);
  const accountFn = useServerFn(getAccount);

  // The saved bid this form is on; null until a new bid's first save.
  const [bid, setBid] = useState<TradeBid | null>(props.bid);
  // `start` is worked out afresh on every draw of the parent; only the first one is used.
  const [draft, setDraft] = useState<Draft>(props.start);
  const [saved, setSaved] = useState<Draft>(props.start);
  const [customerLabel, setCustomerLabel] = useState(
    props.bid?.account?.name ?? props.bid?.data.customer.name ?? "",
  );
  const [status, setStatus] = useState<BidStatus>(asBidStatus(props.bid?.status));
  const [lostReason, setLostReason] = useState<string | null>(props.bid?.lost_reason ?? null);
  const [askLost, setAskLost] = useState(false);
  // Owner, Nov 17: "i also dont see where you can add a customer". The picker adds one when a
  // name is typed that is not on file, which nobody sees until they type. This is the same
  // dialog behind a button that is always in sight.
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [ratesOpen, setRatesOpen] = useState(false);
  // Number boxes holding something that is not a number: the measurements, the subcontractor
  // quotes, and the editor's.
  const [badQuantities, setBadQuantities] = useState(0);
  const [badSubs, setBadSubs] = useState(0);
  const [badRates, setBadRates] = useState(0);
  // Save was pressed with something missing: what is missing turns red.
  const [tried, setTried] = useState(false);

  const isNew = !bid;
  // A deleted bid (an old link) can be read, not changed.
  const deleted = !!bid?.deleted_at;
  const tradeName = draft.data.trade_name.trim() || "trade";
  const heading = bidHeading({ name: draft.name, tradeName: draft.data.trade_name, isNew });
  const result = useMemo(
    () => calcTradeBid(draft.data.setup, draft.data.quantities),
    [draft.data.setup, draft.data.quantities],
  );
  const problems = bidSaveProblems({
    isNew,
    accountId: draft.accountId,
    dueDate: draft.dueDate,
    invalidBoxes: badQuantities + badSubs + badRates,
  });

  const dirty = !deleted && isDirty(saved, draft);
  // Leaving with changes not saved asks first (owner, Nov 16): the back link, the menu and the
  // browser's back button all go through the router; closing or reloading the tab keeps the
  // browser's own warning. The ref is what the blocker reads, and it is cleared by hand before
  // the screen moves itself (a new bid, once saved, goes to its own address).
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current,
    withResolver: true,
    enableBeforeUnload: () => dirtyRef.current,
  });
  // True from "Save and leave" until the save answers: the question is hidden meanwhile.
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  leavingRef.current = leaving;
  const stayHere = () => {
    setLeaving(false);
    if (blocker.status === "blocked") blocker.reset();
  };

  const setData = (change: (data: TradeBidData) => TradeBidData) =>
    setDraft((d) => ({ ...d, data: change(d.data) }));
  const setCustomer = (field: CustomerField, text: string) =>
    setData((data) => ({ ...data, customer: setCustomerField(data.customer, field, text) }));
  // A change to this bid's own setup. A measure taken out takes its quantity with it, and the
  // last sub line taken out leaves "no sub lines" written the way the saved copy writes it.
  const setSetup = (changed: TradeSetup) => {
    const setup = subsAsSaved(changed, saved.data.setup);
    setData((data) => ({ ...data, setup, quantities: tidyQuantities(data.quantities, setup) }));
  };
  const setQuantity = (measureId: string, value: number | null) =>
    setData((data) => ({
      ...data,
      quantities: tidyQuantities({ ...data.quantities, [measureId]: value }, data.setup),
    }));

  // The customer's properties (the same read the property box below makes, so it is made once).
  // A property picked here fills the job address when that is still blank.
  const account = useQuery({
    queryKey: ["account", draft.accountId],
    queryFn: () => accountFn({ data: { id: draft.accountId! } }),
    enabled: !!session && !!draft.accountId,
  });
  const fillAddressFrom = useRef<string | null>(null);
  useEffect(() => {
    const siteId = fillAddressFrom.current;
    const detail = account.data;
    if (!siteId || !detail || detail.account.id !== draft.accountId) return;
    fillAddressFrom.current = null;
    const site = detail.sites.find((s) => s.id === siteId);
    if (site)
      setDraft((d) => ({
        ...d,
        data: { ...d.data, customer: fillJobAddress(d.data.customer, site) },
      }));
  }, [account.data, draft.accountId, draft.siteId]);

  const pickCustomer = (hit: AccountHit | null) => {
    setCustomerLabel(hit?.account_name ?? "");
    // A customer with one property comes with it (lib/account-search.ts).
    fillAddressFrom.current = hit?.site_id ?? null;
    setDraft((d) => ({
      ...d,
      accountId: hit?.account_id ?? null,
      siteId: hit?.site_id ?? null,
      // The customer's name is kept on the bid too: the proposal, the Margin report and the
      // bid's own name (when the job name is left blank) all read it from there.
      data: { ...d.data, customer: { ...d.data.customer, name: hit?.account_name ?? "" } },
    }));
  };

  /** The bid as the server now holds it becomes both what is on screen and what is saved. */
  const adopt = (row: TradeBid) => {
    const next = draftOfBid(row);
    setBid(row);
    setDraft(next);
    setSaved(next);
    setCustomerLabel(row.account?.name ?? row.data.customer.name);
    // The status is not this form's to save, but the server's answer carries the latest one.
    setStatus(asBidStatus(row.status));
    setLostReason(row.lost_reason);
    setTried(false);
  };

  const save = useMutation({
    mutationFn: () => {
      const input: SaveInput = {
        ...(bid ? { id: bid.id, expectUpdatedAt: bid.updated_at } : {}),
        name: draft.name,
        data: { ...draft.data, customer: customerToSend(draft.data.customer) },
        accountId: draft.accountId,
        siteId: draft.siteId,
        dueDate: draft.dueDate || null,
      };
      return saveFn({ data: input });
    },
    onSuccess: (row) => {
      const wasNew = !bid;
      toast.success("Saved");
      // The bid's own copy is replaced by the server's answer; the lists that show it re-read.
      qc.setQueryData(["trade-bid", row.id], row);
      void qc.invalidateQueries({ queryKey: ["trade-bids"] });
      void qc.invalidateQueries({ queryKey: ["my-work"] });
      if (row.account_id) void qc.invalidateQueries({ queryKey: ["account", row.account_id] });
      // A changed price changes what is left to bill (the Invoices block below).
      void qc.invalidateQueries({ queryKey: ["bid-invoices", row.id] });
      adopt(row);
      // Saved: nothing is pending any more, whichever way the screen goes next.
      dirtyRef.current = false;
      if (blocker.status === "blocked") {
        // "Save and leave", or the person went to leave while this save was on its way: with
        // everything saved there is nothing left to ask, so on to where they were going.
        setLeaving(false);
        blocker.proceed();
      } else if (wasNew) {
        // A new bid now has an address of its own; going there is not "leaving".
        void navigate({
          to: "/trade-bids",
          search: { bid: row.id },
          replace: true,
          ignoreBlocker: true,
        });
      }
    },
    onError: (e) => {
      // The server's refusals are already plain sentences.
      toast.error(plainErrText(e), { duration: 12_000 });
      if (leavingRef.current) stayHere();
    },
  });

  /** Save, unless something is missing: then say what, and send nothing. */
  const trySave = (andLeave: boolean) => {
    if (save.isPending || deleted) return;
    if (problems.length > 0) {
      setTried(true);
      toast.error(`Not saved yet. ${sentences(problems)}`);
      if (andLeave) stayHere();
      return;
    }
    if (andLeave) setLeaving(true);
    save.mutate();
  };

  // The status saves the moment it is changed (as on the Trade Bids list), never through Save.
  const statusSave = useMutation({
    mutationFn: (v: { status: BidStatus; reason: string | null }) =>
      statusFn({
        data: {
          id: bid!.id,
          status: v.status,
          ...(v.status === "lost" ? { lostReason: v.reason } : {}),
        },
      }),
    onSuccess: (_row, v) => {
      const reason = v.status === "lost" ? v.reason : null;
      setStatus(v.status);
      setLostReason(reason);
      toast.success(`Status saved: ${STATUS_LABELS[v.status]}`);
      if (bid)
        qc.setQueryData<TradeBid>(["trade-bid", bid.id], (old) =>
          old ? { ...old, status: v.status, lost_reason: reason } : old,
        );
      void qc.invalidateQueries({ queryKey: ["trade-bids"] });
      void qc.invalidateQueries({ queryKey: ["my-work"] });
      void qc.invalidateQueries({ queryKey: ["work-chain"] });
    },
    onError: (e) => toast.error(`The status was not changed. ${plainErrText(e)}`),
  });
  const pickStatus = (next: string) => {
    const to = asBidStatus(next);
    if (to === status || statusSave.isPending) return;
    if (to === "lost") setAskLost(true);
    else statusSave.mutate({ status: to, reason: null });
  };

  // Nothing is typed while a save is on its way: its answer replaces what is on screen.
  const locked = deleted || save.isPending;
  const customer = draft.data.customer;
  const missingCustomer = tried && !draft.accountId;
  const missingDue = tried && isNew && !draft.dueDate;

  return (
    <div className="space-y-4" data-trade-bid={bid?.id ?? "new"}>
      <BackToList />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <h1 className="break-words text-2xl font-bold tracking-tight">{heading}</h1>
          <Badge variant="secondary" className="max-w-full font-medium" data-bid-trade>
            {tradeName}
          </Badge>
        </div>
        {bid && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="trade-bid-status" className="text-xs text-muted-foreground">
                Status
              </Label>
              <Select
                value={status}
                disabled={deleted || statusSave.isPending}
                onValueChange={pickStatus}
              >
                <SelectTrigger
                  id="trade-bid-status"
                  className={cn(BOX, "w-40")}
                  data-status={status}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BID_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              data-documents
              onClick={() => setDocumentsOpen(true)}
            >
              <FileText /> Documents
            </Button>
          </div>
        )}
      </div>
      {bid && status === "lost" && (
        <p className="text-sm text-muted-foreground" data-lost-reason>
          {`Lost: ${lostReason ?? "reason not known"}`}
        </p>
      )}
      {deleted && (
        <div role="status" className={NOTE} data-deleted>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            This bid was deleted. It can be read here, but not changed. To work on it again, restore
            it from the Trade Bids list.
          </p>
        </div>
      )}

      <Card data-card="trade-bid-job">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">The job</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="trade-bid-name">Job name</Label>
              <Input
                id="trade-bid-name"
                className={BOX}
                value={draft.name}
                maxLength={200}
                disabled={locked}
                placeholder="Leave blank to name the bid after its customer"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trade-bid-estimator">Estimator</Label>
              <Input
                id="trade-bid-estimator"
                className={BOX}
                value={customer.estimatorName ?? ""}
                maxLength={120}
                disabled={locked}
                onChange={(e) => setCustomer("estimatorName", e.target.value)}
              />
            </div>
            <div className="space-y-1.5" data-field="customer">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <Label htmlFor="trade-bid-customer">Customer</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  disabled={locked}
                  onClick={() => setAddingCustomer(true)}
                  data-add-customer
                >
                  <UserPlus /> Add a new customer
                </Button>
              </div>
              <AccountPicker
                id="trade-bid-customer"
                value={
                  draft.accountId
                    ? { account_id: draft.accountId, site_id: draft.siteId, label: customerLabel }
                    : null
                }
                disabled={locked}
                placeholder="Search or add a customer…"
                onChange={pickCustomer}
              />
              {missingCustomer ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  Pick the customer. A bid is always for a customer.
                </p>
              ) : (
                !draft.accountId && (
                  <p className="text-xs text-muted-foreground">
                    Needed to save. Search for the customer here. Not on file yet? Press Add a new
                    customer.
                  </p>
                )
              )}
              {draft.accountId && (
                <div className="space-y-1.5 pt-1" data-field="property">
                  <Label htmlFor="trade-bid-property" className="text-xs text-muted-foreground">
                    Property (if the customer has more than one)
                  </Label>
                  <SiteSelect
                    id="trade-bid-property"
                    accountId={draft.accountId}
                    value={draft.siteId}
                    disabled={locked}
                    onChange={(site) => {
                      fillAddressFrom.current = site?.id ?? null;
                      setDraft((d) => ({ ...d, siteId: site?.id ?? null }));
                    }}
                  />
                </div>
              )}
            </div>
            <div className="space-y-1.5" data-field="due-date">
              <Label htmlFor="trade-bid-due">Due date</Label>
              <Input
                id="trade-bid-due"
                type="date"
                className={cn(BOX, "sm:max-w-[14rem]", missingDue && "border-destructive")}
                value={draft.dueDate}
                disabled={locked}
                aria-invalid={missingDue || undefined}
                onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
              />
              {missingDue ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  Pick the due date: the day the customer needs the bid by.
                </p>
              ) : (
                isNew &&
                !draft.dueDate && (
                  <p className="text-xs text-muted-foreground">
                    Needed to save: the day the customer needs the bid by.
                  </p>
                )
              )}
            </div>
          </div>

          <fieldset className="min-w-0 space-y-1.5" data-field="job-address">
            <legend className="mb-1.5 text-sm font-medium leading-none">Job address</legend>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_5rem_7rem]">
              <Input
                className={cn(BOX, "sm:col-span-4")}
                aria-label="Street"
                placeholder="Street"
                value={customer.projectAddress}
                maxLength={300}
                disabled={locked}
                onChange={(e) => setCustomer("projectAddress", e.target.value)}
              />
              <Input
                className={cn(BOX, "sm:col-span-2")}
                aria-label="City"
                placeholder="City"
                value={customer.jobCity ?? ""}
                maxLength={120}
                disabled={locked}
                onChange={(e) => setCustomer("jobCity", e.target.value)}
              />
              <Input
                className={BOX}
                aria-label="State"
                placeholder="State"
                value={customer.jobState ?? ""}
                maxLength={40}
                disabled={locked}
                onChange={(e) => setCustomer("jobState", e.target.value)}
              />
              <Input
                className={BOX}
                aria-label="Zip"
                placeholder="Zip"
                value={customer.jobZip ?? ""}
                maxLength={20}
                disabled={locked}
                onChange={(e) => setCustomer("jobZip", e.target.value)}
              />
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="trade-bid-scope">What the work is</Label>
            <Textarea
              id="trade-bid-scope"
              className="min-h-36 text-base md:text-base"
              value={draft.data.scope}
              maxLength={8000}
              disabled={locked}
              onChange={(e) => setData((data) => ({ ...data, scope: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">This prints on the proposal.</p>
          </div>
        </CardContent>
      </Card>

      <Card data-card="trade-bid-measurements">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Measurements</CardTitle>
          <CardDescription>
            Type what this job measures. The price below follows as you type.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvalidBoxes onChange={setBadQuantities}>
            <MeasureBoxes
              measures={draft.data.setup.measures}
              quantities={draft.data.quantities}
              disabled={locked}
              onChange={setQuantity}
            />
          </InvalidBoxes>
        </CardContent>
      </Card>

      <Card data-card="trade-bid-subs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Subcontractor quotes</CardTitle>
          <CardDescription>
            Work you hand to a subcontractor. Type the quote here when it comes in. No sales tax and
            no crew hours are added for it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* These lines are part of this bid's own copy of the setup: a change here goes the
              same way as one in the Rates and lines popup, into what Save saves. */}
          <InvalidBoxes onChange={setBadSubs}>
            <SubQuoteRows
              setup={draft.data.setup}
              result={result}
              disabled={locked}
              onChange={setSetup}
            />
          </InvalidBoxes>
        </CardContent>
      </Card>

      <Card data-card="trade-bid-price">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">The price</CardTitle>
        </CardHeader>
        <CardContent>
          <TradePrice setup={draft.data.setup} result={result} />
        </CardContent>
      </Card>

      {/* A saved bid's invoices (owner, Nov 17). Not part of this form: nothing here is saved by
          Save, and nothing here makes the bid "not saved". */}
      {bid && (
        <BidInvoicesCard bidId={bid.id} won={status === "won"} unsaved={dirty} deleted={deleted} />
      )}

      {/* Save, and the bid's own rates and lines, always in reach (owner, Nov 17: "can we have
          this be a button to the left of the save button that you can click and it pops up
          those forms"). A deleted bid keeps the button, to read the lines, and has no Save. */}
      <SaveBar>
        <div className="min-w-0 flex-1 text-sm" data-save-note>
          {deleted ? (
            <p className="text-muted-foreground">A deleted bid can be read, not changed.</p>
          ) : problems.length > 0 ? (
            <p className={tried ? "font-medium text-destructive" : "text-muted-foreground"}>
              {`Before you can save: ${sentences(problems)}`}
            </p>
          ) : dirty ? (
            <p>You have changes that are not saved.</p>
          ) : (
            <p className="text-muted-foreground">
              {isNew ? "Nothing is saved until you press Save." : "All changes are saved."}
            </p>
          )}
        </div>
        <div className={SAVE_BAR_ACTIONS}>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            data-open-rates
            onClick={() => setRatesOpen(true)}
          >
            <SlidersHorizontal /> Rates and lines
          </Button>
          {!deleted && (
            <Button
              type="button"
              className="h-10 min-w-24"
              data-save
              disabled={save.isPending}
              onClick={() => trySave(false)}
            >
              {save.isPending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          )}
        </div>
      </SaveBar>

      {/* The bid's own copy of the setup, in a popup over the bid. Every change goes straight
          into the bid on screen (the price behind it moves), and Save on the bid saves it:
          Done only closes the popup. */}
      <Dialog open={ratesOpen} onOpenChange={setRatesOpen}>
        <DialogContent
          className="flex max-h-[92svh] w-[calc(100vw-1rem)] max-w-6xl flex-col gap-0 p-0"
          data-rates-dialog
          // Opening it puts the cursor on the popup, not in its first box with the words
          // selected, where the next key pressed would wipe out a name.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus();
          }}
          // Escape in an open list (the subcontractor picker) closes the list, not the popup.
          onEscapeKeyDown={(e) => {
            if (listOpenAt(document.activeElement)) e.preventDefault();
          }}
        >
          <DialogHeader className="border-b px-4 py-3 pr-12 sm:px-6">
            <DialogTitle>Change this bid&apos;s rates and lines</DialogTitle>
            <DialogDescription>
              {`Only this bid changes. The ${tradeName} setup stays as it is.`}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6" data-rates-body>
            <TradeLinesEditor
              value={draft.data.setup}
              onChange={setSetup}
              disabled={locked}
              onInvalidChange={setBadRates}
            />
          </div>
          <DialogFooter className="flex-row items-center justify-between gap-3 border-t px-4 py-3 sm:justify-between sm:px-6">
            <p className="min-w-0 text-sm" data-rates-price>
              <span className="text-muted-foreground">Price </span>
              <span className="font-semibold tabular-nums">{fmtMoney(result.price)}</span>
            </p>
            <Button
              type="button"
              className="h-10 min-w-24"
              data-rates-done
              onClick={() => setRatesOpen(false)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {bid && (
        <DocumentsPanel
          kind="bid"
          bidId={bid.id}
          recordLabel={heading}
          open={documentsOpen}
          onOpenChange={setDocumentsOpen}
        />
      )}
      {askLost && (
        <LostReasonDialog
          open
          bidName={heading}
          initial={lostReason}
          onCancel={() => setAskLost(false)}
          onConfirm={(reason) => {
            setAskLost(false);
            statusSave.mutate({ status: "lost", reason });
          }}
        />
      )}
      <QuickAddCustomerDialog
        open={addingCustomer}
        initialName=""
        onOpenChange={setAddingCustomer}
        onCreated={(hit) => {
          setAddingCustomer(false);
          pickCustomer(hit);
        }}
      />
      <LeaveDialog
        open={blocker.status === "blocked" && !leaving}
        what="this bid"
        onStay={stayHere}
        onLeave={() => {
          if (blocker.status === "blocked") blocker.proceed();
        }}
        onSaveAndLeave={() => trySave(true)}
      />
    </div>
  );
}
