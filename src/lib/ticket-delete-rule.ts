/**
 * A ticket with a live invoice is not deleted (owner, Nov 10, re-audit finding 3: "Deleted
 * tickets' invoices still count" — five of the seven live invoices sat on deleted tickets and
 * were still in the Invoices list, its footer and the Owner view's Unpaid tile). The invoice is
 * dealt with first: a draft is deleted, a final one is voided, and a payment is taken off before
 * that. Pure; deleteServiceJob (service.functions.ts) reads the ticket's invoices and asks here.
 */
import { hasPayment } from "@/lib/invoice-payment";

export interface TicketInvoice {
  status: string;
  /** The invoice's label as the screens print it ("6009", "6009.2"). */
  label: string;
  paid_amount: number | string | null;
  paid_on?: string | null;
}

/** Why the ticket cannot be deleted, in plain words — or null when it can. Void invoices do not count. */
export function ticketDeleteProblem(
  ticketNumber: number | string,
  invoices: readonly TicketInvoice[],
): string | null {
  const live = invoices.filter((i) => i.status !== "void");
  if (!live.length) return null;
  const names = live.map((i) => `#${i.label}`).join(", ");
  const what = live.length === 1 ? `invoice ${names}` : `${live.length} invoices (${names})`;
  const paid = live.some((i) => i.status === "paid" || hasPayment(i));
  const allDrafts = live.every((i) => i.status === "draft");
  const how = allDrafts
    ? `Delete the draft${live.length === 1 ? "" : "s"} from the ticket's Invoice card first.`
    : paid
      ? "Take the payment off (Edit payment, amount 0), void the invoice, then delete the ticket."
      : `Void ${live.length === 1 ? "it" : "them"} first, then delete the ticket.`;
  return `Ticket #${ticketNumber} has ${what}, so it cannot be deleted. ${how}`;
}
