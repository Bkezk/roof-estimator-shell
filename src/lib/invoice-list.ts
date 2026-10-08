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
