/**
 * The invoice editor, on its own full-width page (`/service/invoices?id=<invoice uuid>`; owner,
 * Oct 1: "the invoice is cramped into a little dropdown and difficult to edit"). The ticket keeps
 * a summary card (invoice-block.tsx) whose Open button lands here.
 *
 * The page: a header linking back to the ticket ("← Ticket #6012 · <customer>"), the invoice
 * label, its status and the ticket's other invoices as chips (6012, 6012.2, …) with "Another
 * invoice"; then the draft editor (header fields across the top, the line table, totals / cost /
 * margin in a summary box on the right, the actions along the bottom) or the final invoice
 * (facts, lines, totals; Download, Send, Mark paid, Void); the History fold under it. On a phone
 * everything stacks to one column and each line becomes a small card.
 *
 * A draft is made from the ticket's time and materials (getOrCreateInvoice, §4 rules), edited
 * here and then finalised, or finalised and emailed, or deleted; a final invoice is read-only and
 * can be downloaded, sent again, marked paid or voided (docs/service-module-design.md §5.4).
 * Numbering is invoice-numbering.ts ("<ticket>", "<ticket>.2", …; a deleted or voided invoice
 * frees its number).
 *
 * Bill to (owner, Oct 1: "Sometimes invoices go to vendors"): a draft is billed to the ticket's
 * customer account or to a billable vendor (BillToChoice, bill-to-picker.tsx); saving takes the
 * Send To snapshot again from whoever is picked. A final invoice keeps it; one billed to a vendor
 * shows "Billed to vendor: <name>", and Send defaults to the vendor's email.
 *
 * Admins, managers and sales / project managers (`seesInvoices`; the Invoices page gates it);
 * every write is logged on the server (audit_log), and admins and managers see it in History.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  Ban,
  ChevronRight,
  CircleDollarSign,
  Download,
  Eye,
  FileCheck2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { managesTickets } from "@/lib/access";
import { AuditHistory } from "@/components/audit-history";
import { getAccount, listContacts } from "@/lib/crm.functions";
import { applyMarkup, rateText, rescaleCost, unitText } from "@/lib/invoice-materials";
import { invoiceLabel, remainingInvoiceAfterVoid } from "@/lib/invoice-numbering";
import {
  computeTotals,
  poCostForInvoice,
  storedTotals,
  type InvoiceTotals,
} from "@/lib/invoice-totals";
import { approvedPoTotal } from "@/lib/purchase-orders";
import { accountBillTo, vendorBillTo, type BillToSnapshot } from "@/lib/vendors";
import { sendToEdited, sendToOf, type SendTo } from "@/lib/invoice-send-to";
import { useVendors } from "@/components/crm/use-vendors";
import { BillToChoice, VendorBilledBadge } from "@/components/service/bill-to-picker";
import { listPurchaseOrders } from "@/lib/service-pos.functions";
import { fieldKeys } from "@/components/service/field-utils";
import { InvoicePhotos } from "@/components/service/invoice-photos";
import { PdfPages } from "@/components/service/pdf-pages";
import { showChoice, showFlags, type ShowChoice } from "@/lib/invoice-pdf-rows";
import {
  createAnotherInvoice,
  finalizeInvoice,
  getInvoice,
  getServiceRates,
  listTicketInvoices,
  markInvoicePaid,
  rebuildInvoiceLines,
  renderInvoice,
  saveInvoice,
  sendInvoice,
  voidInvoice,
  type InvoiceLineRow,
  type InvoiceRow,
  type InvoiceSaveInput,
  type InvoiceStatus,
  type InvoiceWithLines,
} from "@/lib/invoices.functions";
import { getServiceJob, type ServiceJobWithTech } from "@/lib/service.functions";
import {
  asInvoiceStatus,
  deleteDraftNote,
  downloadBlob,
  errText,
  fromPct,
  invoiceKey,
  invoicePageKey,
  isEmail,
  money,
  PAYMENT_METHODS,
  pdfBlob,
  r2,
  shortDay,
  splitEmails,
  stampDay,
  STATUS_CLASS,
  STATUS_LABELS,
  ticketInvoicesKey,
  todayYmd,
  toPct,
  toYmd,
} from "@/components/service/invoice-utils";
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
import { NumberField } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** An invoice made before 20261006150000_invoice_markup.sql had the markup of the day: 75 %. */
const DEFAULT_MARKUP = 0.75;
const LINE_KINDS = ["travel", "labor", "material", "other"] as const;
type LineKind = (typeof LINE_KINDS)[number];
const asKind = (s: string): LineKind =>
  (LINE_KINDS as readonly string[]).includes(s) ? (s as LineKind) : "other";
const KIND_LABELS: Record<LineKind, string> = {
  travel: "Travel",
  labor: "Labor",
  material: "Material",
  other: "Other",
};
const KIND_CLASS: Record<LineKind, string> = {
  travel: "border-sky-300 text-sky-800 dark:border-sky-800 dark:text-sky-200",
  labor: "border-violet-300 text-violet-800 dark:border-violet-800 dark:text-violet-200",
  material: "border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-200",
  other: "border-border text-muted-foreground",
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  const s = asInvoiceStatus(status);
  return (
    <Badge variant="outline" className={`px-1.5 py-0 text-[11px] ${STATUS_CLASS[s]}`}>
      {STATUS_LABELS[s]}
    </Badge>
  );
}

function KindBadge({ kind }: { kind: LineKind }) {
  return (
    <Badge variant="outline" className={`px-1.5 py-0 text-[11px] font-medium ${KIND_CLASS[kind]}`}>
      {KIND_LABELS[kind]}
    </Badge>
  );
}

/** Everything the editor needs to report a changed invoice back to the page. */
interface Ctx {
  job: ServiceJobWithTech;
  /** Put the server's answer in the cache; `stageChanged` also refreshes the ticket. */
  applied: (r: InvoiceWithLines, stageChanged?: boolean) => void;
  /** After a failed step that saved first: show what the server now holds. */
  refresh: () => void;
  onVoided: (voidedId: string) => void;
}

// ---- The page -------------------------------------------------------------------------------

