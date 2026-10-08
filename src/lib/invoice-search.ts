/**
 * /service/invoices search params (src/routes/service.invoices.tsx validateSearch). Pure, so the
 * parsing is tested without the route.
 *
 *   ?id=<invoice uuid>   that invoice on its own full-width page (owner, Oct 1: "the invoice is
 *                        cramped into a little dropdown and difficult to edit")
 *   ?tab=to-invoice      the list's "Awaiting invoice" queue (Done tickets with no final invoice)
 *   ?status=<status>     the list on one status chip (draft / final / sent / paid / void), or
 *                        "unpaid" = final + sent (the Owner view's Unpaid tile, Oct 8)
 *
 * Anything else (a malformed id, an unknown tab) is dropped, so the list shows.
 */

export const INVOICE_LIST_STATUSES = ["draft", "final", "sent", "paid", "void", "unpaid"] as const;
export type InvoiceListStatus = (typeof INVOICE_LIST_STATUSES)[number];

export interface InvoiceSearch {
  id?: string;
  tab?: "to-invoice";
  status?: InvoiceListStatus;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function invoiceSearch(s: Record<string, unknown>): InvoiceSearch {
  const id = s["id"];
  return {
    ...(typeof id === "string" && UUID.test(id) ? { id } : {}),
    ...(s["tab"] === "to-invoice" ? { tab: "to-invoice" as const } : {}),
    ...(typeof s["status"] === "string" &&
    (INVOICE_LIST_STATUSES as readonly string[]).includes(s["status"])
      ? { status: s["status"] as InvoiceListStatus }
      : {}),
  };
}

/**
 * The tooltip of the "Awaiting invoice (N)" chip on the Invoices list and of the count on the
 * Invoices tab (owner, Oct 1, asked what "To invoice" meant): tickets at stage Done, since
 * finalising an invoice moves a ticket to Invoiced.
 */
export const AWAITING_INVOICE_TITLE = "Tickets marked Done with no finalised invoice yet";
