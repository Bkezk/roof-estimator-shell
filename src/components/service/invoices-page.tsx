/**
 * The Invoices list (docs/service-module-design.md §5.4–§5.5): every ticket invoice, filtered by
 * status and invoice date, with footer totals for the rows shown; a row opens the invoice on its
 * own full-width page (`?id=<invoice uuid>`, invoice-editor.tsx; owner, Oct 1), where it is
 * edited. **Export to Sage** writes the bookkeeper's CSV for a date range (final and paid
 * invoices) and stamps them exported.
 *
 * The first chip, **Awaiting invoice** (`?tab=to-invoice`; owner, Oct 1, asked what "To
 * invoice" meant), is the queue before that: the tickets at stage Authorized (M9, owner Oct 5:
 * a Done ticket is reviewed first), which is exactly "marked Authorized with no finalised
 * invoice yet" (finalising moves a ticket to Invoiced), longest waiting first; a row opens the
 * ticket (`?from=invoices`, so its Back returns here), where its invoice card is. Until Oct 9
 * the queue filtered for Done while the server returned Authorized, so it was always empty.
 *
 * The Customer column is whom the invoice is billed to; an invoice billed to a vendor shows the
 * badge "Billed to vendor: <name>" there instead (owner, Oct 1: "Sometimes invoices go to
 * vendors").
 *
 * Admins, managers and sales / project managers (`seesInvoices`; owner, Oct 1); technicians
 * never see money (the server refuses them too). Every change is logged (audit_log).
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FileDown,
  Loader2,
  Receipt,
} from "lucide-react";
import { ServiceTabs } from "@/components/service/service-tabs";

import { useAuth } from "@/lib/auth-store";
import { seesInvoices } from "@/lib/access";
import {
  groupInvoicesByStatus,
  readCollapsedInvoiceGroups,
  toggleCollapsedGroup,
  writeCollapsedInvoiceGroups,
} from "@/lib/invoice-groups";
import {
  AWAITING_INVOICE_TITLE,
  invoiceListSearch,
  type InvoiceListSearch,
  type InvoiceSearch,
} from "@/lib/invoice-search";
import {
  invoiceDue,
  invoiceMatches,
  sortInvoices,
  type InvoiceSort,
  type InvoiceSortKey,
} from "@/lib/invoice-list";
import {
  AWAITING_INVOICE_KEY,
  listAwaitingInvoice,
  type ServiceJobListRow,
} from "@/lib/service.functions";
import { daysSince, toInvoice as toInvoiceRows, waitingSince } from "@/lib/service-schedule";
import {
  exportSageCsv,
  markSageExported,
  INVOICE_STATUSES,
  type InvoiceStatus,
  listInvoices,
} from "@/lib/invoices.functions";
import { InvoiceEditorPage, InvoiceStatusBadge } from "@/components/service/invoice-editor";
import { VendorBilledBadge } from "@/components/service/bill-to-picker";
import {
  asInvoiceStatus,
  downloadBlob,
  errText,
  money,
  shortDay,
  stampDay,
  STATUS_LABELS,
  thisMonth,
  todayYmd,
} from "@/components/service/invoice-utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { exportedSummary } from "@/lib/sage-export";

export function InvoicesPage({ search }: { search: InvoiceSearch }) {
  const { profile } = useAuth();
  // ?id=: that invoice, full width; the list's filters ride along so its Back returns to them
  // (owner, Nov 3, review item 11). Without an id: the list on the URL's chip, dates, search
  // text and sort (?status= "unpaid" = final, the Owner view's tile).
  const invoiceId = search.id;
  const toInvoice = search.tab === "to-invoice";
  if (!seesInvoices(profile))
    return (
      <div className="mx-auto max-w-md space-y-3 rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium">Invoices are for managers and sales.</p>
        <p className="text-sm text-muted-foreground">Your tickets are on My tickets.</p>
        <Button asChild>
          <Link to="/service/today">Go to My tickets</Link>
        </Button>
      </div>
    );
  if (invoiceId) return <InvoiceEditorPage id={invoiceId} listSearch={invoiceListSearch(search)} />;
  return <InvoiceList toInvoice={toInvoice} filters={invoiceListSearch(search)} />;
}

/** How long the search box waits before writing what was typed into the URL. */
const SEARCH_URL_DELAY_MS = 300;

