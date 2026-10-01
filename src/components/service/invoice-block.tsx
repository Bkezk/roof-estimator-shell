/**
 * The invoice on the office's ticket page (docs/service-module-design.md §5.4). Shown once the
 * ticket is Done / Invoiced / Closed, or when it already has an invoice; opening it makes the
 * draft from the ticket's time and materials (getOrCreateInvoice, §4 rules). A draft is edited
 * in place (header, lines, narrative) and then finalised, or finalised and emailed, or deleted;
 * a final invoice is read-only and can be downloaded, sent again, marked paid or voided.
 *
 * A ticket can carry more than one invoice (owner, Sep 30): "Another invoice" makes the next,
 * numbered "<ticket>.2", ".3", …; a deleted or voided one frees its number for the next
 * (invoice-numbering.ts). The ticket's invoices show as chips to switch between.
 *
 * Admins, managers and sales / project managers (`seesInvoices`; owner, Oct 1); everyone else
 * — technicians above all — never sees it (RLS invoices_office), so the block renders nothing
 * for them. Every change is logged (audit_log); admins and managers see it in the History fold.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Ban,
  CircleDollarSign,
  Download,
  Eye,
  FileCheck2,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { managesTickets, seesInvoices } from "@/lib/access";
import { AuditHistory } from "@/components/audit-history";
import { getAccount, listContacts } from "@/lib/crm.functions";
import { invoiceLabel, remainingInvoiceAfterVoid } from "@/lib/invoice-numbering";
import {
  createAnotherInvoice,
  finalizeInvoice,
  getInvoice,
  getOrCreateInvoice,
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
import type { ServiceJobWithTech } from "@/lib/service.functions";
import {
  asInvoiceStatus,
  downloadBlob,
  errText,
  fromPct,
  isEmail,
  money,
  openPdfTab,
  PAYMENT_METHODS,
  pdfBlob,
  r2,
  shortDay,
  showPdf,
  splitEmails,
  stampDay,
  STATUS_CLASS,
  STATUS_LABELS,
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

/** Every invoice query of a ticket (the prefix); `id` null = the ticket's current invoice. */
const invoiceKey = (jobId: string) => ["ticket-invoice", jobId] as const;
const oneInvoiceKey = (jobId: string, id: string | null) =>
  ["ticket-invoice", jobId, id ?? "current"] as const;
const ticketInvoicesKey = (jobId: string) => ["ticket-invoices", jobId] as const;
const INVOICE_STAGES = ["done", "invoiced", "closed"];

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

/** Mounted on every ticket; decides whether the invoice applies here. */
export function InvoiceBlock({ job }: { job: ServiceJobWithTech }) {
  const { profile } = useAuth();
  // Invoices are a manager's and sales' / PMs' (owner, Oct 1): nobody else sees the block.
  if (!profile || !seesInvoices(profile)) return null;
  if (!INVOICE_STAGES.includes(job.stage) && !job.invoice_id) return null;
  return <InvoiceLoader job={job} />;
}

/** Everything a sub-view needs to report a changed invoice back to the page. */
interface Ctx {
  job: ServiceJobWithTech;
  /** Put the server's answer in the cache; `stageChanged` also refreshes the ticket. */
  applied: (r: InvoiceWithLines, stageChanged?: boolean) => void;
  onVoided: (voidedId: string) => void;
}