/** `/service/invoices?id=<uuid>`: one invoice, full width (rendered by the Invoices page). */
export function InvoiceEditorPage({ id }: { id: string }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const oneFn = useServerFn(getInvoice);
  const jobFn = useServerFn(getServiceJob);
  const listFn = useServerFn(listTicketInvoices);
  const anotherFn = useServerFn(createAnotherInvoice);

  const q = useQuery({
    queryKey: invoicePageKey(id),
    queryFn: () => oneFn({ data: { id } }),
    enabled: !!session,
    retry: 1,
  });
  const jobId = q.data?.invoice.service_job_id ?? null;
  // The same cache as the ticket page.
  const jobQ = useQuery({
    queryKey: ["service-job", jobId],
    queryFn: () => jobFn({ data: { id: jobId! } }),
    enabled: !!session && !!jobId,
  });
  const all = useQuery({
    queryKey: ticketInvoicesKey(jobId ?? ""),
    queryFn: () => listFn({ data: { job_id: jobId! } }),
    enabled: !!session && !!jobId,
  });

  const refreshTicket = (jid: string) => {
    void qc.invalidateQueries({ queryKey: ["service-job", jid] });
    void qc.invalidateQueries({ queryKey: ["service-jobs"] });
    void qc.invalidateQueries({ queryKey: ["accounts"] });
  };
  const refreshLists = (jid: string) => {
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ticketInvoicesKey(jid) });
    void qc.invalidateQueries({ queryKey: invoiceKey(jid) });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };
  const openInvoice = (invoiceId: string, replace = false) =>
    void navigate({ to: "/service/invoices", search: { id: invoiceId }, replace });

  const another = useMutation({
    mutationFn: (jid: string) => anotherFn({ data: { job_id: jid } }),
    onSuccess: (r, jid) => {
      qc.setQueryData(invoicePageKey(r.invoice.id), r);
      refreshLists(jid);
      refreshTicket(jid);
      toast.success(`Invoice #${invoiceLabel(r.invoice)} made from the ticket`);
      openInvoice(r.invoice.id);
    },
    onError: (e) => toast.error(`Could not make another invoice: ${errText(e)}`),
  });

  const data = q.data;
  const job = jobQ.data;
  const backToList = (
    <Link
      to="/service/invoices"
      search={{}}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Invoices
    </Link>
  );
  if (q.error)
    return (
      <div className="space-y-3">
        {backToList}
        <p className="text-sm text-destructive">Could not open the invoice: {errText(q.error)}</p>
        <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
          <RefreshCw className="mr-1 h-4 w-4" /> Try again
        </Button>
      </div>
    );
  if (jobQ.error)
    return (
      <div className="space-y-3">
        {backToList}
        <p className="text-sm text-destructive">
          Could not open the invoice's ticket: {errText(jobQ.error)}
        </p>
      </div>
    );
  if (!data || !job)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the invoice…
      </p>
    );

  const ctx: Ctx = {
    job,
    applied: (r, stageChanged) => {
      qc.setQueryData(invoicePageKey(r.invoice.id), r);
      refreshLists(job.id);
      if (stageChanged) refreshTicket(job.id);
    },
    refresh: () => void qc.invalidateQueries({ queryKey: invoicePageKey(id) }),
    onVoided: (voidedId) => {
      qc.removeQueries({ queryKey: invoiceKey(job.id) });
      refreshTicket(job.id);
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      void qc
        .fetchQuery({
          queryKey: ticketInvoicesKey(job.id),
          queryFn: () => listFn({ data: { job_id: job.id } }),
          staleTime: 0,
        })
        .then((list) => {
          // A voided final invoice stays on record: keep showing it (as Void).
          if (list.some((x) => x.id === voidedId)) {
            void qc.invalidateQueries({ queryKey: invoicePageKey(voidedId) });
            return;
          }
          // A deleted draft is gone: the ticket's remaining invoice, as the card does, or the
          // ticket when none is left.
          qc.removeQueries({ queryKey: invoicePageKey(voidedId) });
          const next = remainingInvoiceAfterVoid(list, voidedId);
          if (next) openInvoice(next.id, true);
          else void navigate({ to: "/service", search: { id: job.id }, replace: true });
        })
        .catch((e: unknown) => {
          toast.error(`Could not reload this ticket's invoices: ${errText(e)}`);
          void navigate({ to: "/service", search: { id: job.id } });
        });
    },
  };

  const inv = data.invoice;
  const status = asInvoiceStatus(inv.status);
  const siblings = all.data ?? [];
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {/* Back to the Invoices list; the title opens the ticket (owner, Oct 8). */}
        {backToList}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-bold tracking-tight tabular-nums">
            <Link
              to="/service"
              search={{ id: job.id }}
              title={`Open ticket #${job.number}`}
              className="underline-offset-4 hover:underline"
            >
              Invoice #{invoiceLabel(inv)}
            </Link>
          </h1>
          <span className="text-sm text-muted-foreground">
            Ticket #{job.number}
            {job.customer_name ? ` · ${job.customer_name}` : ""}
          </span>
          <InvoiceStatusBadge status={inv.status} />
          {inv.updated_by_name && (
            <span className="text-xs text-muted-foreground">
              last changed by {inv.updated_by_name}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="sm:ml-auto"
            disabled={another.isPending}
            title={`Make another invoice for ticket #${job.number} (numbered ${job.number}.2, ${job.number}.3, …)`}
            onClick={() => another.mutate(job.id)}
          >
            {another.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            Another invoice
          </Button>
        </div>
        {siblings.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="This ticket's invoices">
            {siblings.map((x) => {
              const active = x.id === inv.id;
              return (
                <Button
                  key={x.id}
                  asChild
                  size="sm"
                  variant={active ? "secondary" : "ghost"}
                  className={`h-7 gap-1.5 px-2 text-xs ${x.status === "void" ? "text-muted-foreground line-through" : ""}`}
                >
                  <Link
                    to="/service/invoices"
                    search={{ id: x.id }}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="tabular-nums">#{x.label}</span>
                    <InvoiceStatusBadge status={x.status} />
                  </Link>
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {status === "draft" ? (
        // Remount on every server change so the edit state starts from what was saved.
        <DraftInvoice key={`${inv.id}:${inv.updated_at}`} ctx={ctx} data={data} />
      ) : (
        <FinalInvoice key={inv.id} ctx={ctx} data={data} />
      )}
      {/* Which of the ticket's photos (with their marks) print on this invoice (owner, Oct 1). */}
      <InvoicePhotos invoiceId={inv.id} ticketNumber={job.number} editable={status === "draft"} />
      <AuditHistory entity="invoice" entityId={data.invoice.id} />
    </div>
  );
}

// ---- Draft ----------------------------------------------------------------------------------

interface LineDraft {
  key: string;
  kind: LineKind;
  description: string;
  /** null = the box is blank (a new line starts so; owner: number boxes start blank). */
  qty: number | null;
  unit: string;
  rate: number | null;
  cost_rate: number;
  on_date: string | null;
  taxable: boolean;
  source: string | null;
  /** The saved line's rate and cost per unit (null on a new line): rescaleCost's base. */
  orig: { rate: number; cost_rate: number } | null;
  /**
   * The rate was typed by hand on a ticket line (owner, Oct 6): a markup change and Rebuild
   * from ticket leave it alone. Set when the Rate box is edited, cleared when a markup change
   * re-prices the line; saved with the line. A line saved before the column existed has none
   * (undefined at run time): applyMarkup then falls back to its ratio test.
   */
  rate_overridden: boolean;
  /** Listed on its own on the customer's PDF (owner, Oct 8); off = in the one summary row. */
  show_on_invoice: boolean;
  /** Listed without its rate and amount (owner, Oct 8); with show_on_invoice, "No price". */
  hide_price: boolean;
}
interface HeadDraft {
  invoice_date: string;
  due_date: string;
  po_number: string;
  job_code: string;
  description: string;
  payment_terms: string;
  /** Percent, e.g. 7.5. */
  tax_pct: number;
  /**
   * This invoice's material markup, percent (owner, Oct 6: "change prices and markups per
   * invoice"); starts at Setup › Material pricing's.
   */
  markup_pct: number;
  /** Bill to: a vendor's id, or null for the customer account. */
  bill_to_vendor_id: string | null;
  /** The Send To printed on this invoice only (owner, Oct 8). */
  send_to: SendTo;
}
let lineSeq = 0;
const lineFrom = (l: InvoiceLineRow): LineDraft => ({
  key: `l${l.id}`,
  kind: asKind(l.kind),
  description: l.description,
  qty: Number(l.qty),
  unit: l.unit,
  rate: Number(l.rate),
  cost_rate: Number(l.cost_rate),
  on_date: l.on_date,
  taxable: l.taxable,
  source: l.source,
  orig: { rate: Number(l.rate), cost_rate: Number(l.cost_rate) },
  rate_overridden: l.rate_overridden,
  // Missing before 20261008151500 is applied: off, as the column's default.
  show_on_invoice: l.show_on_invoice === true,
  hide_price: l.hide_price === true,
});
const headFrom = (inv: InvoiceRow): HeadDraft => ({
  invoice_date: inv.invoice_date,
  due_date: inv.due_date ?? "",
  po_number: inv.po_number ?? "",
  job_code: inv.job_code ?? "",
  description: inv.description ?? "",
  payment_terms: inv.payment_terms ?? "",
  tax_pct: toPct(inv.tax_rate),
  markup_pct: toPct(inv.material_markup ?? DEFAULT_MARKUP),
  bill_to_vendor_id: inv.bill_to_vendor_id ?? null,
  send_to: sendToOf(inv.bill_to as Record<string, unknown> | null),
});
const editKey = (h: HeadDraft, lines: LineDraft[]) =>
  JSON.stringify([h, lines.map(({ key: _k, ...rest }) => rest)]);

/**
 * A number box that can be blank (null): a new line's quantity and rate start empty, and a
 * line is not saved until both are filled in. Keeps its own text while focused so a partial
 * "-" or "1." can be typed.
 */
function OptionalNumber(props: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  step: string;
  min?: number;
  invalid?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const min = props.min ?? 0;
  const display = text ?? (props.value === null ? "" : String(props.value));
  return (
    <Input
      type="number"
      inputMode="decimal"
      step={props.step}
      min={min}
      aria-label={props.label}
      aria-invalid={props.invalid || undefined}
      className={`text-right ${props.invalid ? "border-destructive" : ""}`}
      value={display}
      onFocus={(e) => {
        setText(display);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const t = raw.trim();
        if (t === "") {
          props.onChange(null);
          return;
        }
        const n = Number(t);
        if (!Number.isFinite(n)) return;
        props.onChange(Math.max(min, n));
      }}
      onBlur={() => setText(null)}
    />
  );
}

/** The line table's columns on a wide screen; below lg each line is a small card. */
const LINE_COLS =
  "lg:grid lg:grid-cols-[112px_minmax(220px,1fr)_88px_76px_112px_56px_120px_112px_36px] lg:items-start lg:gap-2";
/** The same with a Cost column after Rate, for the office (managesTickets; owner, Oct 8). */
const LINE_COLS_COST =
  "lg:grid lg:grid-cols-[112px_minmax(200px,1fr)_88px_76px_112px_112px_56px_120px_112px_36px] lg:items-start lg:gap-2";

/** A label above a line's box on a phone (the table header carries it on a wide screen). */
function CellLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-xs text-muted-foreground lg:hidden">{children}</span>;
}

function DraftInvoice({ ctx, data }: { ctx: Ctx; data: InvoiceWithLines }) {
  const { job } = ctx;
  const inv = data.invoice;
  const no = invoiceLabel(inv);
  // The office (admins, managers) sees and types each line's cost (owner, Oct 8).
  const { profile } = useAuth();
  const internal = managesTickets(profile);
  const deleteFn = useServerFn(voidInvoice);
  const saveFn = useServerFn(saveInvoice);
  const rebuildFn = useServerFn(rebuildInvoiceLines);
  const renderFn = useServerFn(renderInvoice);
  const finalizeFn = useServerFn(finalizeInvoice);
  const sendFn = useServerFn(sendInvoice);

  const [head, setHead] = useState<HeadDraft>(() => headFrom(inv));
  const [lines, setLines] = useState<LineDraft[]>(() => data.lines.map(lineFrom));
  const savedKey = useMemo(() => editKey(headFrom(inv), data.lines.map(lineFrom)), [inv, data]);
  const dirty = editKey(head, lines) !== savedKey;
  const setH = <K extends keyof HeadDraft>(k: K, v: HeadDraft[K]) =>
    setHead((h) => ({ ...h, [k]: v }));
  const setLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // A ticket material line's qty / unit / rate edited by hand: its (hidden) cost per unit
        // moves with the rate, so Cost and Margin stay truthful (owner, Oct 1: the $273).
        if (l.orig && ("qty" in patch || "unit" in patch || "rate" in patch))
          next.cost_rate = rescaleCost({ source: l.source, ...l.orig }, next.rate);
        // A rate typed on a ticket's line (material, labor, travel) is the office's from here
        // on: a markup change and Rebuild from ticket keep it (owner, Oct 6).
        if ("rate" in patch && l.source) next.rate_overridden = true;
        // A cost typed by the office is theirs: Rebuild from ticket keeps the line as typed,
        // and a later price edit scales from this cost (owner, Oct 8).
        if ("cost_rate" in patch) {
          if (l.source) next.rate_overridden = true;
          next.orig = { rate: next.rate ?? 0, cost_rate: next.cost_rate };
        }
        return next;
      }),
    );
  // The markup changed: the ticket's material lines that follow the markup are re-priced (a
  // price typed by hand, rate_overridden, stays); their new rate is the base for a later hand
  // edit.
  const setMarkup = (pct: number) => {
    const before = fromPct(head.markup_pct);
    setH("markup_pct", pct);
    setLines((ls) =>
      applyMarkup(ls, before, fromPct(pct)).map((l, i) =>
        l === ls[i] || l.rate === null
          ? l
          : { ...l, orig: { rate: l.rate, cost_rate: l.cost_rate } },
      ),
    );
  };
  const [newKey, setNewKey] = useState<string | null>(null);

  const [busy, setBusy] = useState<
    null | "save" | "rebuild" | "preview" | "final" | "send" | "delete"
  >(null);
  const [confirm, setConfirm] = useState<null | "rebuild" | "final" | "delete">(null);
  const [sendOpen, setSendOpen] = useState(false);

  const account = useAccount(job.account_id);
  // Still the day the draft was made (the database's UTC day or the local one): not chosen.
  const dateUntouched = (ymd: string) =>
    ymd === toYmd(new Date(inv.created_at)) || ymd === inv.created_at.slice(0, 10);
  const taxExempt = !!account?.tax_exempt;
  const po = useApprovedPoCost(job.id, inv.id);
  const t = computeTotals(lines, fromPct(head.tax_pct), po.cost);
  // Bill to changed here and not saved yet: show whom it will be billed to.
  const vendors = useVendors();
  const pickedVendor = vendors.data?.find((v) => v.id === head.bill_to_vendor_id) ?? null;
  const billPreview: BillToSnapshot | null =
    head.bill_to_vendor_id === (inv.bill_to_vendor_id ?? null)
      ? null
      : head.bill_to_vendor_id
        ? pickedVendor && vendorBillTo(pickedVendor)
        : accountBillTo(account, job.customer_name);

  /** The save payload, or an error message when a line is incomplete. */
  const payload = (forFinal: boolean): InvoiceSaveInput | string => {
    for (const [i, l] of lines.entries()) {
      if (!l.description.trim()) return `Line ${i + 1} needs a description`;
      if (l.qty === null || l.rate === null) return `Line ${i + 1} needs a quantity and a rate`;
    }
    // §4: the invoice date is the day it is finalised — unless the office changed it.
    const untouched = dateUntouched(head.invoice_date);
    const invoice_date =
      forFinal && untouched && head.invoice_date < todayYmd() ? todayYmd() : head.invoice_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice_date)) return "Set the invoice date";
    return {
      id: inv.id,
      invoice_date,
      due_date: head.due_date || null,
      po_number: head.po_number.trim() || null,
      job_code: head.job_code.trim() || null,
      description: head.description.trim() || null,
      payment_terms: head.payment_terms.trim() || null,
      tax_rate: fromPct(head.tax_pct),
      material_markup: fromPct(head.markup_pct),
      bill_to_vendor_id: head.bill_to_vendor_id,
      // Sent only when edited, and not while Bill To is being switched (a new copy is taken).
      ...(!billPreview && sendToEdited(inv.bill_to as Record<string, unknown>, head.send_to)
        ? { send_to: head.send_to }
        : {}),
      lines: lines.map((l) => ({
        // A saved line's id (its key is "l<id>"); new lines have none. The audit log uses it.
        ...(l.key.startsWith("l") ? { id: Number(l.key.slice(1)) } : {}),
        kind: l.kind,
        description: l.description.trim(),
        qty: l.qty ?? 0,
        unit: l.unit.trim() || "ea",
        rate: l.rate ?? 0,
        cost_rate: l.cost_rate,
        on_date: l.on_date,
        taxable: l.taxable,
        source: l.source,
        rate_overridden: l.rate_overridden,
        show_on_invoice: l.show_on_invoice,
        hide_price: l.hide_price,
      })),
    };
  };
  /** Save when there is anything to save; returns the saved invoice (or null when unchanged). */
  const saveIfNeeded = async (forFinal: boolean): Promise<InvoiceWithLines | null> => {
    const p = payload(forFinal);
    if (typeof p === "string") throw new Error(p);
    if (!dirty && p.invoice_date === inv.invoice_date) return null;
    return saveFn({ data: p });
  };
  /** Toast what is missing (e.g. "Line 2 needs a quantity and a rate"); true when complete. */
  const complete = (forFinal: boolean, needLines: boolean) => {
    const p = payload(forFinal);
    if (typeof p === "string") {
      toast.error(p);
      return false;
    }
    if (needLines && !lines.length) {
      toast.error("The invoice has no lines");
      return false;
    }
    return true;
  };
  const run = async (
    kind: NonNullable<typeof busy>,
    what: string,
    fn: () => Promise<void>,
    savedFirst = false,
  ) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(`${what}: ${errText(e)}`);
      // A save that went through before the failing step: show what the server now holds.
      if (savedFirst) ctx.refresh();
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    if (!complete(false, false)) return;
    void run("save", "Could not save the invoice", async () => {
      const r = await saveIfNeeded(false);
      if (r) ctx.applied(r);
      toast.success(`Invoice #${no} saved`);
    });
  };
  const rebuild = () =>
    run("rebuild", "Could not rebuild the invoice", async () => {
      const r = await rebuildFn({ data: { id: inv.id } });
      setConfirm(null);
      ctx.applied(r);
      toast.success(
        `Rebuilt from the ticket: ${r.lines.length} line${r.lines.length === 1 ? "" : "s"}`,
      );
    });
  // Owner (Oct 1): the preview opens in the page, not a new tab — a blob: page in a new tab
  // was "blocked by Chrome" (ERR_BLOCKED_BY_CLIENT, an extension) on the owner's machine.
  const [pdfView, setPdfView] = useState<PdfView | null>(null);
  const preview = () => {
    if (!complete(false, false)) return;
    void run(
      "preview",
      "Could not make the PDF",
      async () => {
        const saved = await saveIfNeeded(false);
        const pdf = await renderFn({ data: { id: inv.id } });
        setPdfView({ blob: pdfBlob(pdf.base64), fileName: pdf.file_name });
        if (saved) ctx.applied(saved);
      },
      dirty,
    );
  };
  const finalise = () =>
    run(
      "final",
      "Could not finalise the invoice",
      async () => {
        await saveIfNeeded(true);
        const r = await finalizeFn({ data: { id: inv.id } });
        setConfirm(null);
        ctx.applied(r, true);
        toast.success(`Invoice #${invoiceLabel(r.invoice)} is final; the ticket is Invoiced`);
      },
      true,
    );
  const send = (to: string[], message: string) =>
    run(
      "send",
      "Could not send the invoice",
      async () => {
        await saveIfNeeded(true);
        const r = await sendFn({ data: { id: inv.id, to, ...(message ? { message } : {}) } });
        setSendOpen(false);
        ctx.applied(r, true);
        toast.success(`Invoice #${invoiceLabel(r.invoice)} sent to ${to.join(", ")}`);
      },
      true,
    );
  const removeDraft = () =>
    run("delete", "Could not delete the draft", async () => {
      await deleteFn({ data: { id: inv.id } });
      setConfirm(null);
      toast.success(`Draft invoice #${no} deleted; its number is free for the next invoice`);
      ctx.onVoided(inv.id);
    });

  const addLine = () => {
    const key = `n${++lineSeq}`;
    // Quantity and rate start blank (owner: number boxes start blank, not 1 / 0).
    setLines((ls) => [
      ...ls,
      {
        key,
        kind: "other",
        description: "",
        qty: null,
        unit: "ea",
        rate: null,
        cost_rate: 0,
        on_date: null,
        taxable: true,
        source: null,
        orig: null,
        rate_overridden: false,
        show_on_invoice: false,
        hide_price: false,
      },
    ]);
    setNewKey(key);
  };
  const tryFinal = () => {
    if (complete(true, true)) setConfirm("final");
  };
  const trySend = () => {
    if (complete(true, true)) setSendOpen(true);
  };

  return (
    <div className="space-y-5">
      <BillTo
        inv={inv}
        draft={{
          vendorId: head.bill_to_vendor_id,
          onChange: (v) => setH("bill_to_vendor_id", v),
          preview: billPreview,
          customerName: job.customer_name,
          sendTo: head.send_to,
          onSendTo: (s) => setH("send_to", s),
        }}
      />

      {/* Header fields across the top */}
      <div className="space-y-3 rounded-lg border p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="inv-date" className="text-xs">
              Date
            </Label>
            <Input
              id="inv-date"
              type="date"
              value={head.invoice_date}
              onChange={(e) => setH("invoice_date", e.target.value)}
            />
            {dateUntouched(head.invoice_date) && head.invoice_date < todayYmd() && (
              <p className="text-xs text-muted-foreground">
                Becomes the day it is finalised unless you change it.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-due" className="text-xs">
              Due date
            </Label>
            <Input
              id="inv-due"
              type="date"
              value={head.due_date}
              onChange={(e) => setH("due_date", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-po" className="text-xs">
              PO #
            </Label>
            <Input
              id="inv-po"
              value={head.po_number}
              maxLength={60}
              onChange={(e) => setH("po_number", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-job" className="text-xs">
              Job #
            </Label>
            <Input
              id="inv-job"
              value={head.job_code}
              maxLength={60}
              onChange={(e) => setH("job_code", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-terms" className="text-xs">
              Payment terms
            </Label>
            <Input
              id="inv-terms"
              value={head.payment_terms}
              maxLength={500}
              onChange={(e) => setH("payment_terms", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tax rate %</Label>
            <NumberField
              value={head.tax_pct}
              max={100}
              step="0.01"
              inputMode="decimal"
              onChange={(v) => setH("tax_pct", v)}
            />
            {taxExempt && head.tax_pct === 0 && (
              <p className="text-xs text-muted-foreground">Customer is tax exempt</p>
            )}
            {taxExempt && head.tax_pct > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                The customer is marked tax exempt
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Material markup %</Label>
            <NumberField
              value={head.markup_pct}
              max={1000}
              step="0.1"
              inputMode="decimal"
              onChange={setMarkup}
            />
            <p className="text-xs text-muted-foreground">
              For this invoice: the ticket&apos;s material lines are priced again; a price typed by
              hand stays.
            </p>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-description" className="text-xs">
            Description
          </Label>
          <Textarea
            id="inv-description"
            rows={4}
            value={head.description}
            maxLength={10000}
            placeholder="The work done, as the customer reads it on page 1"
            onChange={(e) => setH("description", e.target.value)}
          />
        </div>
      </div>

      {/* The lines, with the totals in a summary box on the right */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
        <section className="min-w-0 space-y-2" aria-label="Lines">
          <h2 className="text-sm font-semibold">Lines</h2>
          <div
            className={`hidden border-b pb-1.5 text-xs font-medium text-muted-foreground ${internal ? LINE_COLS_COST : LINE_COLS}`}
          >
            <span>Kind</span>
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span>Unit</span>
            <span className="text-right">Rate</span>
            {internal && <span className="text-right">Cost</span>}
            <span className="text-center">Taxable</span>
            <span>On the invoice</span>
            <span className="text-right">Total</span>
            <span className="sr-only">Remove</span>
          </div>
          {lines.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No lines. The ticket has no time or material yet: add a line, or record the time in
              Close out and rebuild from the ticket.
            </p>
          )}
          <div className="space-y-2 lg:space-y-0">
            {lines.map((l, i) => (
              <div
                key={l.key}
                className={`grid grid-cols-2 gap-2 rounded-md border p-3 lg:rounded-none lg:border-0 lg:border-b lg:px-0 lg:py-1.5 ${internal ? LINE_COLS_COST : LINE_COLS}`}
              >
                <div className="order-first lg:order-none">
                  <CellLabel>Kind</CellLabel>
                  {l.source ? (
                    <div className="flex h-9 items-center">
                      <KindBadge kind={l.kind} />
                    </div>
                  ) : (
                    <Select
                      value={l.kind}
                      onValueChange={(v) => setLine(l.key, { kind: asKind(v) })}
                    >
                      <SelectTrigger className="h-9 w-full" aria-label={`Line ${i + 1} kind`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LINE_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {KIND_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="col-span-2 lg:col-span-1">
                  <CellLabel>Description</CellLabel>
                  <Input
                    value={l.description}
                    maxLength={300}
                    autoFocus={l.key === newKey}
                    aria-label={`Line ${i + 1} description`}
                    className={l.description.trim() ? "" : "border-destructive"}
                    onChange={(e) => setLine(l.key, { description: e.target.value })}
                  />
                  {l.on_date && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {shortDay(l.on_date)}
                    </span>
                  )}
                </div>
                <div>
                  <CellLabel>Qty</CellLabel>
                  <OptionalNumber
                    value={l.qty}
                    step="0.25"
                    label={`Line ${i + 1} quantity`}
                    invalid={l.qty === null}
                    onChange={(v) => setLine(l.key, { qty: v })}
                  />
                </div>
                <div>
                  <CellLabel>Unit</CellLabel>
                  <Input
                    value={l.unit}
                    maxLength={20}
                    aria-label={`Line ${i + 1} unit`}
                    onChange={(e) => setLine(l.key, { unit: e.target.value })}
                  />
                </div>
                <div>
                  <CellLabel>Rate</CellLabel>
                  <OptionalNumber
                    value={l.rate}
                    min={-1_000_000}
                    step="0.01"
                    label={`Line ${i + 1} rate`}
                    invalid={l.rate === null}
                    onChange={(v) => setLine(l.key, { rate: v })}
                  />
                </div>
                {internal && (
                  <div>
                    <CellLabel>Cost</CellLabel>
                    <OptionalNumber
                      value={l.cost_rate}
                      step="0.01"
                      label={`Line ${i + 1} cost`}
                      onChange={(v) => setLine(l.key, { cost_rate: v ?? 0 })}
                    />
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm lg:h-9 lg:justify-center">
                  <Checkbox
                    checked={l.taxable}
                    aria-label={`Line ${i + 1} taxable`}
                    onCheckedChange={(c) => setLine(l.key, { taxable: c === true })}
                  />
                  <span className="lg:hidden">Taxable</span>
                </label>
                {/* On the customer's PDF (owner, Oct 8): Hidden (in the one Services and
                    materials amount), No price (listed with its quantity), With price. */}
                <div>
                  <CellLabel>On the invoice</CellLabel>
                  <Select
                    value={showChoice(l)}
                    onValueChange={(v) => setLine(l.key, showFlags(v as ShowChoice))}
                  >
                    <SelectTrigger
                      className="h-9 w-full"
                      aria-label={`Line ${i + 1} on the invoice`}
                      title="Hidden: in the one Services and materials amount. No price: listed with its quantity. With price: listed with rate and amount."
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hidden">Hidden</SelectItem>
                      <SelectItem value="no_price">No price</SelectItem>
                      <SelectItem value="priced">With price</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-2 lg:block lg:h-9 lg:pt-2 lg:text-right">
                  <span className="text-xs text-muted-foreground lg:hidden">Total</span>
                  <span className="tabular-nums">{money(r2((l.qty ?? 0) * (l.rate ?? 0)))}</span>
                </div>
                <div className="order-first flex justify-end lg:order-none">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-destructive hover:text-destructive"
                    aria-label={`Remove line ${i + 1}`}
                    title="Remove this line"
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full border-dashed"
            disabled={!!busy}
            onClick={addLine}
          >
            <Plus className="mr-1 h-4 w-4" /> Add line
          </Button>
        </section>
        <div className="xl:sticky xl:top-4">
          <Totals t={t} taxPct={head.tax_pct} poError={po.error} poCountedOn={po.countedOn} />
        </div>
      </div>

      {/* Actions along the bottom */}
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button type="button" disabled={!!busy || !dirty} onClick={save}>
          {busy === "save" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!!busy}
          onClick={() => setConfirm("rebuild")}
          title="Throw away these lines and build them again from the ticket's time and materials"
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Rebuild from ticket
        </Button>
        <Button type="button" variant="outline" disabled={!!busy} onClick={preview}>
          {busy === "preview" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Eye className="mr-2 h-4 w-4" />
          )}
          Preview PDF
        </Button>
        <Button type="button" variant="outline" disabled={!!busy} onClick={tryFinal}>
          <FileCheck2 className="mr-2 h-4 w-4" /> Finalise
        </Button>
        <Button type="button" disabled={!!busy} onClick={trySend}>
          <Send className="mr-2 h-4 w-4" /> Finalise &amp; send
        </Button>
        {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
        <Button
          type="button"
          variant="ghost"
          className="ml-auto text-destructive hover:text-destructive"
          disabled={!!busy}
          onClick={() => setConfirm("delete")}
        >
          <Trash2 className="mr-2 h-4 w-4" /> Delete draft
        </Button>
      </div>

      <PdfPreviewDialog view={pdfView} onClose={() => setPdfView(null)} />
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "rebuild"
                ? "Rebuild the lines from the ticket?"
                : confirm === "delete"
                  ? `Delete draft invoice #${no}?`
                  : `Finalise invoice #${no}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "rebuild"
                ? "The lines are built again from the ticket's time entries and materials at today's rates: correct hours and quantities on the ticket (its Time and Materials), then rebuild. Lines you added here and prices you changed here stay; the header and description stay too."
                : confirm === "delete"
                  ? deleteDraftNote(job.number, no)
                  : `The invoice is frozen at ${money(t.total)} and its PDF stored; the ticket moves to Invoiced. To change it afterwards, void it.`}
              {confirm === "final" && dirty ? " Your unsaved changes are saved first." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!busy}
              onClick={(e) => {
                e.preventDefault();
                void (confirm === "rebuild"
                  ? rebuild()
                  : confirm === "delete"
                    ? removeDraft()
                    : finalise());
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {confirm === "rebuild" ? "Rebuild" : confirm === "delete" ? "Delete" : "Finalise"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {sendOpen && (
        <SendDialog
          title={`Finalise & send invoice #${no}`}
          note="The invoice is finalised (the ticket moves to Invoiced) and the PDF emailed."
          inv={inv}
          accountId={job.account_id}
          vendorId={head.bill_to_vendor_id}
          busy={busy === "send"}
          onClose={() => setSendOpen(false)}
          onSend={(to, message) => void send(to, message)}
        />
      )}
    </div>
  );
}

function useAccount(accountId: string | null) {
  const { session } = useAuth();
  const getFn = useServerFn(getAccount);
  const q = useQuery({
    queryKey: ["account", accountId],
    queryFn: () => getFn({ data: { id: accountId! } }),
    enabled: !!session && !!accountId,
  });
  return q.data?.account ?? null;
}

/**
 * Send to / Property. On a draft, the Bill to choice above it (the customer account or a
 * billable vendor); the block shows whoever is picked (`preview` until it is saved).
 */
function BillTo({
  inv,
  draft,
}: {
  inv: InvoiceRow;
  draft?: {
    vendorId: string | null;
    onChange: (vendorId: string | null) => void;
    /** Whom it will be billed to once saved (null = as saved). */
    preview: BillToSnapshot | null;
    customerName: string | null;
    /** The Send To boxes (this invoice only); editable while Bill To is as saved. */
    sendTo: SendTo;
    onSendTo: (s: SendTo) => void;
  };
}) {
  const b = (draft?.preview ?? inv.bill_to ?? {}) as Record<string, string | undefined>;
  const p = (inv.property ?? {}) as Record<string, string | undefined>;
  const cityLine = [b["city"], [b["state"], b["zip"]].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const savedName = (inv.bill_to as { name?: string } | null)?.name ?? null;
  const toVendor = draft ? !!draft.vendorId : !!inv.bill_to_vendor_id;
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <div>
        {draft && (
          <div className="mb-3 space-y-1">
            <p className="text-xs text-muted-foreground">Bill to</p>
            <BillToChoice
              id="inv-bill-to"
              vendorId={draft.vendorId}
              onChange={draft.onChange}
              customerName={draft.customerName}
              fallbackName={draft.vendorId === inv.bill_to_vendor_id ? savedName : null}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">Send to</p>
        {toVendor && (
          <div className="my-1">
            <VendorBilledBadge name={b["name"]} />
          </div>
        )}
        {draft && !draft.preview ? (
          <SendToBoxes value={draft.sendTo} onChange={draft.onSendTo} />
        ) : (
          <>
            <p className="font-medium">{b["name"] || "—"}</p>
            {[b["address1"], b["address2"], cityLine].filter(Boolean).map((x) => (
              <p key={x} className="text-muted-foreground">
                {x}
              </p>
            ))}
          </>
        )}
        {b["instructions"] && (
          <p className="whitespace-pre-line text-xs text-amber-700 dark:text-amber-400">
            Billing: {b["instructions"]}
          </p>
        )}
        {draft?.preview && (
          <p className="mt-1 text-xs text-muted-foreground">
            Saved with the invoice. Save first to change the Send To for this invoice.
          </p>
        )}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Property</p>
        <p className="font-medium">{p["name"] || "—"}</p>
        {p["address"] && <p className="text-muted-foreground">{p["address"]}</p>}
      </div>
    </div>
  );
}

/**
 * The Send To's six printed lines as boxes on a draft (owner, Oct 8: "editable on one invoice
 * only like centerpoint"). They change this invoice's copy only.
 */
function SendToBoxes({ value, onChange }: { value: SendTo; onChange: (s: SendTo) => void }) {
  const set = (k: keyof SendTo) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="mt-1 space-y-2">
      <SendToBox label="Name" value={value.name} onChange={set("name")} />
      <SendToBox label="Address" value={value.address1} onChange={set("address1")} />
      <SendToBox label="Address line 2" value={value.address2} onChange={set("address2")} />
      <div className="grid grid-cols-[1fr_72px_96px] gap-2">
        <SendToBox label="City" value={value.city} onChange={set("city")} />
        <SendToBox label="State" value={value.state} onChange={set("state")} />
        <SendToBox label="ZIP" value={value.zip} onChange={set("zip")} />
      </div>
      <p className="text-xs text-muted-foreground">
        Prints on this invoice only; the customer's record is not changed.
      </p>
    </div>
  );
}

function SendToBox(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-0.5 text-xs text-muted-foreground">
      <span>{props.label}</span>
      <Input
        value={props.value}
        className="h-8 text-sm text-foreground"
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

type PdfView = { blob: Blob; fileName: string };

/**
 * The PDF in the page (owner, Oct 1: a new tab was blocked by a browser extension): its pages
 * drawn with pdf.js (PdfPages; Oct 8, Chrome blocked its own viewer in an <iframe> inside the
 * Lovable preview), a blob URL that lives as long as the dialog, with Download and a plain link for
 * a tab of its own. Nothing is uploaded or stored; the PDF is the server's render.
 */
function PdfPreviewDialog({ view, onClose }: { view: PdfView | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!view) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(view.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [view]);
  return (
    <Dialog open={!!view} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[92vh] max-w-[min(96vw,1100px)] flex-col gap-3 p-4">
        <DialogHeader className="shrink-0">
          <DialogTitle>{view?.fileName ?? "Invoice PDF"}</DialogTitle>
          <DialogDescription>
            What the customer receives. Download it, or open it in a tab of its own.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {/* Drawn with pdf.js: Chrome blocks its own PDF viewer in a sandboxed frame (the
              Lovable preview; owner, Oct 8). */}
          {view && <PdfPages blob={view.blob} title={view.fileName} />}
        </div>
        <DialogFooter className="shrink-0 gap-2 sm:justify-between">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Open in a new tab
            </a>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => view && downloadBlob(view.blob, view.fileName)}
            >
              <Download className="mr-2 h-4 w-4" /> Download
            </Button>
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const INTERNAL_OPEN_KEY = "invoiceInternalOpen";

/**
 * This invoice's share of the ticket's approved purchase-order total (purchase-orders.ts): an
 * internal cost, read for admins and managers only (the Internal fold is theirs). Never an
 * invoice line or on the PDF. Each approved PO counts on one invoice of the ticket, its earliest
 * live one (invoice-totals.ts poCostForInvoice); the others carry $0 and name it (`countedOn`).
 * The ticket's invoices come from the same cache as the ticket's invoice block and this page.
 */
function useApprovedPoCost(
  jobId: string,
  invoiceId: string,
): { cost: number; countedOn: string | null; error: unknown } {
  const { session, profile } = useAuth();
  const listFn = useServerFn(listPurchaseOrders);
  const invoicesFn = useServerFn(listTicketInvoices);
  const enabled = !!session && managesTickets(profile);
  const q = useQuery({
    queryKey: fieldKeys.pos(jobId),
    queryFn: () => listFn({ data: { jobId } }),
    enabled,
  });
  const invoices = useQuery({
    queryKey: ticketInvoicesKey(jobId),
    queryFn: () => invoicesFn({ data: { job_id: jobId } }),
    enabled,
  });
  // Until both are read nothing is added: never the whole total on every invoice "for now".
  if (!q.data || !invoices.data)
    return { cost: 0, countedOn: null, error: q.error ?? invoices.error };
  return {
    ...poCostForInvoice(invoiceId, invoices.data, approvedPoTotal(q.data.pos)),
    error: null,
  };
}

function Totals({
  t,
  taxPct,
  poError,
  poCountedOn,
}: {
  t: InvoiceTotals;
  taxPct: number;
  /** The purchase orders could not be read: Cost and Margin leave them out, and say so. */
  poError?: unknown;
  /** The ticket's approved POs are counted on that other invoice ("6000"); $0 here. */
  poCountedOn?: string | null;
}) {
  const { profile } = useAuth();
  // Cost and margin are internal (owner, Oct 1: the invoice goes out to a customer): folded,
  // closed by default, and only for admins and managers.
  const internal = managesTickets(profile);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(INTERNAL_OPEN_KEY) === "1") setOpen(true);
    } catch {
      /* storage blocked: stays closed */
    }
  }, []);
  const toggle = () => {
    const o = !open;
    setOpen(o);
    try {
      localStorage.setItem(INTERNAL_OPEN_KEY, o ? "1" : "0");
    } catch {
      /* storage blocked: not remembered */
    }
  };
  const hrs = Number(t.hours.toFixed(2));
  return (
    <div className="space-y-3 self-start rounded-md border bg-muted/30 p-3 text-sm">
      <dl className="space-y-1">
        <div className="flex justify-between gap-2">
          <dt>Subtotal</dt>
          <dd className="tabular-nums">{money(t.subtotal)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Tax ({taxPct}%)</dt>
          <dd className="tabular-nums">{money(t.tax)}</dd>
        </div>
        <div className="flex justify-between gap-2 border-t pt-1 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{money(t.total)}</dd>
        </div>
      </dl>
      {internal && (
        <div className="border-t pt-2 text-xs text-muted-foreground">
          <button
            type="button"
            className="flex w-full items-center gap-1 text-left hover:text-foreground"
            aria-expanded={open}
            aria-controls="invoice-internal"
            onClick={toggle}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
            />
            Internal — cost and margin
          </button>
          {open && (
            <dl id="invoice-internal" className="mt-1.5 space-y-1">
              <div className="flex justify-between gap-2">
                <dt>
                  Purchase orders (approved)
                  {poCountedOn ? ` — counted on #${poCountedOn}` : ""}
                </dt>
                <dd className="tabular-nums">
                  {poError ? (
                    <span className="text-destructive">could not load: {errText(poError)}</span>
                  ) : (
                    money(t.po_cost)
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Cost</dt>
                <dd className="tabular-nums">{money(t.cost_total)}</dd>
              </div>
              <div
                className={`flex justify-between gap-2 font-medium ${t.margin < 0 ? "text-destructive" : "text-foreground"}`}
              >
                <dt>Margin</dt>
                <dd className="tabular-nums">{money(t.margin)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Margin / hour{hrs > 0 ? ` (${hrs} h travel + labor)` : ""}</dt>
                <dd className="tabular-nums">{t.perHour === null ? "—" : money(t.perHour)}</dd>
              </div>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Final / sent / paid / void -------------------------------------------------------------

function FinalInvoice({ ctx, data }: { ctx: Ctx; data: InvoiceWithLines }) {
  const { job } = ctx;
  const inv = data.invoice;
  const status: InvoiceStatus = asInvoiceStatus(inv.status);
  const { profile } = useAuth();
  const internal = managesTickets(profile);
  const renderFn = useServerFn(renderInvoice);
  const sendFn = useServerFn(sendInvoice);
  const paidFn = useServerFn(markInvoicePaid);
  const voidFn = useServerFn(voidInvoice);
  const account = useAccount(job.account_id);
  const [dialog, setDialog] = useState<null | "send" | "paid" | "void">(null);

  const po = useApprovedPoCost(job.id, inv.id);
  const t = computeTotals(
    data.lines.map((l) => ({
      kind: l.kind,
      qty: Number(l.qty),
      rate: Number(l.rate),
      cost_rate: Number(l.cost_rate),
      taxable: l.taxable,
    })),
    Number(inv.tax_rate),
    po.cost,
  );
  // The stored totals are the record; the live figures above feed the margin per hour, and the
  // ticket's approved purchase orders are added to the cost (internal only).
  const stored = storedTotals(inv, t);

  const download = useMutation({
    mutationFn: () => renderFn({ data: { id: inv.id } }),
    onSuccess: (r) => downloadBlob(pdfBlob(r.base64), r.file_name),
    onError: (e) => toast.error(`Could not make the PDF: ${errText(e)}`),
  });
  const send = useMutation({
    mutationFn: (v: { to: string[]; message: string }) =>
      sendFn({ data: { id: inv.id, to: v.to, ...(v.message ? { message: v.message } : {}) } }),
    onSuccess: (r, v) => {
      setDialog(null);
      ctx.applied(r);
      toast.success(`Invoice #${invoiceLabel(r.invoice)} sent to ${v.to.join(", ")}`);
    },
    onError: (e) => toast.error(`Could not send the invoice: ${errText(e)}`),
  });
  const paid = useMutation({
    mutationFn: (v: { paid_on: string; amount: number; method: string; ref: string }) =>
      paidFn({
        data: {
          id: inv.id,
          paid_on: v.paid_on,
          amount: v.amount,
          method: v.method || null,
          ref: v.ref.trim() || null,
        },
      }),
    onSuccess: (r) => {
      setDialog(null);
      ctx.applied(r, r.ticket_closed);
      // Owner, Oct 5: a manager closes the ticket by hand (its stage); paid no longer does.
      toast.success(
        `Invoice #${invoiceLabel(r.invoice)} marked paid; close the ticket from its stage when it is finished`,
      );
    },
    onError: (e) => toast.error(`Could not mark the invoice paid: ${errText(e)}`),
  });
  const voidMut = useMutation({
    mutationFn: () => voidFn({ data: { id: inv.id } }),
    onSuccess: () => {
      setDialog(null);
      toast.success(
        `Invoice #${invoiceLabel(inv)} voided; its number is free for the next invoice`,
      );
      ctx.onVoided(inv.id);
    },
    onError: (e) => toast.error(`Could not void the invoice: ${errText(e)}`),
  });

  const sentTo = Array.isArray(inv.sent_to) ? (inv.sent_to as string[]) : [];
  const facts: [string, string][] = [
    ["Date", shortDay(inv.invoice_date)],
    ...(inv.due_date ? ([["Due", shortDay(inv.due_date)]] as [string, string][]) : []),
    ["PO #", inv.po_number || "—"],
    ["Job #", inv.job_code || "—"],
    [
      "Tax rate",
      `${toPct(inv.tax_rate)}%${account?.tax_exempt && Number(inv.tax_rate) === 0 ? " (tax exempt)" : ""}`,
    ],
  ];

  return (
    <div className="space-y-4">
      {/* Only a draft is edited (owner, Oct 8: "i dont see how you can edit an invoice"). */}
      {status === "void" && (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          This invoice is void. It stays on record under its number and is left out of the Sage
          export. To bill this ticket, open it (the title above) and choose Make the invoice.
        </p>
      )}
      {(status === "final" || status === "sent") && (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          This invoice is {STATUS_LABELS[status].toLowerCase()}, so it can't be edited. To change
          it, Void it below and make a new invoice from the ticket.
        </p>
      )}
      {status === "paid" && (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          This invoice is paid, so it can't be edited. A correction goes through Sage.
        </p>
      )}
      <BillTo inv={inv} />
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Kind</th>
              <th className="py-1.5 pr-2 font-medium">Description</th>
              <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
              <th className="py-1.5 pr-2 font-medium">Unit</th>
              <th className="py-1.5 pr-2 text-right font-medium">Rate</th>
              {internal && <th className="py-1.5 pr-2 text-right font-medium">Cost</th>}
              <th className="py-1.5 pr-2 text-right font-medium">Amount</th>
              <th className="py-1.5 text-center font-medium">Tax</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="py-1.5 pr-2">
                  <KindBadge kind={asKind(l.kind)} />
                </td>
                <td className="py-1.5 pr-2">
                  {l.description}
                  {l.on_date && (
                    <span className="block text-xs text-muted-foreground">
                      {shortDay(l.on_date)}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{Number(l.qty)}</td>
                <td className="py-1.5 pr-2">{unitText(Number(l.qty), l.unit)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{rateText(l.rate)}</td>
                {internal && (
                  <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                    {rateText(l.cost_rate)}
                  </td>
                )}
                <td className="py-1.5 pr-2 text-right tabular-nums">{money(l.total)}</td>
                <td className="py-1.5 text-center">{l.taxable ? "✓" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <div className="space-y-3 text-sm">
          {inv.description && (
            <div>
              <p className="text-xs text-muted-foreground">Description</p>
              <p className="whitespace-pre-line">{inv.description}</p>
            </div>
          )}
          {inv.payment_terms && (
            <p className="text-xs text-muted-foreground">{inv.payment_terms}</p>
          )}
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {inv.finalized_at && <li>Finalised {stampDay(inv.finalized_at)}</li>}
            {inv.sent_at && (
              <li>
                Sent {stampDay(inv.sent_at)}
                {sentTo.length ? ` to ${sentTo.join(", ")}` : ""}
              </li>
            )}
            {inv.sage_exported_at && <li>Exported to Sage {stampDay(inv.sage_exported_at)}</li>}
          </ul>
          {status === "paid" && (
            <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100">
              <CircleDollarSign className="mr-1 inline h-4 w-4" />
              Paid {money(inv.paid_amount)} on {shortDay(inv.paid_on)}
              {inv.paid_method ? ` by ${inv.paid_method}` : ""}
              {inv.paid_ref ? ` · ref ${inv.paid_ref}` : ""}
            </p>
          )}
        </div>
        <Totals
          t={stored}
          taxPct={toPct(inv.tax_rate)}
          poError={po.error}
          poCountedOn={po.countedOn}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button variant="outline" disabled={download.isPending} onClick={() => download.mutate()}>
          {download.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Download PDF
        </Button>
        {status !== "void" && (
          <Button variant="outline" onClick={() => setDialog("send")}>
            <Send className="mr-2 h-4 w-4" /> {inv.sent_at ? "Send again" : "Send"}
          </Button>
        )}
        {(status === "final" || status === "sent") && (
          <Button onClick={() => setDialog("paid")}>
            <CircleDollarSign className="mr-2 h-4 w-4" /> Mark paid
          </Button>
        )}
        {status === "paid" && (
          <Button variant="outline" onClick={() => setDialog("paid")}>
            <CircleDollarSign className="mr-2 h-4 w-4" /> Edit payment
          </Button>
        )}
        {(status === "final" || status === "sent") && (
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setDialog("void")}
          >
            <Ban className="mr-2 h-4 w-4" /> Void
          </Button>
        )}
      </div>

      {dialog === "send" && (
        <SendDialog
          title={`Send invoice #${invoiceLabel(inv)}`}
          note="The final PDF is emailed again."
          inv={inv}
          accountId={job.account_id}
          vendorId={inv.bill_to_vendor_id}
          busy={send.isPending}
          onClose={() => setDialog(null)}
          onSend={(to, message) => send.mutate({ to, message })}
        />
      )}
      {dialog === "paid" && (
        <PaidDialog
          inv={inv}
          busy={paid.isPending}
          onClose={() => setDialog(null)}
          onSave={(v) => paid.mutate(v)}
        />
      )}
      <AlertDialog
        open={dialog === "void"}
        onOpenChange={(o) => {
          if (!o && !voidMut.isPending) setDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void invoice #{invoiceLabel(inv)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Use this for a mistake. The invoice stays on record as Void (it cannot be un-voided)
              and is left out of the Sage export; its number is free for the next invoice on this
              ticket. The ticket goes back to Done unless another of its invoices is still live.
              {inv.sent_at ? " The customer already has the emailed copy; let them know." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voidMut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={voidMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                voidMut.mutate();
              }}
            >
              {voidMut.isPending ? "Voiding…" : "Void"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---- Dialogs --------------------------------------------------------------------------------

function SendDialog(props: {
  title: string;
  note: string;
  inv: InvoiceRow;
  accountId: string | null;
  /** Billed to this vendor: its email is the default recipient (not the billing contacts). */
  vendorId?: string | null;
  busy: boolean;
  onClose: () => void;
  onSend: (to: string[], message: string) => void;
}) {
  const { session, profile } = useAuth();
  const contactsFn = useServerFn(listContacts);
  const ratesFn = useServerFn(getServiceRates);
  const accountId = props.accountId;
  const vendorId = props.vendorId ?? null;
  const vendorsQ = useVendors(true);
  const vendorEmail = vendorId
    ? (vendorsQ.data?.find((v) => v.id === vendorId)?.email ?? "").trim()
    : "";
  const contactsQ = useQuery({
    queryKey: ["contacts", accountId],
    queryFn: () => contactsFn({ data: { account_id: accountId! } }),
    enabled: !!session && !!accountId,
  });
  const ratesQ = useQuery({
    queryKey: ["service-rates"],
    queryFn: () => ratesFn(),
    // Service rates (the default message) are a manager's; for sales the box starts blank and
    // the server uses the default message.
    enabled: !!session && managesTickets(profile),
  });

  // Contacts with an email, billing contacts first (the server orders them so).
  const contacts = useMemo(
    () =>
      (contactsQ.data ?? [])
        .filter((c) => c.email && isEmail(c.email.trim()))
        .map((c) => ({
          email: c.email!.trim(),
          name: c.name,
          billing: c.is_billing,
          position: c.position,
        })),
    [contactsQ.data],
  );
  const [picked, setPicked] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [message, setMessage] = useState("");
  // Prefill once the contacts / settings arrive: the last recipients when it went out before,
  // else the vendor's email when it is billed to a vendor, else the billing contacts; the
  // message from Service rates.
  const pickedInit = useRef(false);
  useEffect(() => {
    if (pickedInit.current || (accountId && !contactsQ.data && !contactsQ.error)) return;
    if (vendorId && !vendorsQ.data && !vendorsQ.error) return;
    pickedInit.current = true;
    const known = new Set(contacts.map((c) => c.email.toLowerCase()));
    const last = Array.isArray(props.inv.sent_to) ? (props.inv.sent_to as string[]) : [];
    if (last.length) {
      setPicked(last.filter((e) => known.has(e.toLowerCase())));
      setExtra(last.filter((e) => !known.has(e.toLowerCase())).join(", "));
    } else if (vendorId) {
      setPicked([]);
      setExtra(isEmail(vendorEmail) ? vendorEmail : "");
    } else setPicked(contacts.filter((c) => c.billing).map((c) => c.email));
  }, [
    accountId,
    contacts,
    contactsQ.data,
    contactsQ.error,
    props.inv.sent_to,
    vendorId,
    vendorEmail,
    vendorsQ.data,
    vendorsQ.error,
  ]);
  const msgInit = useRef(false);
  useEffect(() => {
    if (msgInit.current || !ratesQ.data) return;
    msgInit.current = true;
    setMessage(ratesQ.data.settings.email_message);
  }, [ratesQ.data]);

  const typed = splitEmails(extra);
  const badTyped = typed.filter((e) => !isEmail(e));
  const to = Array.from(
    new Map([...picked, ...typed.filter(isEmail)].map((e) => [e.toLowerCase(), e])).values(),
  );
  const submit = () => {
    if (badTyped.length) {
      toast.error(`Not an email address: ${badTyped.join(", ")}`);
      return;
    }
    if (!to.length) {
      toast.error("Pick or type at least one email address");
      return;
    }
    if (to.length > 10) {
      toast.error("Send to at most 10 addresses");
      return;
    }
    props.onSend(to, message.trim());
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !props.busy) props.onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>
            {props.note} Total {money(props.inv.total)}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>To</Label>
            {!accountId ? (
              <p className="text-xs text-muted-foreground">
                The ticket is not linked to a customer profile; type the address below.
              </p>
            ) : contactsQ.error ? (
              <p className="text-xs text-destructive">
                Could not load the contacts: {errText(contactsQ.error)}
              </p>
            ) : contactsQ.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading contacts…</p>
            ) : contacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No contact on this customer has an email; type the address below (and add it to the
                customer's contacts for next time).
              </p>
            ) : (
              <ul className="space-y-1.5">
                {contacts.map((c) => {
                  const on = picked.some((p) => p.toLowerCase() === c.email.toLowerCase());
                  return (
                    <li key={c.email}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm">
                        <Checkbox
                          className="mt-0.5"
                          checked={on}
                          onCheckedChange={(v) =>
                            setPicked((ps) =>
                              v === true
                                ? [...ps, c.email]
                                : ps.filter((p) => p.toLowerCase() !== c.email.toLowerCase()),
                            )
                          }
                        />
                        <span className="min-w-0">
                          <span className="font-medium">{c.name}</span>
                          {c.billing && (
                            <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">
                              Billing
                            </Badge>
                          )}
                          <span className="block break-all text-xs text-muted-foreground">
                            {c.email}
                            {c.position ? ` · ${c.position}` : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <Input
              type="text"
              inputMode="email"
              placeholder="Other addresses, separated by commas"
              value={extra}
              className={badTyped.length ? "border-destructive" : ""}
              onChange={(e) => setExtra(e.target.value)}
            />
            {badTyped.length > 0 && (
              <p className="text-xs text-destructive">Not an email: {badTyped.join(", ")}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="send-message">Message</Label>
            <Textarea
              id="send-message"
              rows={5}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The invoice number, property, total and payment terms are added below it.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={props.busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={props.busy || to.length === 0} onClick={submit}>
            {props.busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Send{to.length ? ` to ${to.length}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaidDialog(props: {
  inv: InvoiceRow;
  busy: boolean;
  onClose: () => void;
  onSave: (v: { paid_on: string; amount: number; method: string; ref: string }) => void;
}) {
  const inv = props.inv;
  const again = asInvoiceStatus(inv.status) === "paid";
  const [paidOn, setPaidOn] = useState(again && inv.paid_on ? inv.paid_on : todayYmd());
  const [amount, setAmount] = useState(again ? Number(inv.paid_amount) : Number(inv.total));
  const [method, setMethod] = useState(inv.paid_method ?? "Check");
  const [ref, setRef] = useState(inv.paid_ref ?? "");
  const submit = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) {
      toast.error("Set the day it was paid");
      return;
    }
    props.onSave({ paid_on: paidOn, amount, method, ref });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !props.busy) props.onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {again ? "Edit the payment" : "Mark paid"} · invoice #{invoiceLabel(inv)}
          </DialogTitle>
          <DialogDescription>
            Records the payment here (Sage stays the ledger) and closes the ticket. Total{" "}
            {money(inv.total)}.
          </DialogDescription>
        </DialogHeader>
        <form
          id="paid-form"
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="paid-on">Paid on</Label>
            <Input
              id="paid-on"
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Amount $</Label>
            <NumberField
              value={amount}
              step="0.01"
              inputMode="decimal"
              blankZero={false}
              onChange={setAmount}
            />
            {r2(amount) !== r2(Number(inv.total)) && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Differs from the total ({money(inv.total)})
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="paid-method">Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="paid-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(PAYMENT_METHODS as readonly string[]).includes(method) ? null : (
                  <SelectItem value={method}>{method}</SelectItem>
                )}
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="paid-ref">Reference</Label>
            <Input
              id="paid-ref"
              value={ref}
              maxLength={80}
              placeholder={method === "Check" ? "Check #" : "Reference"}
              onChange={(e) => setRef(e.target.value)}
            />
          </div>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={props.busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" form="paid-form" disabled={props.busy}>
            {props.busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CircleDollarSign className="mr-2 h-4 w-4" />
            )}
            {again ? "Save payment" : "Mark paid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
