/**
 * Which of a ticket's photos print on an invoice (owner, Oct 1: "the pictures should be able to
 * be added to the invoice"). Pure: the invoice editor's Photos fold (invoice-photos.tsx), the
 * server functions (invoice-photos.functions.ts) and the PDF (invoices.server.ts) share it.
 *
 * The choice is stored on the invoice (invoices.photo_ids uuid[], migration
 * 20261001120000_photo_annotations_invoice_photos.sql), so each invoice of a ticket ("6012",
 * "6012.2") keeps its own. Null = never chosen: the default, which is what printed before —
 * each printed repair's first Before and first After photo. The PDF puts a chosen photo of a
 * printed repair on that repair's Work Completed page (REPAIR_PAGE_PHOTOS at most, the rest
 * spill over), and every other chosen photo on a closing "Photos" page, two to a row.
 */

export interface PhotoLike {
  id: string;
  role: string;
  repair_id: string | null;
  created_at: string;
  storage_path: string;
}
export interface RepairLike {
  id: string;
  name: string;
  print_on_invoice: boolean;
}

/** A signature is never a "photo" on the invoice (it prints under the work). */
export const isInvoicePhoto = (p: { role: string }): boolean => p.role !== "signature";

/** How many photos fit beside a repair's text on its Work Completed page. */
export const REPAIR_PAGE_PHOTOS = 2;

const ROLE_ORDER: Record<string, number> = { before: 0, after: 1, other: 2, aerial: 3 };
const byRoleThenTime = (a: PhotoLike, b: PhotoLike) =>
  (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.created_at.localeCompare(b.created_at);
const byTime = (a: PhotoLike, b: PhotoLike) => a.created_at.localeCompare(b.created_at);

/** What prints when nobody has chosen: each printed repair's first Before and first After. */
export function defaultInvoicePhotoIds(repairs: RepairLike[], photos: PhotoLike[]): string[] {
  const sorted = [...photos].sort(byTime);
  const out: string[] = [];
  for (const r of repairs) {
    if (!r.print_on_invoice) continue;
    for (const role of ["before", "after"]) {
      const p = sorted.find((x) => x.repair_id === r.id && x.role === role);
      if (p) out.push(p.id);
    }
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The invoice's stored choice (invoices.photo_ids), or null when it has none. Read loosely: the
 * column is newer than the generated types, and anything that is not a list of ids is "none".
 */
export function storedPhotoIds(invoice: unknown): string[] | null {
  const v = (invoice as { photo_ids?: unknown } | null)?.photo_ids;
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string" && UUID.test(x));
}

/** The photos that print: the stored choice (still on the ticket) or the default. */
export function chosenPhotoIds(
  stored: string[] | null,
  repairs: RepairLike[],
  photos: PhotoLike[],
): string[] {
  if (stored === null) return defaultInvoicePhotoIds(repairs, photos);
  const ok = new Set(photos.filter(isInvoicePhoto).map((p) => p.id));
  return [...new Set(stored)].filter((id) => ok.has(id));
}

/**
 * Where each chosen photo prints: on its printed repair's page (before, after, other; at most
 * REPAIR_PAGE_PHOTOS), or on the closing Photos page (photos of no repair or of a repair not
 * printed, and a repair's overflow), oldest first.
 */
export function planInvoicePhotos<P extends PhotoLike>(
  chosen: string[],
  repairs: RepairLike[],
  photos: P[],
): { byRepair: Map<string, P[]>; extra: P[] } {
  const pick = new Set(chosen);
  const printed = new Set(repairs.filter((r) => r.print_on_invoice).map((r) => r.id));
  const picked = photos.filter((p) => pick.has(p.id) && isInvoicePhoto(p));
  const byRepair = new Map<string, P[]>();
  const spill: P[] = [];
  for (const r of repairs) {
    if (!printed.has(r.id)) continue;
    const mine = picked.filter((p) => p.repair_id === r.id).sort(byRoleThenTime);
    byRepair.set(r.id, mine.slice(0, REPAIR_PAGE_PHOTOS));
    spill.push(...mine.slice(REPAIR_PAGE_PHOTOS));
  }
  // Disjoint from the overflow: a photo of no repair, or of a repair that does not print.
  const loose = picked.filter((p) => !p.repair_id || !printed.has(p.repair_id));
  return { byRepair, extra: [...loose, ...spill].sort(byTime) };
}

const ROLE_LABEL: Record<string, string> = {
  before: "Before",
  after: "After",
  other: "Photo",
  aerial: "Aerial",
};
export const invoicePhotoRoleLabel = (role: string) => ROLE_LABEL[role] ?? "Photo";

/** The caption over a photo on the closing Photos page: "Before - Pipe boot" / "Photo". */
export function invoicePhotoCaption(p: PhotoLike, repairs: RepairLike[]): string {
  const r = p.repair_id ? repairs.find((x) => x.id === p.repair_id) : undefined;
  return r ? `${invoicePhotoRoleLabel(p.role)} - ${r.name}` : invoicePhotoRoleLabel(p.role);
}

/** "4 photos print" / "1 photo prints" / "no photos print". */
export function invoicePhotosSummary(n: number): string {
  return n === 0 ? "no photos print" : n === 1 ? "1 photo prints" : `${n} photos print`;
}