function InvoiceLoader({ job }: { job: ServiceJobWithTech }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const getFn = useServerFn(getOrCreateInvoice);
  const oneFn = useServerFn(getInvoice);
  const listFn = useServerFn(listTicketInvoices);
  const anotherFn = useServerFn(createAnotherInvoice);
  // After a void / delete: wait for the office before making a new draft.
  const [voided, setVoided] = useState(false);
  // The invoice shown; null = the ticket's current one (made on first open).
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({
    queryKey: oneInvoiceKey(job.id, selected),
    queryFn: () =>
      selected ? oneFn({ data: { id: selected } }) : getFn({ data: { job_id: job.id } }),
    enabled: !!session && !voided,
    retry: 1,
  });
  const all = useQuery({
    queryKey: ticketInvoicesKey(job.id),
    queryFn: () => listFn({ data: { job_id: job.id } }),
    enabled: !!session && (!!q.data || voided),
  });

  const refreshTicket = () => {
    void qc.invalidateQueries({ queryKey: ["service-job", job.id] });
    void qc.invalidateQueries({ queryKey: ["service-jobs"] });
    void qc.invalidateQueries({ queryKey: ["accounts"] });
  };
  const refreshLists = () => {
    void qc.invalidateQueries({ queryKey: ["invoices"] });
    void qc.invalidateQueries({ queryKey: ticketInvoicesKey(job.id) });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };
  const ctx: Ctx = {
    job,
    applied: (r, stageChanged) => {
      qc.setQueryData(oneInvoiceKey(job.id, selected), r);
      refreshLists();
      if (stageChanged) refreshTicket();
    },
    onVoided: (voidedId) => {
      // Owner (Oct 1): deleting "6000.2" looked as if "6000" were gone too. Show the ticket's
      // remaining live invoice when there is one; only an empty ticket waits for a new draft.
      qc.removeQueries({ queryKey: invoiceKey(job.id) });
      refreshTicket();
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc
        .fetchQuery({
          queryKey: ticketInvoicesKey(job.id),
          queryFn: () => listFn({ data: { job_id: job.id } }),
          staleTime: 0,
        })
        .then((list) => {
          const next = remainingInvoiceAfterVoid(list, voidedId);
          if (next) {
            setSelected(next.id);
            setVoided(false);
          } else {
            setSelected(null);
            setVoided(true);
          }
        })
        .catch((e: unknown) => {
          setSelected(null);
          setVoided(true);
          toast.error(`Could not reload this ticket's invoices: ${errText(e)}`);
        });
    },
  };
  const another = useMutation({
    mutationFn: () => anotherFn({ data: { job_id: job.id } }),
    onSuccess: (r) => {
      qc.setQueryData(oneInvoiceKey(job.id, r.invoice.id), r);
      setSelected(r.invoice.id);
      setVoided(false);
      refreshLists();
      refreshTicket();
      toast.success(`Invoice #${invoiceLabel(r.invoice)} made from the ticket`);
    },
    onError: (e) => toast.error(`Could not make another invoice: ${errText(e)}`),
  });
  const pick = (id: string) => {
    setVoided(false);
    setSelected(id);
  };

  const data = voided ? undefined : q.data;
  const status = data ? asInvoiceStatus(data.invoice.status) : null;
  const siblings = all.data ?? [];
  return (
    <section className="space-y-4 rounded-lg border p-4" aria-label="Invoice">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Receipt className="h-4 w-4" /> Invoice
          {data && <span className="tabular-nums">#{invoiceLabel(data.invoice)}</span>}
        </h2>
        {data && <InvoiceStatusBadge status={data.invoice.status} />}
        {data?.invoice.updated_by_name && (
          <span className="text-xs text-muted-foreground">
            last changed by {data.invoice.updated_by_name}
          </span>
        )}
        {data && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={another.isPending}
            title={`Make another invoice for ticket #${job.number} (numbered ${job.number}.2, ${job.number}.3, …)`}
            onClick={() => another.mutate()}
          >
            {another.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            Another invoice
          </Button>
        )}
      </div>
      {siblings.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="This ticket's invoices">
          {siblings.map((x) => {
            const active = !voided && data?.invoice.id === x.id;
            return (
              <Button
                key={x.id}
                type="button"
                size="sm"
                variant={active ? "secondary" : "ghost"}
                aria-pressed={active}
                className={`h-7 gap-1.5 px-2 text-xs ${x.status === "void" ? "text-muted-foreground line-through" : ""}`}
                onClick={() => pick(x.id)}
              >
                <span className="tabular-nums">#{x.label}</span>
                <InvoiceStatusBadge status={x.status} />
              </Button>
            );
          })}
        </div>
      )}
      {voided ? (
        <div className="space-y-3 rounded-md border border-dashed p-4 text-sm">
          <p>
            The invoice was voided or deleted; its number is free for the next invoice on this
            ticket.
          </p>
          <Button variant="outline" onClick={() => setVoided(false)}>
            <Plus className="mr-1 h-4 w-4" /> Make a new draft
          </Button>
        </div>
      ) : q.error ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">Could not open the invoice: {errText(q.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            <RefreshCw className="mr-1 h-4 w-4" /> Try again
          </Button>
        </div>
      ) : !data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Building the invoice from the ticket…
        </p>
      ) : status === "draft" ? (
        // Remount on every server change so the edit state starts from what was saved.
        <DraftInvoice key={`${data.invoice.id}:${data.invoice.updated_at}`} ctx={ctx} data={data} />
      ) : (
        <FinalInvoice ctx={ctx} data={data} />
      )}
      {data && <AuditHistory entity="invoice" entityId={data.invoice.id} />}
    </section>
  );
}

