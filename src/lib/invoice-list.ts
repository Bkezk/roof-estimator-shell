/**
 * The Invoices list's search (invoices-page.tsx). Pure, so it is tested without the page.
 *
 * One box, like CenterPoint's Invoices list (owner, Oct 8): the invoice number as shown, the
 * customer (or the vendor billed), the property, the customer's PO # and the Job #. Each word
 * must appear in one of them, in any order, ignoring case.
 */

export interface InvoiceSearchable {
  label: string;
  customer_name: string;
  site_name: string | null;
  po_number: string | null;
  job_code: string | null;
}

export function invoiceMatches(r: InvoiceSearchable, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [r.label, r.customer_name, r.site_name, r.po_number, r.job_code]
    .filter((v): v is string => !!v)
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The columns the list sorts by (a click on the heading; again reverses). */
export type InvoiceSortKey =
  "number" | "date" | "customer" | "property" | "po" | "job" | "total" | "status" | "due" | "sent";
export interface InvoiceSort {
  key: InvoiceSortKey;
  dir: "asc" | "desc";
}

export interface InvoiceSortable extends InvoiceSearchable {
  invoice_date: string;
  due_date?: string | null;
  total: number | string;
  status: string;
  sent_at: string | null;
}

/** An unpaid invoice with no due date is owed on receipt; it reads as late after this long. */
export const ON_RECEIPT_LATE_DAYS = 30;

export interface InvoiceDue {
  /** "Oct 14, 2026" as YYYY-MM-DD, or "On receipt" when the invoice carries no due date. */
  due: string | null;
  /** Whole days past the due date (or past the on-receipt allowance); 0 when not late. */
  lateDays: number;
  /** Final or sent, not paid, not void: the only rows that can be late. */
  open: boolean;
}

const dayNumber = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000;
};

/**
 * The list's Due column (owner, Nov 3, service review item 12): when the money is due and how
 * late it is. Only an open invoice (final or sent) can be late; a draft, a paid and a void row
 * show the date alone. `today` is the viewer's calendar day (YYYY-MM-DD).
 */
export function invoiceDue(
  r: { status: string; invoice_date: string; due_date?: string | null },
  today: string,
): InvoiceDue {
  // "sent" is the legacy spelling of a final invoice that was sent (statuses condensed Nov 9).
  const open = r.status === "final" || r.status === "sent";
  const due = r.due_date ?? null;
  if (!open) return { due, lateDays: 0, open };
  const by = due ? dayNumber(due) : dayNumber(r.invoice_date) + ON_RECEIPT_LATE_DAYS;
  const lateDays = Math.max(0, Math.round(dayNumber(today) - by));
  return { due, lateDays, open };
}

/** 4548 → [4548, 0]; 4548.2 → [4548, 2]; a legacy "22R CTSKY 3" has no number and sorts as text. */
function numberParts(label: string): [number, number] | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(label.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : null;
}

const text = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function value(r: InvoiceSortable, key: InvoiceSortKey): string | number | null {
  switch (key) {
    case "number":
      return r.label;
    case "date":
      return r.invoice_date;
    case "customer":
      return r.customer_name || null;
    case "property":
      return r.site_name || null;
    case "po":
      return r.po_number || null;
    case "job":
      return r.job_code || null;
    case "total":
      return Number(r.total) || 0;
    case "status":
      return r.status;
    case "due":
      return r.due_date ?? null;
    case "sent":
      return r.sent_at;
  }
}

/**
 * The rows in the chosen order, as a new array. Numbers sort as numbers (then their .2 / .3),
 * money as amounts, text ignoring case; blanks go last either way; ties keep the order given
 * (the server's newest first).
 */
export function sortInvoices<T extends InvoiceSortable>(
  rows: readonly T[],
  key: InvoiceSortKey,
  dir: "asc" | "desc",
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a, key);
    const vb = value(b, key);
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    if (key === "number") {
      const na = numberParts(String(va));
      const nb = numberParts(String(vb));
      if (na && nb) return sign * (na[0] - nb[0] || na[1] - nb[1]);
    }
    if (typeof va === "number" && typeof vb === "number") return sign * (va - vb);
    return sign * text.compare(String(va), String(vb));
  });
}
