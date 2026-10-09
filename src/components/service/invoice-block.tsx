/**
 * The invoice card on the office's ticket page (docs/service-module-design.md §5.4). Shown once
 * the ticket is Done / Invoiced / Closed, or when it already has an invoice. The card is a
 * summary — number, status, total, who changed it last, the ticket's invoices as chips — with
 * **Open** (the full-width editor, `/service/invoices?id=…`, invoice-editor.tsx), **Another
 * invoice** and, on a draft, **Delete draft**. Owner, Oct 1: "the invoice is cramped into a
 * little dropdown and difficult to edit", so the editor is no longer inside the card.
 *
 * A ticket with no live invoice shows "Make the invoice": the draft is made from the ticket's
 * time and materials (getOrCreateInvoice, §4 rules) and opened. A ticket can carry more than one
 * invoice (owner, Sep 30): "Another invoice" makes the next, numbered "<ticket>.2", ".3", …; a
 * deleted or voided one frees its number for the next (invoice-numbering.ts). "Another invoice"
 * asks whom to bill first: the customer account or a vendor (owner, Oct 1: "Sometimes it's both
 * a customer and a vendor, so we could make two invoices for that if needed"); an invoice billed
 * to a vendor carries the badge "Billed to vendor: <name>".
 *
 * At Done the card is "Needs authorization" (AuthorizeCard) with **Mark authorized** alone; the
 * invoice card with **Make the invoice** comes only once the ticket is Authorized. Two steps,
 * two buttons, kept apart on purpose (owner, Oct 9: authorizing and invoicing are done by
 * different people — never one combined button). On the ticket page the Done card leads the
 * right column (service-page.tsx).
 *
 * Admins, managers and sales / project managers (`seesInvoices`; owner, Oct 1); everyone else
 * — technicians above all — never sees it (RLS invoices_office), so the card renders nothing
 * for them. Every change is logged on the server (audit_log); the History fold is on the page.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ExternalLink, Loader2, Plus, Receipt, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { managesTickets, seesInvoices } from "@/lib/access";
import { INVOICE_STAGES } from "@/lib/ticket-stage";
import { setServiceStage } from "@/lib/service.functions";
import { invoiceLabel, remainingInvoiceAfterVoid } from "@/lib/invoice-numbering";
import {
  createAnotherInvoice,
  getInvoice,
  getOrCreateInvoice,
  listTicketInvoices,
  voidInvoice,
  type InvoiceWithLines,
} from "@/lib/invoices.functions";
import type { ServiceJobWithTech } from "@/lib/service.functions";
import {
  deleteDraftNote,
  errText,
  invoiceKey,
  invoicePageKey,
  money,
  oneInvoiceKey,
  ticketInvoicesKey,
} from "@/components/service/invoice-utils";
import { InvoiceStatusBadge } from "@/components/service/invoice-editor";
import { AnotherInvoiceDialog, VendorBilledBadge } from "@/components/service/bill-to-picker";
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
import { SECTION_TONES } from "@/components/service/section-tones";
import { Button } from "@/components/ui/button";

/** Mounted on every ticket; decides whether the invoice applies here. */
export function InvoiceBlock({ job }: { job: ServiceJobWithTech }) {
  const { profile } = useAuth();
  // Invoices are a manager's and sales' / PMs' (owner, Oct 1): nobody else sees the card.
  if (!profile || !seesInvoices(profile)) return null;
  // M9 (owner, Oct 5): a Done ticket is reviewed (Authorized) before it is invoiced.
  if (job.stage === "done" && !job.invoice_id) return <AuthorizeCard job={job} />;
  if (!INVOICE_STAGES.includes(job.stage) && !job.invoice_id) return null;
  return <InvoiceCard job={job} />;
}

/**
 * At Done: "Needs authorization". A manager (the owner reviews; "the manager can move it past
 * authorize if need be") marks it Authorized here; a sales / project manager sees that it waits.
 */