// ---- Draft ----------------------------------------------------------------------------------

interface LineDraft {
  key: string;
  kind: LineKind;
  description: string;
  qty: number;
  unit: string;
  rate: number;
  cost_rate: number;
  on_date: string | null;
  taxable: boolean;
  source: string | null;
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
});
const headFrom = (inv: InvoiceRow): HeadDraft => ({
  invoice_date: inv.invoice_date,
  due_date: inv.due_date ?? "",
  po_number: inv.po_number ?? "",
  job_code: inv.job_code ?? "",
  description: inv.description ?? "",
  payment_terms: inv.payment_terms ?? "",
  tax_pct: toPct(inv.tax_rate),
});
const editKey = (h: HeadDraft, lines: LineDraft[]) =>
  JSON.stringify([h, lines.map(({ key: _k, ...rest }) => rest)]);

/** Live totals as the server computes them (invoices.server.ts totals()). */
function computeTotals(
  lines: { kind: string; qty: number; rate: number; cost_rate: number; taxable: boolean }[],
  taxRate: number,
) {
  let subtotal = 0;
  let taxable = 0;
  let cost = 0;
  let hours = 0;
  for (const l of lines) {
    const amount = r2(l.qty * l.rate);
    subtotal += amount;
    if (l.taxable) taxable += amount;
    cost += r2(l.qty * l.cost_rate);
    if (l.kind === "labor" || l.kind === "travel") hours += l.qty;
  }
  subtotal = r2(subtotal);
  const tax = r2(r2(taxable) * taxRate);
  const total = r2(subtotal + tax);
  const cost_total = r2(cost);
  const margin = r2(total - cost_total);
  return {
    subtotal,
    tax,
    total,
    cost_total,
    margin,
    hours,
    perHour: hours > 0 ? margin / hours : null,
  };
}

