/**
 * The Invoices list (docs/service-module-design.md §5.4–§5.5): every ticket invoice, filtered by
 * status and invoice date, with footer totals for the rows shown; a row opens its ticket (where
 * the invoice is edited). **Export to Sage** writes the bookkeeper's CSV for a date range
 * (final, sent and paid invoices) and stamps them exported.
 *
 * Office users and admins only: technicians never see money (the server refuses them too).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { FileDown, Loader2, Receipt } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  exportSageCsv,
  INVOICE_STATUSES,
  listInvoices,
  type InvoiceStatus,
} from "@/lib/invoices.functions";
import { InvoiceStatusBadge } from "@/components/service/invoice-block";
import {
  asInvoiceStatus,
  downloadBlob,
  errText,
  money,
  shortDay,
  stampDay,
  STATUS_LABELS,
  thisMonth,
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

export function InvoicesPage() {
  const { profile } = useAuth();
  if (profile?.technician && profile.role !== "admin")
    return (
      <div className="mx-auto max-w-md space-y-3 rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium">Invoices are the office's.</p>
        <p className="text-sm text-muted-foreground">Your tickets are on Today.</p>
        <Button asChild>
          <Link to="/service/today">Go to Today</Link>
        </Button>
      </div>
    );
  return <InvoiceList />;
}

type StatusFilter = "all" | InvoiceStatus;

function Chip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={props.active ? "default" : "outline"}
      className="h-7 rounded-full px-3 text-xs"
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

function InvoiceList() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const listFn = useServerFn(listInvoices);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

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
    enabled: !!session,
  });
  const rows = list.data ?? [];
  // Void invoices are not money owed; they stay out of the footer sums.
  const live = rows.filter((r) => r.status !== "void");
  const sum = (f: (r: (typeof rows)[number]) => number) => live.reduce((n, r) => n + f(r), 0);
  const totalSum = sum((r) => Number(r.total));
  const paidSum = sum((r) => (r.status === "paid" ? Number(r.paid_amount) : 0));
  const openSum = sum((r) => (r.status === "final" || r.status === "sent" ? Number(r.total) : 0));
  const anyFilter = status !== "all" || !!from || !!to;
  const open = (serviceJobId: string) =>
    void navigate({ to: "/service", search: { id: serviceJobId } });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Receipt className="h-6 w-6" /> Invoices
          </h1>
          <p className="text-sm text-muted-foreground">
            One per ticket; open a row to edit, send or mark it paid on its ticket.
          </p>
        </div>
        <Button size="lg" variant="outline" onClick={() => setExportOpen(true)}>
          <FileDown className="mr-2 h-5 w-5" /> Export to Sage
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={status === "all"} onClick={() => setStatus("all")}>
            All
          </Chip>
          {INVOICE_STATUSES.map((s) => (
            <Chip key={s} active={status === s} onClick={() => setStatus(status === s ? "all" : s)}>
              {STATUS_LABELS[s]}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
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
                setStatus("all");
                setFrom("");
                setTo("");
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
      </div>

      {list.error ? (
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
            : "No invoices yet. A ticket's invoice is drafted when the office opens a Done ticket."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Site</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Paid</th>
                <th className="px-3 py-2 font-medium">Sent</th>
                <th className="px-3 py-2 font-medium">Sage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = asInvoiceStatus(r.status);
                return (
                  <tr
                    key={r.id}
                    className={`cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40 ${s === "void" ? "text-muted-foreground" : ""}`}
                    onClick={() => open(r.service_job_id)}
                  >
                    <td className="px-3 py-2 font-medium tabular-nums">
                      <Link
                        to="/service"
                        search={{ id: r.service_job_id }}
                        className="underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.number}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{shortDay(r.invoice_date)}</td>
                    <td className="px-3 py-2">{r.customer_name || "—"}</td>
                    <td className="px-3 py-2">{r.site_name || "—"}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${s === "void" ? "line-through" : ""}`}
                    >
                      {money(r.total)}
                    </td>
                    <td className="px-3 py-2">
                      <InvoiceStatusBadge status={r.status} />
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
                    <td className="whitespace-nowrap px-3 py-2">{stampDay(r.sent_at) || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {stampDay(r.sage_exported_at) || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40 text-sm font-medium">
                <td className="px-3 py-2" colSpan={4}>
                  {live.length} invoice{live.length === 1 ? "" : "s"}
                  {rows.length !== live.length ? " (void left out)" : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(totalSum)}</td>
                <td className="px-3 py-2 text-xs font-normal text-muted-foreground" colSpan={4}>
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

function ExportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const exportFn = useServerFn(exportSageCsv);
  const month = thisMonth();
  const [from, setFrom] = useState(month.from);
  const [to, setTo] = useState(month.to);
  const [onlyNew, setOnlyNew] = useState(true);
  const run = useMutation({
    mutationFn: () => exportFn({ data: { from, to, only_unexported: onlyNew } }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      if (r.count === 0) {
        toast.info(
          onlyNew
            ? "Nothing new to export in that range (every final invoice there was exported already)."
            : "No final, sent or paid invoices in that range.",
        );
        return;
      }
      downloadBlob(new Blob([r.csv], { type: "text/csv;charset=utf-8" }), r.file_name);
      toast.success(`Exported ${r.count} invoice${r.count === 1 ? "" : "s"} for Sage`);
      onClose();
    },
    onError: (e) => toast.error(`Could not export to Sage: ${errText(e)}`),
  });
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !run.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export to Sage</DialogTitle>
          <DialogDescription>
            A CSV of the final, sent and paid invoices dated in this range (one row per invoice and
            one per line) for the bookkeeper to import. Those invoices are stamped exported.
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
              <Input id="sage-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={onlyNew} onCheckedChange={(v) => setOnlyNew(v === true)} />
            Only invoices not yet exported
          </label>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={run.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="sage-export" disabled={run.isPending || !valid}>
            {run.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-2 h-4 w-4" />
            )}
            Export CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
