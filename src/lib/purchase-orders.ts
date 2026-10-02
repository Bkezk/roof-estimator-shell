/**
 * Purchase orders on a service ticket (owner, Oct 1: replacing CenterPoint, whose close-out
 * page has "PO Information"): material a crew bought for the job on the way (Lowe's, a supply
 * house). Date, PO # (typed, e.g. "Jbk24-0255"; never generated), Title, Price, Notes, the
 * receipt (an image or a PDF) and Approved? — approval is a manager's. The approved total is an
 * internal cost on one invoice of the ticket, its earliest live one (invoice-totals.ts
 * poCostForInvoice: cost and margin), never on the customer's invoice.
 *
 * Table: public.service_job_purchase_orders (migration 20261001100000_ticket_purchase_orders.sql).
 * Server functions: service-pos.functions.ts. UI: components/service/purchase-orders-section.tsx.
 *
 * Pure: no database, no server or browser imports (unit tested in purchase-orders.test.ts).
 */
import { canAccess, isOffice, managesTickets, type AccessLike } from "@/lib/access";

/** The fields every view of a PO needs (a subset of the table's Row). */
export interface PoLike {
  price: number | string;
  approved: boolean;
}

/** PO # length (the table's check: 1..60 after trim). */
export const PO_NUMBER_MAX = 60;
/** The "service" bucket's limit (20260927130000_service_field.sql: 26214400 bytes). */
export const RECEIPT_MAX_BYTES = 26_214_400;
/** What the "service" bucket accepts: photos of the receipt, or the store's PDF. */
export const RECEIPT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;

const cents = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** "$1,234.50". */
export const poMoney = (n: number) => USD.format(cents(n));

/**
 * Where a receipt goes in the private "service" bucket: <job id>/po-<time>-<random>.<ext>, the
 * photos' naming (service-field.functions.ts photoObjectPath) with a "po-" prefix so a receipt
 * is told apart at a glance. The extension comes from the file's name, lower case, letters and
 * digits only ("jpg" when there is none).
 */
export function receiptObjectName(
  jobId: string,
  fileName: string,
  now: number = Date.now(),
  random: () => number = Math.random,
): string {
  const ext =
    (fileName.includes(".") ? (fileName.split(".").pop() ?? "") : "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "jpg";
  return `${jobId}/po-${now}-${random().toString(36).slice(2, 8)}.${ext}`;
}

/** Is `path` a receipt object of this ticket (the only paths savePurchaseOrder accepts)? */
export const isReceiptPathFor = (jobId: string, path: string): boolean =>
  path.startsWith(`${jobId}/po-`) && !path.includes("..") && path.length <= 300;

const TYPE_BY_EXT: Record<string, (typeof RECEIPT_TYPES)[number]> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heic",
  pdf: "application/pdf",
};
/** The file's type; a phone that leaves it blank (HEIC often) gets it from the extension. */
export function receiptContentType(file: { name: string; type: string }): string {
  if (file.type) return file.type;
  const ext = file.name.includes(".") ? (file.name.split(".").pop() ?? "").toLowerCase() : "";
  return TYPE_BY_EXT[ext] ?? "";
}

/** Why a picked file cannot be a receipt, or null. */
export function receiptFileProblem(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!(RECEIPT_TYPES as readonly string[]).includes(receiptContentType(file)))
    return "A receipt is a photo (JPEG, PNG, WebP, HEIC) or a PDF";
  if (file.size > RECEIPT_MAX_BYTES) return "The receipt is over 25 MB";
  if (file.size <= 0) return "The receipt file is empty";
  return null;
}

/** Every PO of the ticket, approved or not. */
export const poTotal = (rows: readonly PoLike[]): number =>
  cents(rows.reduce((s, r) => s + num(r.price), 0));

/** Only the approved POs: the cost the invoice's Internal fold carries. */
export const approvedPoTotal = (rows: readonly PoLike[]): number =>
  cents(rows.filter((r) => r.approved).reduce((s, r) => s + num(r.price), 0));

/** The section's header: "2 · $412.00 · 1 awaiting approval" ("None" when there are none). */
export function poSummary(rows: readonly PoLike[]): string {
  if (!rows.length) return "None";
  const waiting = rows.filter((r) => !r.approved).length;
  const parts = [String(rows.length), poMoney(poTotal(rows))];
  if (waiting) parts.push(`${waiting} awaiting approval`);
  return parts.join(" · ");
}

