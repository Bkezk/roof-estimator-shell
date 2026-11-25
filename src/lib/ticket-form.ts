/**
 * The ticket form's rules that are not layout (owner, Oct 1). A ticket names its site: a
 * customer with more than one live site must have one picked before the ticket is created or
 * saved (the form shows the message under the site box and keeps Create / Save off; the server,
 * saveServiceJob, refuses with the same text). A customer with exactly one site gets it picked
 * automatically.
 */

/** A ticket's description holds this many characters (saveServiceJob's schema). */
export const TICKET_DESCRIPTION_MAX = 500;

/** The line beside Create ticket: what stage a new ticket gets. */
export const TICKET_STAGE_HINT = "Scheduled once a technician is set, otherwise Open.";

export const siteRequiredMessage = (siteCount: number) =>
  `Pick the property — this customer has ${siteCount}`;

/** The problem with a ticket's site, or null. `siteCount` = the customer's live sites. */
export function siteProblem(input: {
  siteCount: number;
  site_id: string | null | undefined;
}): string | null {
  if (input.site_id) return null;
  return input.siteCount > 1 ? siteRequiredMessage(input.siteCount) : null;
}

/** The site to pick without asking: the only one, else none. */
export function autoSiteId(sites: readonly { id: string }[]): string | null {
  return sites.length === 1 ? sites[0]!.id : null;
}

/**
 * A ticket that is linked to a customer stays linked (owner, Nov 25: "go with solution A").
 * The customer can be changed to another one, never just taken off. On Nov 25 the form let
 * ticket 6069 be saved after "Change" was pressed and nobody picked: the ticket lost its
 * customer and its property and kept only the old name as text. The form refuses that save
 * and offers the customer back; saveServiceJob refuses it too, in the same words.
 *
 * A ticket from before customer profiles, with a typed name and no customer, is as it was.
 */
export const customerTakenOffMessage = (name: string | null | undefined): string => {
  const who = (name ?? "").trim();
  return who
    ? "Pick a customer before saving. " +
        who +
        " was taken off this ticket and no other customer was picked, so nothing was saved."
    : "Pick a customer before saving. The customer was taken off this ticket and no other was picked, so nothing was saved.";
};

/** The problem with a save that would leave a linked ticket with no customer, or null. */
export function customerTakenOffProblem(
  saved: { account_id: string | null | undefined; customer_name?: string | null },
  next: { account_id: string | null | undefined },
): string | null {
  return saved.account_id && !next.account_id ? customerTakenOffMessage(saved.customer_name) : null;
}

/** The link under the empty search box that puts the ticket's own customer back. */
export const keepCustomerLabel = (name: string | null | undefined): string =>
  "Keep " + ((name ?? "").trim() || "the customer it has");

/**
 * A ticket's customer and its invoice (the audit of Nov 25, 2026, number 19; owner: "go").
 *
 * An invoice keeps its own copy of whom it bills, the property and the tax rate, taken when it
 * is made. A ticket's customer could be changed afterwards and the invoice kept the old one:
 * the invoice page's heading and the Send window read the new customer, while the PDF, the
 * Invoices list and the totals were the old customer's, tax and all. Now:
 *
 *  - a final or paid invoice stops the change to another customer, in plain words;
 *  - a draft follows in the same save: its Bill To, property and tax rate are taken again from
 *    the new customer and it is totalled again (invoices.functions.ts ticketCustomerOnInvoices);
 *  - another property of the same customer: a draft's property follows, a final invoice is
 *    left as it was sent and the save says so;
 *  - someone who cannot work with invoices does not change the customer or the property of a
 *    ticket that has one.
 *
 * The screen says all of this before the save is sent; saveServiceJob holds the same rule.
 */

/** A ticket's live invoice, as much of it as this rule reads. */
export interface TicketInvoiceLike {
  /** The number people see ("6100", "6100.2"). */
  label: string;
  status: string;
}

/** What a save changes about whom the ticket is for and where. */
export interface TicketCustomerChange {
  /** Another customer than the saved one (a ticket never linked that now is counts too). */
  customer: boolean;
  /** Another property than the saved one. */
  property: boolean;
  /** The ticket was linked to a customer before this save. */
  hadCustomer: boolean;
}

/** Whether a save moves the ticket to another customer or property; null when it does neither. */
export function ticketCustomerChange(
  saved: { account_id: string | null | undefined; site_id: string | null | undefined },
  next: { account_id: string | null | undefined; site_id: string | null | undefined },
): TicketCustomerChange | null {
  // A customer taken off is refused before this is asked (customerTakenOffProblem).
  const customer = !!next.account_id && (saved.account_id ?? null) !== next.account_id;
  const property = (saved.site_id ?? null) !== (next.site_id ?? null);
  return customer || property ? { customer, property, hadCustomer: !!saved.account_id } : null;
}

