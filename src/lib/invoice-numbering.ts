/**
 * Invoice numbers (owner, Sep 30): the ticket number is the invoice number. A ticket's first
 * live invoice is "6012"; further live invoices on it take the lowest free slot — "6012.2",
 * "6012.3", … A deleted or voided invoice frees its slot, so the next invoice made for the ticket
 * takes it again (slot 1 is the bare number). Pure; the server allocates with it inside the
 * create path (invoices.functions.ts) and the live-unique index on invoices.display_number
 * catches a race.
 *
 * Invoices made before this keep their integer `number` (display_number NULL); a live one of
 * those whose number is the ticket number holds slot 1.
 */

/** What decides a slot: the shown number, or a legacy invoice's integer. */
export interface NumberedInvoice {
  display_number?: string | null;
  number?: number | null;
  status?: string | null;
}

/** Slot 1 is the bare ticket number; slot n ≥ 2 is "<ticket>.<n>". */
export function slotLabel(ticket: number, slot: number): string {
  if (!Number.isInteger(slot) || slot < 1) throw new Error(`Bad invoice slot ${slot}`);
  return slot === 1 ? String(ticket) : `${ticket}.${slot}`;
}

/** The slot a shown number holds on this ticket, or null when it is not one of the ticket's. */
export function slotOf(ticket: number, display: string): number | null {
  const s = display.trim();
  if (s === String(ticket)) return 1;
  const m = /^(\d+)\.(\d+)$/.exec(s);
  if (!m || Number(m[1]) !== ticket) return null;
  const n = Number(m[2]);
  return n >= 2 ? n : null;
}

/** The slot an invoice holds on the ticket (null: none — voided, or not this ticket's number). */
function heldSlot(ticket: number, inv: NumberedInvoice): number | null {
  if (inv.status === "void") return null;
  if (inv.display_number) return slotOf(ticket, inv.display_number);
  if (inv.number != null && inv.number === ticket) return 1;
  return null;
}

/**
 * The number for a new invoice on ticket `ticket`, given the ticket's invoices (voided ones
 * and other tickets' numbers are ignored): the lowest slot no live invoice holds.
 */
export function nextInvoiceNumber(ticket: number, invoices: readonly NumberedInvoice[]): string {
  const taken = new Set<number>();
  for (const inv of invoices) {
    const s = heldSlot(ticket, inv);
    if (s != null) taken.add(s);
  }
  let slot = 1;
  while (taken.has(slot)) slot++;
  return slotLabel(ticket, slot);
}

/**
 * The invoice number as people see it: the display number when set, else the legacy integer
 * (a voided legacy invoice stores its number negated; the original shows).
 */
export function invoiceLabel(inv: NumberedInvoice): string {
  if (inv.display_number) return inv.display_number;
  if (inv.number != null) return String(Math.abs(inv.number));
  return "";
}

/** A file-name-safe form of the label ("6012.2" stays; anything odd becomes "-"). */
export function invoiceFileStem(inv: NumberedInvoice): string {
  return invoiceLabel(inv).replace(/[^0-9A-Za-z.-]/g, "-") || "invoice";
}