type StatusFilter = "all" | InvoiceStatus | "unpaid";

function Chip(props: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={props.active ? "default" : "outline"}
      className="h-7 rounded-full px-3 text-xs"
      aria-pressed={props.active}
      title={props.title}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

function InvoiceList({ toInvoice, filters }: { toInvoice: boolean; filters: InvoiceListSearch }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const listFn = useServerFn(listInvoices);
  const awaitingFn = useServerFn(listAwaitingInvoice);
  // The filters are the URL's (owner, Nov 3, review item 11: "Unpaid → open → Mark paid → back"
  // used to land on All): each change rewrites /service/invoices's search params in place, so
  // opening an invoice and pressing Back, or its "← Invoices" link, lands on the same chip,
  // dates, search text and sort. The Awaiting invoice chip is ?tab=to-invoice, as before.
  const status: StatusFilter = filters.status ?? "all";
  const from = filters.from ?? "";
  const to = filters.to ?? "";
  const sort: InvoiceSort = filters.sort
    ? {
        key: filters.sort.split(":")[0] as InvoiceSortKey,
        dir: filters.sort.endsWith(":asc") ? "asc" : "desc",
      }
    : { key: "date", dir: "desc" };
  const writeFilters = (next: InvoiceListSearch) =>
    void navigate({ to: "/service/invoices", search: next, replace: true });
  const patchFilters = (patch: Partial<Record<keyof InvoiceListSearch, unknown>>) => {
    const next: InvoiceListSearch = { ...filters };
    delete next.tab;
    for (const [k, v] of Object.entries(patch) as [keyof InvoiceListSearch, unknown][]) {
      if (v === undefined || v === null || v === "" || v === "all") delete next[k];
      else (next as Record<string, unknown>)[k] = v;
    }
    writeFilters(next);
  };
  const setStatus = (s: StatusFilter) => patchFilters({ status: s });
  const setFrom = (v: string) => patchFilters({ from: v });
  const setTo = (v: string) => patchFilters({ to: v });
  const showToInvoice = () => writeFilters({ ...filters, tab: "to-invoice" });
  // A click on a heading sorts by it (A–Z, oldest, smallest first); a second click reverses.
  // The list's own order (newest first) is left out of the URL.
  const sortBy = (key: InvoiceSortKey) => {
    const dir = sort.key === key && sort.dir === "asc" ? "desc" : "asc";
    patchFilters({ sort: key === "date" && dir === "desc" ? undefined : `${key}:${dir}` });
  };
  // The search box types locally and lands in the URL a moment later (a URL write per
  // keystroke would fight the caret); a q arriving from the URL (Back) refills the box.
  const [q, setQ] = useState(filters.q ?? "");
  const sentQ = useRef(filters.q ?? "");
  useEffect(() => {
    const next = filters.q ?? "";
    if (next !== sentQ.current) {
      sentQ.current = next;
      setQ(next);
    }
  }, [filters.q]);
  useEffect(() => {
    const next = q.trim();
    if (next === sentQ.current) return;
    const t = setTimeout(() => {
      sentQ.current = next;
      patchFilters({ q: next });
    }, SEARCH_URL_DELAY_MS);
    return () => clearTimeout(t);
    // patchFilters closes over the current filters; the timer re-arms on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const [exportOpen, setExportOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<InvoiceStatus[]>(() =>
    readCollapsedInvoiceGroups(typeof window === "undefined" ? null : window.localStorage),
  );
  const today = todayYmd();

  const list = useQuery({
    queryKey: ["invoices", status, from, to],
    queryFn: () =>
      listFn({
        data: {
          ...(status !== "all" ? { status } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
      }),
    enabled: !!session && !toInvoice,
  });
  // The Authorized tickets and their count from the server (the count is the database's, not
  // the length of the 1,000-row ticket list). Under "service-jobs", so every ticket change that
  // refreshes the Tickets list refreshes this too.
  const jobsQ = useQuery({
    queryKey: AWAITING_INVOICE_KEY,
    queryFn: () => awaitingFn(),
    enabled: !!session,
  });
  const waiting = toInvoiceRows(jobsQ.data?.rows ?? []);
  const waitingCount = jobsQ.data?.count ?? 0;
  // The search narrows the rows shown, and the footer sums what is shown.
  const rows = (list.data ?? []).filter((r) => invoiceMatches(r, q));
  // Void invoices are not money owed; they stay out of the footer sums.
  const live = rows.filter((r) => r.status !== "void");
  const sum = (f: (r: (typeof rows)[number]) => number) => live.reduce((n, r) => n + f(r), 0);
  const totalSum = sum((r) => Number(r.total));
  const paidSum = sum((r) => (r.status === "paid" ? Number(r.paid_amount) : 0));
  const openSum = sum((r) => (asInvoiceStatus(r.status) === "final" ? Number(r.total) : 0));
  const shown = sortInvoices(rows, sort.key, sort.dir);
  // One collapsible group per status, Draft → Final → Paid → Void (owner, Nov 9: "like on bids
  // where each status is a collapsible row"); the rows keep the sort inside each group (by date,
  // newest first, unless a heading was clicked). A collapsed group is remembered per browser.
  const groups = groupInvoicesByStatus(shown);
  const toggleGroup = (st: InvoiceStatus) =>
    setCollapsed((prev) => {
      const next = toggleCollapsedGroup(prev, st);
      writeCollapsedInvoiceGroups(window.localStorage, next);
      return next;
    });
  const anyFilter = status !== "all" || !!from || !!to || !!q.trim();
  // The ticket's Back link returns to this queue (owner, Oct 9).
  const open = (serviceJobId: string) =>
    void navigate({ to: "/service", search: { id: serviceJobId, from: "invoices" } });
  // The invoice's URL carries the list's filters, so its "← Invoices" returns to them.
  const openInvoice = (invoiceId: string) =>
    void navigate({ to: "/service/invoices", search: { ...filters, id: invoiceId } });

  /** One invoice's row (the same columns in every group). */
  const renderRow = (r: (typeof shown)[number]) => {
    const s = asInvoiceStatus(r.status);
    // Due and how late (owner, Nov 3, review item 12): a late open invoice is tinted.
    const due = invoiceDue(r, today);
    const late = due.lateDays > 0;
    return (
      <tr
        key={r.id}
        className={`cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40 ${s === "void" ? "text-muted-foreground" : ""} ${late ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}
        data-late={late ? due.lateDays : undefined}
        onClick={() => openInvoice(r.id)}
      >
        <td className="px-3 py-2 font-medium tabular-nums">
          <Link
            to="/service/invoices"
            search={{ ...filters, id: r.id }}
            className="underline-offset-2 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {r.label}
          </Link>
        </td>
        <td className="whitespace-nowrap px-3 py-2">{shortDay(r.invoice_date)}</td>
        <td className="px-3 py-2">
          {r.bill_to_vendor_id ? (
            <VendorBilledBadge name={r.customer_name} />
          ) : (
            r.customer_name || "—"
          )}
        </td>
        <td className="px-3 py-2">{r.site_name || "—"}</td>
        <td className="whitespace-nowrap px-3 py-2">{r.po_number || "—"}</td>
        <td className="whitespace-nowrap px-3 py-2">{r.job_code || "—"}</td>
        <td className={`px-3 py-2 text-right tabular-nums ${s === "void" ? "line-through" : ""}`}>
          {money(r.total)}
        </td>
        <td className="px-3 py-2">
          <InvoiceStatusBadge status={r.status} />
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          {due.due ? shortDay(due.due) : due.open ? "On receipt" : "—"}
          {late && (
            <span className="block text-xs font-medium text-amber-700 dark:text-amber-400">
              {due.lateDays} day{due.lateDays === 1 ? "" : "s"} late
            </span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          {r.paid_on ? (
            <>
              {shortDay(r.paid_on)}
              <span className="block text-xs text-muted-foreground">
                {money(r.paid_amount)}
                {r.paid_ref ? ` · ${r.paid_ref}` : ""}
              </span>
            </>
          ) : (
            "—"
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          {stampDay(r.sent_at) || "—"}
          <span className="block text-xs text-muted-foreground">
            {r.sent_by_name ? `by ${r.sent_by_name}` : ""}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2">{stampDay(r.sage_exported_at) || "—"}</td>
      </tr>
    );
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Receipt className="h-6 w-6" /> Invoices
          </h1>
          <p className="text-sm text-muted-foreground">Open a row to edit, send or mark it paid.</p>
          <div className="mt-2">
            <ServiceTabs />
          </div>
        </div>
        <Button size="lg" variant="outline" onClick={() => setExportOpen(true)}>
          <FileDown className="mr-2 h-5 w-5" /> Export to Sage
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip
            active={toInvoice}
            title={AWAITING_INVOICE_TITLE}
            onClick={toInvoice ? () => setStatus("all") : showToInvoice}
          >
            Awaiting invoice{jobsQ.data ? ` (${waitingCount})` : ""}
          </Chip>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <Chip active={!toInvoice && status === "all"} onClick={() => setStatus("all")}>
            All
          </Chip>
          <Chip
            active={!toInvoice && status === "unpaid"}
            title="Final, not yet marked paid"
            onClick={() => setStatus(!toInvoice && status === "unpaid" ? "all" : "unpaid")}
          >
            Unpaid
          </Chip>
          {INVOICE_STATUSES.map((s) => (
            <Chip
              key={s}
              active={!toInvoice && status === s}
              onClick={() => setStatus(!toInvoice && status === s ? "all" : s)}
            >
              {STATUS_LABELS[s]}
            </Chip>
          ))}
        </div>
        {toInvoice ? (
          <p className="text-xs text-muted-foreground">
            Authorized tickets waiting for their invoice, longest waiting first. Open one to make
            and finalise its invoice.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted-foreground sm:max-w-sm">
              Search
              <Input
                type="search"
                value={q}
                placeholder="Search number, customer, property, PO #, Job #"
                className="bg-background"
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Invoice date from
              <Input
                type="date"
                value={from}
                className="w-[160px] bg-background"
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              to
              <Input
                type="date"
                value={to}
                className="w-[160px] bg-background"
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            {anyFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQ("");
                  sentQ.current = "";
                  writeFilters({});
                }}
              >
                Clear filters
              </Button>
            )}
            {list.data && (
              <span className="ml-auto text-xs text-muted-foreground">
                {rows.length} invoice{rows.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </div>

      {toInvoice ? (
        <ToInvoiceTable
          rows={waiting}
          count={waitingCount}
          loading={jobsQ.isLoading || !jobsQ.data}
          error={jobsQ.error}
          onOpen={open}
        />
      ) : list.error ? (
        <p className="text-sm text-destructive">
          Could not load invoices ({errText(list.error)}). Try refreshing, or sign in again.
        </p>
      ) : list.isLoading || !list.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading invoices…
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {anyFilter
            ? "No invoices match these filters."
            : "No invoices yet. Make one from an Authorized ticket's invoice card (Make the invoice)."}
        </div>
      ) : (
        // min-w-0 (Nov 3): the table's minimum width used to push the page itself wider on a
        // phone, which then zoomed the whole page out; now the table scrolls inside its box.
        <div className="min-w-0 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1140px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <SortHead label="#" k="number" sort={sort} onSort={sortBy} />
                <SortHead label="Date" k="date" sort={sort} onSort={sortBy} />
                <SortHead label="Customer" k="customer" sort={sort} onSort={sortBy} />
                <SortHead label="Property" k="property" sort={sort} onSort={sortBy} />
                <SortHead label="Customer PO" k="po" sort={sort} onSort={sortBy} />
                <SortHead label="Job #" k="job" sort={sort} onSort={sortBy} />
                <SortHead label="Total" k="total" sort={sort} onSort={sortBy} right />
                <SortHead label="Status" k="status" sort={sort} onSort={sortBy} />
                <SortHead label="Due" k="due" sort={sort} onSort={sortBy} />
                <th className="px-3 py-2 font-medium">Paid</th>
                <SortHead label="Sent" k="sent" sort={sort} onSort={sortBy} />
                <th className="px-3 py-2 font-medium">Sage</th>
              </tr>
            </thead>
            {groups.map((g) => {
              const open = !collapsed.includes(g.status);
              const Chevron = open ? ChevronDown : ChevronRight;
              return (
                <tbody key={g.status} data-group={g.status} data-open={open ? "" : undefined}>
                  <tr className="border-b bg-muted/30">
                    <td colSpan={12} className="px-3 py-1.5">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm text-left hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-expanded={open}
                        title={open ? "Collapse this group" : "Expand this group"}
                        onClick={() => toggleGroup(g.status)}
                      >
                        <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="text-xs font-semibold uppercase tracking-wide">
                          {STATUS_LABELS[g.status]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {g.rows.length} invoice{g.rows.length === 1 ? "" : "s"}
                          {g.status === "void" ? "" : ` · ${money(g.total)}`}
                        </span>
                      </button>
                    </td>
                  </tr>
                  {open && g.rows.map(renderRow)}
                </tbody>
              );
            })}
            <tfoot>
              <tr className="border-t bg-muted/40 text-sm font-medium">
                <td className="px-3 py-2" colSpan={6}>
                  {live.length} invoice{live.length === 1 ? "" : "s"}
                  {rows.length !== live.length ? " (void left out)" : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(totalSum)}</td>
                <td className="px-3 py-2 text-xs font-normal text-muted-foreground" colSpan={5}>
                  Paid {money(paidSum)} · Open {money(openSum)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  );
}

/** A column heading that sorts the list; the arrow shows the column and direction in use. */
function SortHead(props: {
  label: string;
  k: InvoiceSortKey;
  sort: InvoiceSort;
  onSort: (k: InvoiceSortKey) => void;
  right?: boolean;
}) {
  const on = props.sort.key === props.k;
  const Arrow = props.sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={`px-3 py-2 font-medium ${props.right ? "text-right" : ""}`}
      aria-sort={on ? (props.sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={`inline-flex items-center gap-1 hover:text-foreground ${on ? "text-foreground" : ""}`}
        onClick={() => props.onSort(props.k)}
      >
        {props.label}
        {on && <Arrow className="h-3 w-3" aria-hidden />}
      </button>
    </th>
  );
}

/** The Awaiting invoice queue: Authorized tickets, longest waiting first; a row opens its ticket. */
function ToInvoiceTable(props: {
  rows: ServiceJobListRow[];
  /** Every Authorized ticket (the database's count); more than rows when the list is capped. */
  count: number;
  loading: boolean;
  error: Error | null;
  onOpen: (serviceJobId: string) => void;
}) {
  if (props.error)
    return (
      <p className="text-sm text-destructive">
        Could not load the tickets ({errText(props.error)}). Try refreshing, or sign in again.
      </p>
    );
  if (props.loading)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading tickets…
      </p>
    );
  if (props.rows.length === 0)
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        Nothing waiting: every Authorized ticket has been invoiced.
      </div>
    );
  const now = new Date();
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Ticket</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Property</th>
            <th className="px-3 py-2 font-medium">Technician</th>
            <th className="px-3 py-2 font-medium">Authorized</th>
            <th className="px-3 py-2 text-right font-medium">Waiting</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((j) => {
            const since = waitingSince(j);
            const days = daysSince(since, now);
            return (
              <tr
                key={j.id}
                className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
                onClick={() => props.onOpen(j.id)}
              >
                <td className="px-3 py-2 font-medium tabular-nums">
                  <Link
                    to="/service"
                    search={{ id: j.id, from: "invoices" }}
                    className="underline-offset-2 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    #{j.number}
                  </Link>
                </td>
                <td className="px-3 py-2">{j.customer_name || "—"}</td>
                <td className="px-3 py-2">
                  {j.site_name || "—"}
                  {j.site_address ? (
                    <span className="block text-xs text-muted-foreground">{j.site_address}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{j.technician_name ?? "Unassigned"}</td>
                <td className="whitespace-nowrap px-3 py-2">{stampDay(since)}</td>
                <td
                  className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${days >= 7 ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}
                >
                  {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/40 text-sm font-medium">
            <td className="px-3 py-2" colSpan={6}>
              {props.count} ticket{props.count === 1 ? "" : "s"} awaiting invoice
              {props.count > props.rows.length
                ? ` (the ${props.rows.length} waiting longest shown)`
                : ""}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

type SageFile = Awaited<ReturnType<ReturnType<typeof useServerFn<typeof exportSageCsv>>>>;

/**
 * Export to Sage (Nov 4, bugs 6 and 7 of the Nov 3 review): the server builds the file; when an
 * invoice would go out with a blank CustomerId the dialog says which and offers Download anyway;
 * the file downloads; THEN the invoices are stamped exported (markSageExported, which never
 * overwrites an earlier stamp). A dropped connection on the way down stamps nothing.
 */
function ExportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const exportFn = useServerFn(exportSageCsv);
  const stampFn = useServerFn(markSageExported);
  const month = thisMonth();
  const [from, setFrom] = useState(month.from);
  const [to, setTo] = useState(month.to);
  const [onlyNew, setOnlyNew] = useState(true);
  // A file waiting on the blank-CustomerId warning.
  const [held, setHeld] = useState<SageFile | null>(null);
  const stamp = useMutation({
    mutationFn: (r: SageFile) => stampFn({ data: { ids: r.ids } }),
    onSuccess: ({ stamped }, r) => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success(exportedSummary(r.count, stamped));
      onClose();
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.error(
        `The file downloaded, but the invoices could not be marked exported: ${errText(e)}. Export again with "Only invoices not yet exported" to see them.`,
      );
      onClose();
    },
  });
  const download = (r: SageFile) => {
    downloadBlob(new Blob([r.csv], { type: "text/csv;charset=utf-8" }), r.file_name);
    stamp.mutate(r);
  };
  const run = useMutation({
    mutationFn: () => exportFn({ data: { from, to, only_unexported: onlyNew } }),
    onSuccess: (r) => {
      if (r.count === 0) {
        toast.info(
          onlyNew
            ? "Nothing new to export in that range (every final invoice there was exported already)."
            : "No final, sent or paid invoices in that range.",
        );
        return;
      }
      if (r.missing.length) {
        setHeld(r);
        return;
      }
      download(r);
    },
    onError: (e) => toast.error(`Could not export to Sage: ${errText(e)}`),
  });
  const busy = run.isPending || stamp.isPending;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {held ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {held.missing.length === 1
                  ? "One invoice has no Sage customer #"
                  : `${held.missing.length} invoices have no Sage customer #`}
              </DialogTitle>
              <DialogDescription>
                Their CustomerId column would be blank, so the bookkeeper has to look the account
                up. Add the number — on the customer&apos;s page, or on the vendor in the Vendors
                section — and export again, or download the file as it is.
              </DialogDescription>
            </DialogHeader>
            <ul className="max-h-60 space-y-1 overflow-y-auto text-sm" data-line="sage-missing">
              {held.missing.map((m) => (
                <li key={m.label}>
                  <span className="font-medium">#{m.label}</span> — {m.bill_to || "(no name)"}{" "}
                  <span className="text-muted-foreground">
                    ({m.vendor ? "vendor" : "customer"})
                  </span>
                </li>
              ))}
            </ul>
            <DialogFooter className="gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setHeld(null)}>
                Back
              </Button>
              <Button disabled={busy} onClick={() => download(held)} data-action="download-anyway">
                {stamp.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="mr-2 h-4 w-4" />
                )}
                Download anyway
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Export to Sage</DialogTitle>
              <DialogDescription>
                A CSV of the final and paid invoices dated in this range (one row per invoice and
                one per line) for the bookkeeper to import. Once the file has downloaded, those
                invoices are stamped exported; one exported before keeps its first date.
              </DialogDescription>
            </DialogHeader>
            <form
              id="sage-export"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!valid) {
                  toast.error("Pick a from and to date (from on or before to)");
                  return;
                }
                run.mutate();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="sage-from">From</Label>
                  <Input
                    id="sage-from"
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sage-to">To</Label>
                  <Input
                    id="sage-to"
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={onlyNew} onCheckedChange={(v) => setOnlyNew(v === true)} />
                Only invoices not yet exported
              </label>
            </form>
            <DialogFooter className="gap-2">
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" form="sage-export" disabled={busy || !valid}>
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="mr-2 h-4 w-4" />
                )}
                Export CSV
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