function DraftInvoice({ ctx, data }: { ctx: Ctx; data: InvoiceWithLines }) {
  const { job } = ctx;
  const inv = data.invoice;
  const no = invoiceLabel(inv);
  const deleteFn = useServerFn(voidInvoice);
  const qc = useQueryClient();
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
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
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
  const t = computeTotals(lines, fromPct(head.tax_pct));

  /** The save payload, or an error message when a line is incomplete. */
  const payload = (forFinal: boolean): InvoiceSaveInput | string => {
    const bad = lines.findIndex((l) => !l.description.trim());
    if (bad >= 0) return `Line ${bad + 1} needs a description`;
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
      lines: lines.map((l) => ({
        // A saved line's id (its key is "l<id>"); new lines have none. The audit log uses it.
        ...(l.key.startsWith("l") ? { id: Number(l.key.slice(1)) } : {}),
        kind: l.kind,
        description: l.description.trim(),
        qty: l.qty,
        unit: l.unit.trim() || "ea",
        rate: l.rate,
        cost_rate: l.cost_rate,
        on_date: l.on_date,
        taxable: l.taxable,
        source: l.source,
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
      if (savedFirst) void qc.invalidateQueries({ queryKey: invoiceKey(job.id) });
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run("save", "Could not save the invoice", async () => {
      const r = await saveIfNeeded(false);
      if (r) ctx.applied(r);
      toast.success(`Invoice #${no} saved`);
    });
  const rebuild = () =>
    run("rebuild", "Could not rebuild the invoice", async () => {
      const r = await rebuildFn({ data: { id: inv.id } });
      setConfirm(null);
      ctx.applied(r);
      toast.success(
        `Rebuilt from the ticket: ${r.lines.length} line${r.lines.length === 1 ? "" : "s"}`,
      );
    });
  const preview = () => {
    const win = openPdfTab();
    void run(
      "preview",
      "Could not make the PDF",
      async () => {
        try {
          const saved = await saveIfNeeded(false);
          const pdf = await renderFn({ data: { id: inv.id } });
          showPdf(win, pdf.base64, pdf.file_name);
          if (saved) ctx.applied(saved);
        } catch (e) {
          win?.close();
          throw e;
        }
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
    setLines((ls) => [
      ...ls,
      {
        key,
        kind: "other",
        description: "",
        qty: 1,
        unit: "ea",
        rate: 0,
        cost_rate: 0,
        on_date: null,
        taxable: true,
        source: null,
      },
    ]);
    setNewKey(key);
  };
  const tryFinal = () => {
    const p = payload(true);
    if (typeof p === "string") {
      toast.error(p);
      return;
    }
    if (!lines.length) {
      toast.error("The invoice has no lines");
      return;
    }
    setConfirm("final");
  };
  const trySend = () => {
    const p = payload(true);
    if (typeof p === "string") {
      toast.error(p);
      return;
    }
    if (!lines.length) {
      toast.error("The invoice has no lines");
      return;
    }
    setSendOpen(true);
  };

  return (
    <div className="space-y-4">
      <BillTo inv={inv} />

      {/* Header */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="space-y-1">
          <Label className="text-xs">Invoice #</Label>
          <p className="flex h-9 items-center font-medium tabular-nums">{no}</p>
        </div>
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
      </div>
      {dateUntouched(head.invoice_date) && head.invoice_date < todayYmd() && (
        <p className="-mt-2 text-xs text-muted-foreground">
          The date becomes the day it is finalised unless you change it.
        </p>
      )}

      {/* Lines */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Lines</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!!busy}
            onClick={() => setConfirm("rebuild")}
            title="Throw away these lines and build them again from the ticket's time and materials"
          >
            <RefreshCw className="mr-1 h-4 w-4" /> Rebuild from ticket
          </Button>
        </div>
        {lines.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No lines. The ticket has no time or material yet: add a line, or record the time in
            Close out and rebuild.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Kind</th>
                  <th className="py-1.5 pr-2 font-medium">Description</th>
                  <th className="w-20 py-1.5 pr-2 text-right font-medium">Qty</th>
                  <th className="w-20 py-1.5 pr-2 font-medium">Unit</th>
                  <th className="w-24 py-1.5 pr-2 text-right font-medium">Rate</th>
                  <th className="w-24 py-1.5 pr-2 text-right font-medium">Amount</th>
                  <th className="w-12 py-1.5 pr-2 text-center font-medium" title="Taxable">
                    Tax
                  </th>
                  <th className="w-9 py-1.5" aria-label="Delete" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key} className="border-b align-top last:border-0">
                    <td className="py-1.5 pr-2">
                      {l.source ? (
                        <div className="pt-2">
                          <KindBadge kind={l.kind} />
                        </div>
                      ) : (
                        <Select
                          value={l.kind}
                          onValueChange={(v) => setLine(l.key, { kind: asKind(v) })}
                        >
                          <SelectTrigger className="h-9 w-[104px]" aria-label="Kind">
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
                    </td>
                    <td className="py-1.5 pr-2">
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
                    </td>
                    <td className="py-1.5 pr-2">
                      <NumberField
                        value={l.qty}
                        step="0.25"
                        inputMode="decimal"
                        className="text-right"
                        onChange={(v) => setLine(l.key, { qty: v })}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        value={l.unit}
                        maxLength={20}
                        aria-label={`Line ${i + 1} unit`}
                        onChange={(e) => setLine(l.key, { unit: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <NumberField
                        value={l.rate}
                        min={-1_000_000}
                        step="0.01"
                        inputMode="decimal"
                        className="text-right"
                        onChange={(v) => setLine(l.key, { rate: v })}
                      />
                    </td>
                    <td className="py-1.5 pr-2 pt-3.5 text-right tabular-nums">
                      {money(r2(l.qty * l.rate))}
                    </td>
                    <td className="py-1.5 pr-2 pt-3.5 text-center">
                      <Checkbox
                        checked={l.taxable}
                        aria-label={`Line ${i + 1} taxable`}
                        onCheckedChange={(c) => setLine(l.key, { taxable: c === true })}
                      />
                    </td>
                    <td className="py-1.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-destructive hover:text-destructive"
                        aria-label={`Delete line ${i + 1}`}
                        title="Delete this line"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          <Plus className="mr-1 h-4 w-4" /> Add line
        </Button>
      </div>

      {/* Narrative and terms, with the totals beside them */}
      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="inv-description">Description</Label>
            <Textarea
              id="inv-description"
              rows={5}
              value={head.description}
              maxLength={10000}
              placeholder="The work done, as the customer reads it on page 1"
              onChange={(e) => setH("description", e.target.value)}
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
        </div>
        <Totals t={t} taxPct={head.tax_pct} />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button type="button" disabled={!!busy || !dirty} onClick={() => void save()}>
          {busy === "save" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save
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
                ? "The lines are thrown away and built again from the ticket's time entries and materials at today's rates. Line edits are lost (the header and description stay)."
                : confirm === "delete"
                  ? `The draft and its lines are removed. The next invoice made for ticket #${job.number} takes number ${no}.`
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

function BillTo({ inv }: { inv: InvoiceRow }) {
  const b = (inv.bill_to ?? {}) as Record<string, string | undefined>;
  const p = (inv.property ?? {}) as Record<string, string | undefined>;
  const cityLine = [b["city"], [b["state"], b["zip"]].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <p className="text-xs text-muted-foreground">Send to</p>
        <p className="font-medium">{b["name"] || "—"}</p>
        {[b["address1"], b["address2"], cityLine].filter(Boolean).map((x) => (
          <p key={x} className="text-muted-foreground">
            {x}
          </p>
        ))}
        {b["instructions"] && (
          <p className="whitespace-pre-line text-xs text-amber-700 dark:text-amber-400">
            Billing: {b["instructions"]}
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

function Totals({ t, taxPct }: { t: ReturnType<typeof computeTotals>; taxPct: number }) {
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
      <dl className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
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
    </div>
  );
}

// ---- Final / sent / paid / void -------------------------------------------------------------

function FinalInvoice({ ctx, data }: { ctx: Ctx; data: InvoiceWithLines }) {
  const { job } = ctx;
  const inv = data.invoice;
  const status: InvoiceStatus = asInvoiceStatus(inv.status);
  const renderFn = useServerFn(renderInvoice);
  const sendFn = useServerFn(sendInvoice);
  const paidFn = useServerFn(markInvoicePaid);
  const voidFn = useServerFn(voidInvoice);
  const account = useAccount(job.account_id);
  const [dialog, setDialog] = useState<null | "send" | "paid" | "void">(null);

  const t = computeTotals(
    data.lines.map((l) => ({
      kind: l.kind,
      qty: Number(l.qty),
      rate: Number(l.rate),
      cost_rate: Number(l.cost_rate),
      taxable: l.taxable,
    })),
    Number(inv.tax_rate),
  );
  // The stored totals are the record; the live figures above only feed the margin per hour.
  const stored = {
    ...t,
    subtotal: Number(inv.subtotal),
    tax: Number(inv.tax_amount),
    total: Number(inv.total),
    cost_total: Number(inv.cost_total),
    margin: r2(Number(inv.total) - Number(inv.cost_total)),
  };
  stored.perHour = t.hours > 0 ? stored.margin / t.hours : null;

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
      ctx.applied(r, true);
      toast.success(`Invoice #${invoiceLabel(r.invoice)} marked paid; the ticket is Closed`);
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
      {status === "void" && (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          This invoice is void. It stays on record under its number and is left out of the Sage
          export.
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
                <td className="py-1.5 pr-2">{l.unit}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{money(l.rate)}</td>
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
        <Totals t={stored} taxPct={toPct(inv.tax_rate)} />
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
  busy: boolean;
  onClose: () => void;
  onSend: (to: string[], message: string) => void;
}) {
  const { session, profile } = useAuth();
  const contactsFn = useServerFn(listContacts);
  const ratesFn = useServerFn(getServiceRates);
  const accountId = props.accountId;
  const contactsQ = useQuery({
    queryKey: ["contacts", accountId],
    queryFn: () => contactsFn({ data: { account_id: accountId! } }),
    enabled: !!session && !!accountId,
  });
  const ratesQ = useQuery({
    queryKey: ["service-rates"],
    queryFn: () => ratesFn(),
    // Service Rates (the default message) are a manager's; for sales the box starts blank and
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
  // else the billing contacts; the message from Service rates.
  const pickedInit = useRef(false);
  useEffect(() => {
    if (pickedInit.current || (accountId && !contactsQ.data && !contactsQ.error)) return;
    pickedInit.current = true;
    const known = new Set(contacts.map((c) => c.email.toLowerCase()));
    const last = Array.isArray(props.inv.sent_to) ? (props.inv.sent_to as string[]) : [];
    if (last.length) {
      setPicked(last.filter((e) => known.has(e.toLowerCase())));
      setExtra(last.filter((e) => !known.has(e.toLowerCase())).join(", "));
    } else setPicked(contacts.filter((c) => c.billing).map((c) => c.email));
  }, [accountId, contacts, contactsQ.data, contactsQ.error, props.inv.sent_to]);
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
