/**
 * The Sage export's customer numbers (Nov 4; bugs 6 and 7 of the Nov 3 review).
 *
 * Each invoice's Bill To snapshot carries the Sage customer # (`external_id`) it was made with.
 * An invoice billed to a vendor had none (vendors carried no Sage number until Nov 4), and a
 * customer's number may have been typed after the invoice was made — so before the CSV is built,
 * a blank is filled from the vendor's or the customer's CURRENT number (fillSageIds), and what is
 * still blank is listed for the dialog's warning (missingSageIds): the office adds the number and
 * exports again, or downloads anyway and the bookkeeper fills the column in. Nothing is written
 * back to the invoice. Pure.
 */
import { invoiceLabel } from "@/lib/invoice-numbering";

export interface SageBillTo {
  name?: string;
  external_id?: string;
}

/** What fillSageIds needs of an invoice (invoices columns). */
export interface SageInvoice {
  id: string;
  number: number | null;
  display_number: string | null;
  service_job_id: string;
  bill_to_vendor_id: string | null;
  bill_to: unknown;
}

export interface SageLookups {
  /** vendor id → its Sage customer #. */
  vendorIds: ReadonlyMap<string, string | null | undefined>;
  /** ticket id → its customer's Sage customer #. */
  accountIdsByJob: ReadonlyMap<string, string | null | undefined>;
}

const clean = (s: string | null | undefined) => (s ?? "").trim();

/** The invoice with its Bill To's blank Sage # filled from the current records where one exists. */
export function fillSageIds<T extends SageInvoice>(
  invoices: readonly T[],
  lookups: SageLookups,
): T[] {
  return invoices.map((inv) => {
    const bt = (inv.bill_to ?? {}) as SageBillTo;
    if (clean(bt.external_id)) return inv;
    const current = inv.bill_to_vendor_id
      ? lookups.vendorIds.get(inv.bill_to_vendor_id)
      : lookups.accountIdsByJob.get(inv.service_job_id);
    if (!clean(current)) return inv;
    return { ...inv, bill_to: { ...bt, external_id: clean(current) } } as T;
  });
}

export interface MissingSageId {
  /** The invoice as the list names it ("6056", "6009.2"). */
  label: string;
  /** Who it is billed to. */
  bill_to: string;
  /** Whether that is a vendor (else the customer). */
  vendor: boolean;
}

/** The invoices whose CustomerId column would be blank, for the warning. */
export function missingSageIds(invoices: readonly SageInvoice[]): MissingSageId[] {
  return invoices
    .filter((inv) => !clean(((inv.bill_to ?? {}) as SageBillTo).external_id))
    .map((inv) => ({
      label: invoiceLabel(inv),
      bill_to: clean(((inv.bill_to ?? {}) as SageBillTo).name),
      vendor: !!inv.bill_to_vendor_id,
    }));
}

/** The toast after a download: how many were stamped now and how many kept an earlier date. */
export function exportedSummary(count: number, stamped: number): string {
  const kept = Math.max(0, count - stamped);
  const n = (k: number) => `${k} invoice${k === 1 ? "" : "s"}`;
  return kept
    ? `Exported ${n(count)} for Sage — ${stamped} stamped today, ${kept} exported before and ${kept === 1 ? "keeps its" : "keep their"} first date`
    : `Exported ${n(count)} for Sage`;
}