function AuthorizeCard({ job }: { job: ServiceJobWithTech }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const stageFn = useServerFn(setServiceStage);
  const authorize = useMutation({
    mutationFn: () => stageFn({ data: { id: job.id, stage: "authorized" } }),
    onSuccess: () => {
      toast.success(`Ticket #${job.number} authorized — ready to invoice`);
      void qc.invalidateQueries({ queryKey: ["service-job", job.id] });
      void qc.invalidateQueries({ queryKey: ["service-jobs"] });
      void qc.invalidateQueries({ queryKey: ["service-job-events", job.id] });
    },
    onError: (e) => toast.error(`Could not authorize the ticket: ${errText(e)}`),
  });
  return (
    <section
      className={`space-y-3 rounded-lg border p-4 ${SECTION_TONES["invoice"]!.edge}`}
      aria-label="Invoice"
    >
      <h2 className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-4 w-4" /> Needs authorization
      </h2>
      <p className="text-sm text-muted-foreground">
        The work is done. Once it is reviewed and authorized, the invoice is made from the
        ticket&apos;s time and materials.
      </p>
      {managesTickets(profile) ? (
        <Button disabled={authorize.isPending} onClick={() => authorize.mutate()}>
          {authorize.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="mr-1 h-4 w-4" />
          )}
          Mark authorized
        </Button>
      ) : (
        <p className="text-sm">Waiting for a manager to authorize it.</p>
      )}
    </section>
  );
}

