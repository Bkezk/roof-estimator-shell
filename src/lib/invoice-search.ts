/**
 * /service/invoices search params (src/routes/service.invoices.tsx validateSearch). Pure, so the
 * parsing is tested without the route.
 *
 *   ?id=<invoice uuid>   that invoice on its own full-width page (owner, Oct 1: "the invoice is
 *                        cramped into a little dropdown and difficult to edit")
 *   ?tab=to-invoice      the list's "Awaiting invoice" queue (Authorized tickets, no final invoice)
 *   ?status=<status>     the list on one status chip (draft / final / sent / paid / void), or
 *                        "unpaid" = final + sent (the Owner view's Unpaid tile, Oct 8)
 *   ?from= ?to= ?q= ?sort=  the list's dates, search text and sort (Nov 3: Back keeps them)
 *
 * Anything else (a malformed id, an unknown tab) is dropped, so the list shows.
 */

export const INVOICE_LIST_STATUSES = ["draft", "final", "paid", "void", "unpaid"] as const;
export type InvoiceListStatus = (typeof INVOICE_LIST_STATUSES)[number];

/** The columns the list sorts by, as the URL spells them (`?sort=due:asc`). */
export const INVOICE_SORT_KEYS = [
  "number",
  "date",
  "customer",
  "property",
  "po",
  "job",
  "total",
  "status",
  "due",
  "sent",
] as const;
export type InvoiceSortKeyParam = (typeof INVOICE_SORT_KEYS)[number];

export interface InvoiceSearch {
  id?: string;
  tab?: "to-invoice";
  status?: InvoiceListStatus;
  /** Invoice date from / to (YYYY-MM-DD). */
  from?: string;
  to?: string;
  /** The search box, up to 120 characters. */
  q?: string;
  /** "<column>:<asc|desc>" (the list's own default, newest first, is left out). */
  sort?: `${InvoiceSortKeyParam}:${"asc" | "desc"}`;
}

/** The list's filters alone: what a row link carries and the editor's Back returns to. */
export type InvoiceListSearch = Omit<InvoiceSearch, "id">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const INVOICE_SEARCH_MAX = 120;

/**
 * Owner, Nov 3 (service review item 11): the status chip, the dates, the search text and the
 * sort live in the URL, like the Tickets list's filters since Oct 9, so opening an invoice and
 * pressing Back lands on the same list ("Unpaid → open → Mark paid → back" used to land on All).
 */
export function invoiceSearch(s: Record<string, unknown>): InvoiceSearch {
  const id = s["id"];
  const sort = typeof s["sort"] === "string" ? s["sort"].split(":") : [];
  const sortOk =
    sort.length === 2 &&
    (INVOICE_SORT_KEYS as readonly string[]).includes(sort[0]!) &&
    (sort[1] === "asc" || sort[1] === "desc");
  const q = typeof s["q"] === "string" ? s["q"].trim().slice(0, INVOICE_SEARCH_MAX) : "";
  return {
    ...(typeof id === "string" && UUID.test(id) ? { id } : {}),
    ...(s["tab"] === "to-invoice" ? { tab: "to-invoice" as const } : {}),
    ...(typeof s["status"] === "string" &&
    (INVOICE_LIST_STATUSES as readonly string[]).includes(s["status"])
      ? { status: s["status"] as InvoiceListStatus }
      : {}),
    ...(typeof s["from"] === "string" && YMD.test(s["from"]) ? { from: s["from"] } : {}),
    ...(typeof s["to"] === "string" && YMD.test(s["to"]) ? { to: s["to"] } : {}),
    ...(q ? { q } : {}),
    ...(sortOk
      ? { sort: `${sort[0]}:${sort[1]}` as `${InvoiceSortKeyParam}:${"asc" | "desc"}` }
      : {}),
  };
}

/** The filters without the invoice id (a row link adds `id`; the editor's Back drops it). */
export function invoiceListSearch(s: InvoiceSearch): InvoiceListSearch {
  const { id: _id, ...rest } = s;
  return rest;
}

/**
 * The tooltip of the "Awaiting invoice (N)" chip on the Invoices list and of the count on the
 * Invoices tab (owner, Oct 1, asked what "To invoice" meant): tickets at stage Authorized (M9,
 * owner Oct 5: a Done ticket is reviewed first), since finalising an invoice moves a ticket to
 * Invoiced.
 */
export const AWAITING_INVOICE_TITLE = "Tickets marked Authorized with no finalised invoice yet";