/** An invoice that is no longer a draft: it went out, so it is not rewritten. */
const isIssued = (i: TicketInvoiceLike): boolean => i.status === "final" || i.status === "paid";

const listed = (labels: readonly string[]): string =>
  labels.length < 2
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

/**
 * Why the customer cannot be changed: an invoice of the ticket is already final or paid. Null
 * when the customer is not changing, the ticket was never linked to one (linking an old ticket
 * to its customer's profile is not a change of who is billed), or every invoice is a draft.
 */
export function invoiceStopsCustomerChange(
  change: TicketCustomerChange | null,
  invoices: readonly TicketInvoiceLike[],
): string | null {
  if (!change?.customer || !change.hadCustomer) return null;
  const issued = invoices.filter(isIssued);
  if (!issued.length) return null;
  const labels = issued.map((i) => i.label).filter(Boolean);
  const which = labels.length ? ` (invoice ${listed(labels)})` : "";
  return issued.length === 1
    ? `This ticket has an invoice that is already ${issued[0]!.status === "paid" ? "paid" : "final"}${which}. Make the invoice void first, then change the customer.`
    : `This ticket has invoices that are already final${which}. Make them void first, then change the customer.`;
}

/** Said to someone who cannot work with invoices, on a ticket that has one. */
export const CUSTOMER_CHANGE_NEEDS_INVOICES =
  "This ticket has an invoice, so its customer and property are changed by a manager or someone who works with invoices. Nothing was saved.";

/**
 * What the screen says under the customer before the save is sent: each draft that will follow
 * and each final invoice that will not. Empty when nothing about the invoices changes.
 */
export function customerChangeWarnings(
  change: TicketCustomerChange | null,
  invoices: readonly TicketInvoiceLike[],
): string[] {
  if (!change) return [];
  const live = invoices.filter((i) => i.status !== "void");
  const stop = invoiceStopsCustomerChange(change, live);
  if (stop) return [stop];
  const out: string[] = [];
  const drafts = live.filter((i) => i.status === "draft").map((i) => i.label);
  if (drafts.length)
    out.push(
      change.customer
        ? `Saving also changes draft invoice ${listed(drafts)}: it will bill the new customer, with that customer's tax.`
        : `Saving also changes draft invoice ${listed(drafts)}: it will show the new property.`,
    );
  const issued = live.filter(isIssued).map((i) => i.label);
  if (issued.length)
    out.push(
      `Invoice ${listed(issued)} is already final and will not be changed: it keeps what it was sent with.`,
    );
  return out;
}

/** After the save: what became of one draft invoice. */
export function draftFollowedLine(d: {
  label: string;
  /** Whom it bills now; null when its Bill To was left (a vendor's, or only the property changed). */
  billTo: string | null;
  /** Billed to a vendor: the customer's change does not reach its Bill To or its tax. */
  vendor: boolean;
  /** The property it shows now; null when the property did not change. */
  property: string | null;
  /** Its tax rate before and after, as the invoice prints them ("6%"). */
  taxFrom: string;
  taxTo: string;
}): string {
  const tax = d.taxFrom !== d.taxTo ? ` Its tax went from ${d.taxFrom} to ${d.taxTo}.` : "";
  const where = d.property ? ` Its property now reads ${d.property}.` : "";
  if (d.billTo) return `Draft invoice ${d.label} now bills ${d.billTo}.${tax}`;
  if (d.vendor)
    return `Draft invoice ${d.label} is billed to a vendor, so its Bill To was not changed.${where}`;
  return d.property
    ? `Draft invoice ${d.label} now shows the property ${d.property}.`
    : `Draft invoice ${d.label} was not changed.`;
}

/** After the save: a final invoice the change did not reach. */
export const issuedNotFollowedLine = (label: string): string =>
  `Invoice ${label} is already final and was not changed: it keeps what it was sent with.`;

/**
 * The ticket was saved and a draft was not: what to do about it. Putting the ticket back as it
 * was and saving is a change again, so the draft is taken again from what the ticket then has.
 */
export const draftNotFollowedMessage = (label: string, reason: string): string =>
  `The ticket was saved, but draft invoice ${label} could not be changed to match (${reason}). Put the ticket's customer and property back as they were, save, then make the change again.`;

/** A draft followed the ticket, but its Roof Care plan lines could not be worked again. */
export const planLinesNotCheckedLine = (label: string, reason: string): string =>
  `Draft invoice ${label}: the Roof Care plan's lines could not be checked (${reason}). Open the invoice and save it once.`;