/**
 * The Price box as typed: blank → null (the box starts blank — owner rule: never a placeholder
 * 0); "$1,234.5" → 1234.5. Anything else (letters, a negative) → NaN, which the form refuses.
 */
export function parsePrice(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (t === "") return null;
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return Number.NaN;
  return cents(Number(t));
}

export interface PoDraft {
  po_date: string;
  po_number: string;
  title: string;
  price: string;
  notes: string;
}

/** What is wrong with the form (the first thing), or null when it may be submitted. */
export function poFormProblem(d: PoDraft): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.po_date)) return "Pick the date";
  const no = d.po_number.trim();
  if (!no) return "Enter the PO #";
  if (no.length > PO_NUMBER_MAX) return `The PO # is at most ${PO_NUMBER_MAX} characters`;
  const price = parsePrice(d.price);
  if (price === null) return "Enter the price";
  if (Number.isNaN(price)) return "The price is a dollar amount, like 412.50";
  if (price > 9_999_999_999.99) return "The price is too large";
  return null;
}

/**
 * May this user add a PO to the ticket? Service access and working the ticket: the office
 * (anyone but a plain technician), its lead technician or a crew member. The twin of RLS
 * service_job_purchase_orders_insert.
 */
export function canAddPo(
  p: AccessLike | null | undefined,
  works: { lead: boolean; crew: boolean },
): boolean {
  return canAccess(p, "service") && (isOffice(p) || works.lead || works.crew);
}

/**
 * May this user edit or delete this PO? Admins and managers any; anyone else who may add one,
 * only their own and only while it is not approved (an approved PO is locked — the migration's
 * guard trigger refuses the same). The twin of RLS service_job_purchase_orders_update / _delete.
 */
export function canEditPo(
  p: AccessLike | null | undefined,
  userId: string | null | undefined,
  po: { created_by: string | null; approved: boolean },
  works: { lead: boolean; crew: boolean },
): boolean {
  if (!p) return false;
  if (managesTickets(p)) return true;
  if (!canAddPo(p, works)) return false;
  return !!userId && po.created_by === userId && !po.approved;
}

/** Who may approve (the Approved toggle): admins and managers. */
export const canApprovePo = (p: AccessLike | null | undefined): boolean => managesTickets(p);

/**
 * The PO # a new purchase order on a ticket starts with (owner, Oct 2): the ticket number, a
 * dot and the next unused letter — "6000.A", then "6000.B" … "6000.Z", "6000.AA". Letters
 * already used on the ticket are skipped, whatever their case or spacing; the person may
 * still type anything else. No ticket number → blank (the box is just empty).
 */
export function nextPoNumber(
  ticketNumber: number | string | null | undefined,
  existing: readonly string[],
): string {
  const n = ticketNumber === null || ticketNumber === undefined ? "" : String(ticketNumber).trim();
  if (!n) return "";
  const used = new Set(
    existing
      .map((x) => x.trim().toUpperCase())
      .filter((x) => x.startsWith(`${n}.`))
      .map((x) => x.slice(n.length + 1)),
  );
  for (let i = 0; i < 26 * 27; i++) {
    const letters = poLetters(i);
    if (!used.has(letters)) return `${n}.${letters}`;
  }
  return "";
}

/** 0 → "A" … 25 → "Z", 26 → "AA", 27 → "AB" … */
export function poLetters(i: number): string {
  const A = "A".charCodeAt(0);
  if (i < 26) return String.fromCharCode(A + i);
  const first = Math.floor(i / 26) - 1;
  return String.fromCharCode(A + first) + String.fromCharCode(A + (i % 26));
}

/** What a PO stores for the supplier typed in its Vendor box (owner, Oct 2): the text as typed,
 * plus the saved vendor's id only when the text is exactly a saved, unarchived vendor's name
 * (case and spacing aside). Never creates a vendor. Blank → nothing. */
export function vendorLink(
  text: string,
  vendors: readonly { id: string; name: string; archived_at?: string | null }[],
): { vendor_id: string | null; vendor_text: string | null } {
  const t = text.trim();
  if (!t) return { vendor_id: null, vendor_text: null };
  const key = t.toLowerCase().replace(/\s+/g, " ");
  const hit = vendors.find(
    (v) => !v.archived_at && v.name.trim().toLowerCase().replace(/\s+/g, " ") === key,
  );
  return { vendor_id: hit?.id ?? null, vendor_text: t.slice(0, 120) };
}