function InvoiceCard({ job }: { job: ServiceJobWithTech }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listTicketInvoices);
  const oneFn = useServerFn(getInvoice);
  const makeFn = useServerFn(getOrCreateInvoice);
  const anotherFn = useServerFn(createAnotherInvoice);
  const deleteFn = useServerFn(voidInvoice);
  // The chip picked; null = the ticket's current invoice (its newest live one).
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // "Another invoice": whom to bill (the customer account or a vendor) is asked first.
  const [askAnother, setAskAnother] = useState(false);

  const all = useQuery({
    queryKey: ticketInvoicesKey(job.id),
    queryFn: () => listFn({ data: { job_id: job.id } }),
    enabled: !!session,
  });
  const list = all.data ?? [];
  const current = [...list].reverse().find((x) => x.status !== "void") ?? null;
  const shown = list.find((x) => x.id === selected) ?? current;
  const one = useQuery({
    queryKey: oneInvoiceKey(job.id, shown?.id ?? ""),
    queryFn: () => oneFn({ data: { id: shown!.id } }),
    enabled: !!session && !!shown,
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
  /** A new draft (Make the invoice / Another invoice): straight onto its page. */
  const opened = (r: InvoiceWithLines, what: string) => {
    qc.setQueryData(invoicePageKey(r.invoice.id), r);
    refreshLists();
    refreshTicket();
    toast.success(`Invoice #${invoiceLabel(r.invoice)} ${what}`);
    void navigate({ to: "/service/invoices", search: { id: r.invoice.id } });
  };
  const make = useMutation({
    mutationFn: () => makeFn({ data: { job_id: job.id } }),
    onSuccess: (r) => opened(r, "made from the ticket"),
    onError: (e) => toast.error(`Could not make the invoice: ${errText(e)}`),
  });
  const another = useMutation({
    mutationFn: (vendorId: string | null) =>
      anotherFn({ data: { job_id: job.id, bill_to_vendor_id: vendorId } }),
    onSuccess: (r) => {
      setAskAnother(false);
      opened(r, r.invoice.bill_to_vendor_id ? "made for the vendor" : "made from the ticket");
    },
    onError: (e) => toast.error(`Could not make another invoice: ${errText(e)}`),
  });
  const remove = useMutation({
    mutationFn: (v: { id: string; label: string }) => deleteFn({ data: { id: v.id } }),
    onSuccess: async (_r, { id: deletedId, label: deleted }) => {
      setConfirmDelete(false);
      toast.success(`Draft invoice #${deleted} deleted; its number is free for the next invoice`);
      // Owner (Oct 1): deleting "6000.2" looked as if "6000" were gone too. Show the ticket's
      // remaining live invoice when there is one; an empty ticket offers "Make the invoice".
      qc.removeQueries({ queryKey: invoiceKey(job.id) });
      qc.removeQueries({ queryKey: invoicePageKey(deletedId) });
      refreshTicket();
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["audit"] });
      try {
        const fresh = await qc.fetchQuery({
          queryKey: ticketInvoicesKey(job.id),
          queryFn: () => listFn({ data: { job_id: job.id } }),
          staleTime: 0,
        });
        const next = remainingInvoiceAfterVoid(fresh, deletedId);
        setSelected(next ? next.id : null);
      } catch (e) {
        setSelected(null);
        toast.error(`Could not reload this ticket's invoices: ${errText(e)}`);
      }
    },
    onError: (e) => toast.error(`Could not delete the draft: ${errText(e)}`),
  });

  const inv = one.data?.invoice;
  const label = shown?.label ?? "";
  const status = inv?.status ?? shown?.status ?? null;
  const total = inv ? Number(inv.total) : (shown?.total ?? 0);
  const busy = make.isPending || another.isPending || remove.isPending;

  return (
    <section
      className={`space-y-3 rounded-lg border p-4 ${SECTION_TONES["invoice"]!.edge}`}
      aria-label="Invoice"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Receipt className="h-4 w-4" /> Invoice
          {shown && <span className="tabular-nums">#{label}</span>}
        </h2>
        {status && <InvoiceStatusBadge status={status} />}
        {shown && (
          <span
            className={`ml-auto font-semibold tabular-nums ${status === "void" ? "text-muted-foreground line-through" : ""}`}
          >
            {money(total)}
          </span>
        )}
      </div>
      {inv?.updated_by_name && (
        <p className="-mt-2 text-xs text-muted-foreground">last changed by {inv.updated_by_name}</p>
      )}
      {inv?.bill_to_vendor_id && (
        <VendorBilledBadge name={(inv.bill_to as { name?: string } | null)?.name} />
      )}
      {list.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="This ticket's invoices">
          {list.map((x) => {
            const active = shown?.id === x.id;
            return (
              <Button
                key={x.id}
                type="button"
                size="sm"
                variant={active ? "secondary" : "ghost"}
                aria-pressed={active}
                className={`h-7 gap-1.5 px-2 text-xs ${x.status === "void" ? "text-muted-foreground line-through" : ""}`}
                onClick={() => setSelected(x.id)}
              >
                <span className="tabular-nums">#{x.label}</span>
                <InvoiceStatusBadge status={x.status} />
              </Button>
            );
          })}
        </div>
      )}

      {all.error ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">
            Could not load this ticket's invoices: {errText(all.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void all.refetch()}>
            <RefreshCw className="mr-1 h-4 w-4" /> Try again
          </Button>
        </div>
      ) : !all.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the invoice…
        </p>
      ) : !shown ? (
        <div className="space-y-3 rounded-md border border-dashed p-4 text-sm">
          <p>
            {list.length
              ? "The invoice was voided or deleted; its number is free for the next invoice on this ticket."
              : "No invoice yet. It is drafted from the ticket's time and materials."}
          </p>
          <Button disabled={busy} onClick={() => make.mutate()}>
            {make.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            Make the invoice
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link to="/service/invoices" search={{ id: shown.id }}>
              <ExternalLink className="mr-1 h-4 w-4" /> Open
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            title={`Make another invoice for ticket #${job.number} (numbered ${job.number}.2, ${job.number}.3, …), to the customer or a vendor`}
            onClick={() => setAskAnother(true)}
          >
            {another.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            Another invoice
          </Button>
          {status === "draft" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Delete draft
            </Button>
          )}
        </div>
      )}

      <AnotherInvoiceDialog
        open={askAnother}
        onOpenChange={setAskAnother}
        jobNumber={job.number}
        customerName={job.customer_name}
        busy={another.isPending}
        onMake={(vendorId) => another.mutate(vendorId)}
      />
      <AlertDialog
        open={confirmDelete}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setConfirmDelete(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft invoice #{label}?</AlertDialogTitle>
            <AlertDialogDescription>{deleteDraftNote(job.number, label)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending || !shown}
              onClick={(e) => {
                e.preventDefault();
                if (shown) remove.mutate({ id: shown.id, label: shown.label });
              }}
            >
              {remove.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
