/**
 * The Invoices list in status groups (owner, Nov 9: "like on bids where each status is a
 * collapsible row, the same for invoices … each row sorted by date"): Draft → Final → Paid →
 * Void, a group left out when empty, each one collapsible with the choice remembered per browser
 * (as the Project Bids page remembers its groups). The rows keep the list's order inside a
 * group — by date, newest first, unless a heading was clicked. Pure; the page is
 * components/service/invoices-page.tsx.
 */
import { asInvoiceStatus } from "@/components/service/invoice-utils";
import { INVOICE_STATUSES, type InvoiceStatus } from "@/lib/invoices.functions";

/** The groups' order on the page (the pipeline's: a draft becomes final, then paid; void aside). */
export const INVOICE_GROUP_ORDER: readonly InvoiceStatus[] = ["draft", "final", "paid", "void"];

export interface InvoiceGroup<T> {
  status: InvoiceStatus;
  rows: T[];
  /** The group's invoices' totals, summed (shown on the header; a void group's is struck). */
  total: number;
}

/** The rows split by status in INVOICE_GROUP_ORDER, keeping the order given; empty groups left out. */
export function groupInvoicesByStatus<T extends { status: string; total: number | string | null }>(
  rows: readonly T[],
): InvoiceGroup<T>[] {
  const by = new Map<InvoiceStatus, InvoiceGroup<T>>();
  for (const r of rows) {
    const status = asInvoiceStatus(r.status);
    const g = by.get(status) ?? { status, rows: [], total: 0 };
    g.rows.push(r);
    g.total += Number(r.total ?? 0) || 0;
    by.set(status, g);
  }
  return INVOICE_GROUP_ORDER.filter((s) => by.has(s)).map((s) => {
    const g = by.get(s)!;
    return { ...g, total: Math.round(g.total * 100) / 100 };
  });
}

/** Where the browser remembers which groups are collapsed. */
export const INVOICE_GROUPS_COLLAPSED_KEY = "jbk-portal:invoices-collapsed";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The collapsed groups as remembered; junk (bad JSON, unknown names, no storage) reads as none. */
export function readCollapsedInvoiceGroups(
  storage: StorageLike | null | undefined,
): InvoiceStatus[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(INVOICE_GROUPS_COLLAPSED_KEY) ?? "[]");
    return Array.isArray(raw) ? INVOICE_STATUSES.filter((s) => raw.includes(s)) : [];
  } catch {
    return [];
  }
}

export function writeCollapsedInvoiceGroups(
  storage: StorageLike | null | undefined,
  collapsed: readonly InvoiceStatus[],
): void {
  try {
    storage?.setItem(INVOICE_GROUPS_COLLAPSED_KEY, JSON.stringify(collapsed));
  } catch {
    // Storage unavailable (private mode, blocked site data): the collapse lasts this visit.
  }
}

/** The collapsed set with one group flipped. */
export const toggleCollapsedGroup = (
  collapsed: readonly InvoiceStatus[],
  status: InvoiceStatus,
): InvoiceStatus[] =>
  collapsed.includes(status) ? collapsed.filter((s) => s !== status) : [...collapsed, status];
