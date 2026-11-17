/**
 * A trade bid's Invoices block (owner, Nov 17: "Go with option 1, T-1001 format"; on a deposit
 * and a final: "im not sure on that yet"). It sits under the price on a saved bid.
 *
 * A won trade bid is invoiced straight from the bid: it has no service ticket. The block lists
 * the bid's invoices (number, status, date, total, and the balance when one is partly paid; each
 * row opens the invoice on the Invoices page), says what is left to bill, and makes the next
 * invoice, which starts at what is left: one invoice bills it all, a deposit leaves the rest for
 * a second (bid-invoices.ts).
 *
 * Who sees it: whoever the server says may make and see invoices (`allowed`: an admin, a
 * manager, the Invoices tick). Everyone else sees nothing here at all. A bid that is not Won
 * yet shows those people one line, "Mark the bid Won to invoice it."
 *
 * It is no part of the bid's form. Making an invoice changes nothing that Save sends, so it
 * never makes the bid "not saved". The other way round it does wait: an invoice bills the SAVED
 * price, so with changes not saved the button is off and says "Save the bid first."
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  asInvoiceStatus,
  shortDay,
  STATUS_CLASS,
  STATUS_LABELS,
} from "@/components/service/invoice-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-store";
import type { BidInvoiceRow } from "@/lib/bid-invoices";
import { createBidInvoice, listBidInvoices } from "@/lib/bid-invoices.functions";
import { balanceDue, partlyPaid } from "@/lib/invoice-payment";
import { plainErrText } from "@/lib/plain-error";
import { fmtMoney } from "@/lib/trade-bid";
import { cn } from "@/lib/utils";

export const NOT_WON = "Mark the bid Won to invoice it.";
export const SAVE_FIRST = "Save the bid first.";
export const BILLED_IN_FULL = "Billed in full.";
const NOTHING_LEFT = "Nothing is left to bill. Void an invoice first if one was made by mistake.";
const NO_PRICE = "The bid has no price yet, so there is nothing to bill.";
const DELETED = "This bid was deleted.";

/** One invoice: its number, status, date and total; the whole row opens it. */
function InvoiceRow(props: { inv: BidInvoiceRow }) {
  const { inv } = props;
  const status = asInvoiceStatus(inv.status);
  return (
    <li data-bid-invoice-row={inv.id}>
      {/* The same address the Invoices list opens an invoice at. */}
      <Link
        to="/service/invoices"
        search={{ id: inv.id }}
        className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-muted/40"
      >
        <span className="font-medium tabular-nums underline-offset-2 group-hover:underline">
          #{inv.display_number}
        </span>
        {/* The words and colours of the Invoices list (invoice-utils.ts). */}
        <Badge variant="outline" className={`px-1.5 py-0 text-[11px] ${STATUS_CLASS[status]}`}>
          {STATUS_LABELS[status]}
        </Badge>
        <span className="text-muted-foreground">{shortDay(inv.invoice_date)}</span>
        <span className="ml-auto text-right tabular-nums">
          <span className={cn(status === "void" && "text-muted-foreground line-through")}>
            {fmtMoney(inv.total)}
          </span>
          {/* Paid means paid in full (invoice-payment.ts): a smaller payment leaves a balance. */}
          {partlyPaid(inv) && (
            <span
              className="block text-xs font-medium text-amber-700 dark:text-amber-400"
              data-balance-due
            >
              balance due {fmtMoney(balanceDue(inv))}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function BidInvoicesCard(props: {
  bidId: string;
  /** The bid's status, as saved, is Won. */
  won: boolean;
  /** The bid has changes that are not saved: an invoice bills the saved price, so Save first. */
  unsaved: boolean;
  /** A deleted bid is read, not changed: its invoices show, no new one is made. */
  deleted?: boolean;
}) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const listFn = useServerFn(listBidInvoices);
  const makeFn = useServerFn(createBidInvoice);

  // Asked whatever the status: whether this person may invoice decides the not-Won line too.
  const q = useQuery({
    queryKey: ["bid-invoices", props.bidId],
    queryFn: () => listFn({ data: { bid_id: props.bidId } }),
    enabled: !!session,
    retry: 1,
  });

  const make = useMutation({
    mutationFn: () => makeFn({ data: { bid_id: props.bidId } }),
    onSuccess: (r) => {
      // The first invoice gives the bid its job number, and each one changes what is left.
      void qc.invalidateQueries({ queryKey: ["bid-invoices", props.bidId] });
      void qc.invalidateQueries({ queryKey: ["trade-bid", props.bidId] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void navigate({ to: "/service/invoices", search: { id: r.id } });
    },
    // The server's refusals are plain sentences already ("This bid is billed in full. …").
    onError: (e) => toast.error(plainErrText(e), { duration: 12_000 }),
  });

  if (q.error && !q.data) {
    // Where the block would be on a Won bid; on any other bid there is nothing to miss.
    if (!props.won) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" data-bid-invoices-error>
        <p className="min-w-0 break-words text-destructive">
          This bid&apos;s invoices could not be read. {plainErrText(q.error)}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()}>
          <RefreshCw /> Try again
        </Button>
      </div>
    );
  }
  // Still reading, or not this person's to see: nothing at all.
  if (!q.data || !q.data.allowed) return null;

  const { invoices, job_label: jobLabel, unbilled } = q.data;
  // A bid that was invoiced and then moved off Won still shows its invoices.
  if (!props.won && invoices.length === 0)
    return (
      <p className="text-sm text-muted-foreground" data-bid-invoices-hint>
        {NOT_WON}
      </p>
    );

  const live = invoices.filter((i) => i.status !== "void");
  const nothingLeft = !(unbilled > 0);
  // Why an invoice cannot be made right now, or null when it can.
  const reason = props.deleted
    ? DELETED
    : !props.won
      ? NOT_WON
      : props.unsaved
        ? SAVE_FIRST
        : nothingLeft
          ? live.length > 0
            ? NOTHING_LEFT
            : NO_PRICE
          : null;

  return (
    <Card data-card="trade-bid-invoices" data-bid-invoices>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
          Invoices
          {jobLabel && (
            <span className="text-sm font-normal tabular-nums text-muted-foreground" data-job-label>
              {jobLabel}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {invoices.length > 0 && (
          <ul className="divide-y rounded-md border">
            {invoices.map((inv) => (
              <InvoiceRow key={inv.id} inv={inv} />
            ))}
          </ul>
        )}
        <p className="text-sm" data-unbilled>
          {nothingLeft
            ? live.length > 0
              ? BILLED_IN_FULL
              : NO_PRICE
            : `Left to bill: ${fmtMoney(unbilled)}`}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            type="button"
            className="h-10"
            data-make-invoice
            disabled={reason !== null || make.isPending}
            onClick={() => make.mutate()}
          >
            {make.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            {live.length > 0 ? "Make another invoice" : "Make an invoice"}
          </Button>
          {/* A bid with no price says so on the line above: once is enough. */}
          {reason && reason !== NO_PRICE && (
            <p className="min-w-0 text-sm text-muted-foreground" data-make-invoice-reason>
              {reason}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
