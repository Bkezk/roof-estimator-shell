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

/** The groups on the page: the Awaiting invoice queue (Authorized tickets) and the four statuses. */
export type InvoiceGroupKey = "awaiting" | InvoiceStatus;
const GROUP_KEYS: readonly InvoiceGroupKey[] = ["awaiting", ...INVOICE_STATUSES];

/** Where the browser remembers which groups the user opened (owner, Nov 9: they start collapsed). */
export const INVOICE_GROUPS_OPEN_KEY = "jbk-portal:invoices-open";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The open groups as remembered; junk (bad JSON, unknown names, no storage) reads as none. */
export function readOpenInvoiceGroups(storage: StorageLike | null | undefined): InvoiceGroupKey[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(INVOICE_GROUPS_OPEN_KEY) ?? "[]");
    return Array.isArray(raw) ? GROUP_KEYS.filter((k) => raw.includes(k)) : [];
  } catch {
    return [];
  }
}

export function writeOpenInvoiceGroups(
  storage: StorageLike | null | undefined,
  open: readonly InvoiceGroupKey[],
): void {
  try {
    storage?.setItem(INVOICE_GROUPS_OPEN_KEY, JSON.stringify(open));
  } catch {
    // Storage unavailable (private mode, blocked site data): the choice lasts this visit.
  }
}

/** The open set with one group flipped. */
export const toggleOpenGroup = (
  open: readonly InvoiceGroupKey[],
  key: InvoiceGroupKey,
): InvoiceGroupKey[] => (open.includes(key) ? open.filter((k) => k !== key) : [...open, key]);

/**
 * Is a group open? Every group starts collapsed and opens when clicked (remembered); a group is
 * forced open when the list is narrowed to it — a status chip for its status, `?tab=to-invoice`
 * for Awaiting invoice — so a narrowed list never shows one collapsed header.
 */
export const isGroupOpen = (
  open: readonly InvoiceGroupKey[],
  key: InvoiceGroupKey,
  forced = false,
): boolean => forced || open.includes(key);
