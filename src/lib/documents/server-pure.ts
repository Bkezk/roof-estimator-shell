/**
 * The pure half of documents.functions.ts (owner, Oct 26: the CenterPoint-style document
 * generator — "they need to be able to edit it after its generated from the checkboxes"): file
 * names in the "documents" bucket, the share link, the stale-save message, what a saved bid's
 * sections look like to a document, the reserved variable the Pricing Table is rebuilt from,
 * and the small glue around generating. Nothing here touches the database, the request or the
 * clock (times come in). Tested in server-pure.test.ts.
 */
import { staleSavedAtText } from "@/lib/bid-stale-save";

import { type DocKind, type DocOptions, type DocPage, instantiatePages, newPage } from "./model";
import type { DocumentSource } from "./variables";

// ------------------------------------------------------------------------------- the bucket

/** The private bucket (migration 20261026150000): PDFs and pictures of documents. */
export const DOCUMENTS_BUCKET = "documents";
/** The ticket photos' bucket (a ticketPhoto image is read from there, never copied). */
export const SERVICE_BUCKET = "service";

/** Where a document's rendered PDF is stored: one file per version. */
export const documentPdfPath = (documentId: string, version: number) =>
  `docs/${documentId}/v${version}.pdf`;

/** Where a PDF library file (Insert PDF) is stored. */
export const documentAssetPath = (assetId: string) => `library/${assetId}.pdf`;

/** The folder a picture uploaded into a document (or a template) goes under. */
export function documentImageFolder(owner: {
  documentId?: string | null | undefined;
  templateId?: string | null | undefined;
}): string {
  if (owner.documentId) return `docs/${owner.documentId}`;
  if (owner.templateId) return `docs/template-${owner.templateId}`;
  throw new Error("A picture belongs to a document or a template");
}
export const documentImagePath = (
  owner: { documentId?: string | null | undefined; templateId?: string | null | undefined },
  fileId: string,
  ext: ImageType,
) => `${documentImageFolder(owner)}/${fileId}.${ext === "jpeg" ? "jpg" : ext}`;

/** A path documentImageUrl may sign: under docs/, no dot-segments. */
export const isDocumentImagePath = (path: string) =>
  /^docs\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(path);

export type ImageType = "jpeg" | "png" | "webp";
export const IMAGE_MIME: Record<ImageType, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
/** The picture's type from its first bytes (never from the file name, which the browser made up). */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}
/** Is this a PDF (the library accepts nothing else)? */
export const isPdfBytes = (bytes: Uint8Array) =>
  bytes.length > 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";

export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Bytes from the base64 a browser sent (a data: prefix is tolerated). */
export function bytesFromBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  return Uint8Array.from(Buffer.from(clean, "base64"));
}

/** The file a document downloads as: its title, safe for a file name, ".pdf". */
export function documentFileName(title: string): string {
  const stem =
    title
      .replace(/[–—]/g, "-")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Document";
  return `${stem}.pdf`;
}

// ---------------------------------------------------------------------------- the share link

/** The public path; the token follows it: /d/<token> (the invoice's is /i). */
export const DOCUMENT_SHARE_PATH = "/d";

/** The link a customer opens; `origin` without a trailing slash. */
export const documentShareUrl = (origin: string, token: string) =>
  `${origin.replace(/\/+$/, "")}${DOCUMENT_SHARE_PATH}/${token}`;

/**
 * The origin a server-made link starts with: APP_URL when set (the reminder emails' rule,
 * notify.server.ts appUrl), else the request's own host — so the link works on a preview too.
 */
export function shareOrigin(
  appUrl: string | null | undefined,
  headers: { get(name: string): string | null } | null | undefined,
  requestUrl?: string | null,
): string {
  const base = (appUrl ?? "").trim().replace(/\/+$/, "");
  if (base) return base;
  const host = headers?.get("x-forwarded-host") || headers?.get("host") || "";
  if (host) {
    const proto =
      headers?.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");
    return `${proto}://${host}`;
  }
  if (requestUrl) {
    try {
      return new URL(requestUrl).origin;
    } catch {
      /* not a URL */
    }
  }
  return "";
}

/** What a visitor reads when the link is not live (unknown, turned off, or the document is gone). */
export const DOCUMENT_SHARE_GONE_TEXT =
  "This document link is no longer active. Please contact the office.";

/** The small plain 404 page for a link that is not live (the invoice page's shape). */
export function documentShareGonePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Document link</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f7f9;color:#1f2937}main{max-width:28rem;padding:2rem;text-align:center}p{font-size:1.05rem;line-height:1.5}</style>
</head>
<body><main><p>${DOCUMENT_SHARE_GONE_TEXT}</p></main></body>
</html>
`;
}

export type DocumentShareLogOutcome =
  "served" | "malformed token" | "no active link" | "method not allowed" | "failed";

/** The route's one log line: the document's title when known and the outcome — never the token. */
export function documentShareLogLine(
  outcome: DocumentShareLogOutcome,
  title?: string | null,
  detail?: string,
) {
  const who = title ? `"${title}"` : "no document";
  return `Document share link: ${who} — ${outcome}${detail ? ` (${detail})` : ""}`;
}

// ------------------------------------------------------------------------------- saving

/**
 * The message a stale save gets (the bid's rule, bid-stale-save.ts, in the document's words):
 * the saver named, the time in the office's zone, and what to do. `me` is the saver's own name:
 * when the newer save was theirs it was another tab of theirs.
 */
export function documentStaleMessage(
  who: string | null | undefined,
  updatedAt: string,
  me?: string | null,
  now?: Date,
): string {
  const w = who?.trim() || "";
  const mine = !!w && !!me && w === me.trim();
  const saver = mine
    ? "you saved this document from another tab"
    : `${w || "someone"} saved this document`;
  return `Not saved: ${saver} at ${staleSavedAtText(updatedAt, now)} after you opened it. Reload it to see that save, then make your changes again.`;
}

/** The message a save into a deleted document gets; nothing is written. */
export function documentDeletedMessage(deletedAt: string, now?: Date): string {
  return `Not saved: this document was deleted at ${staleSavedAtText(deletedAt, now)}. Restore it from the Documents list, then save again — your changes are still here.`;
}

/** Is the saving tab's version the row's? (A save bumps version by one.) */
export const documentSaveIsStale = (expectVersion: number, rowVersion: number) =>
  expectVersion !== rowVersion;

/** Who a row shows as the last saver: the profile's name, else their email. */
export const displayName = (p: { full_name?: string | null; email?: string | null } | null) =>
  (p?.full_name ?? "").trim() || (p?.email ?? "").trim() || null;

/** The name a duplicated template gets. */
export const copyName = (name: string) => `${name.trim() || "Template"} (copy)`;

// ---------------------------------------------------------------------------- the record

/** What a document hangs off, checked: exactly one id and it matches the kind. */
export function recordProblem(input: {
  kind: DocKind;
  bidId?: string | null | undefined;
  serviceJobId?: string | null | undefined;
}): string | null {
  const bid = !!input.bidId;
  const job = !!input.serviceJobId;
  if (bid && job) return "A document belongs to a bid or a ticket, not both";
  if (input.kind === "bid" && !bid) return "A bid document needs its bid";
  if (input.kind === "ticket" && !job) return "A ticket document needs its ticket";
  return null;
}

/** The record's label in lists and titles: the bid's name, or "Ticket 6012". */
export function recordLabel(
  kind: DocKind,
  rec: { name?: string | null; number?: number | string | null } | null | undefined,
): string {
  if (kind === "bid") return (rec?.name ?? "").trim() || "Bid";
  return rec?.number !== null && rec?.number !== undefined && rec.number !== ""
    ? `Ticket ${rec.number}`
    : "Ticket";
}

/** Where the editor's Back goes: the bid in the estimator, or the ticket on Service. */
export function backTo(
  kind: DocKind,
  ids: { bidId: string | null; serviceJobId: string | null },
):
  | { to: "/estimate"; search: { bid: string } }
  | { to: "/service"; search: { id: string } }
  | { to: "/documents"; search: Record<string, never> } {
  if (kind === "bid" && ids.bidId) return { to: "/estimate", search: { bid: ids.bidId } };
  if (kind === "ticket" && ids.serviceJobId)
    return { to: "/service", search: { id: ids.serviceJobId } };
  return { to: "/documents", search: {} };
}

/** A new document's pages: the template's through the checkboxes; no template → one empty page. */
export function pagesForNewDocument(
  templatePages: readonly DocPage[] | null | undefined,
  options: DocOptions,
): DocPage[] {
  const pages = templatePages?.length ? instantiatePages(templatePages, options) : [];
  return pages.length ? pages : [newPage()];
}

// ------------------------------------------------------------------- the saved bid's sections

export type BidSection = DocumentSource["bid"] extends infer B
  ? B extends { sections: Array<infer S> }
    ? S
    : never
  : never;

/**
 * What a document knows of a bid from bids.data (a SavedBidState, proposal-bid.ts; read
 * leniently — a bid saved years ago must still make a document): the sections (name, length ×
 * width in feet, the membrane as "<roof system> <mil> mil"), their square feet, the roof system
 * line (with the mil when every section shares one), and the warranty's name.
 */
export function bidFromSavedState(
  data: unknown,
  row: { name: string; grand_total: number | null; due_date: string | null },
): NonNullable<DocumentSource["bid"]> {
  const s = (data ?? {}) as Record<string, unknown>;
  const roofSystem = typeof s["roofSystem"] === "string" ? s["roofSystem"].trim() : "";
  const raw = Array.isArray(s["sections"]) ? (s["sections"] as unknown[]) : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const sections: BidSection[] = raw.map((x, i) => {
    const sec = (x ?? {}) as Record<string, unknown>;
    const mil = num(sec["thickness"]);
    return {
      name: (typeof sec["name"] === "string" && sec["name"].trim()) || `Section ${i + 1}`,
      lengthFt: num(sec["length"]),
      widthFt: num(sec["width"]),
      system: [roofSystem, mil > 0 ? `${mil} mil` : ""].filter(Boolean).join(" "),
    };
  });
  const mils = new Set(raw.map((x) => num(((x ?? {}) as Record<string, unknown>)["thickness"])));
  const oneMil = mils.size === 1 ? [...mils][0]! : 0;
  const system = [roofSystem, oneMil > 0 ? `${oneMil} mil` : ""].filter(Boolean).join(" ");
  const sqFt = sections.reduce((a, x) => a + x.lengthFt * x.widthFt, 0);
  return {
    name: row.name,
    total: row.grand_total === null || !Number.isFinite(row.grand_total) ? null : row.grand_total,
    system,
    dueDate: row.due_date,
    sections,
    sqFt: sections.length ? sqFt : null,
    warranty: typeof s["warrantyName"] === "string" ? s["warrantyName"].trim() : "",
  };
}

// ------------------------------------------------------------- the reserved pricing variable

/**
 * documents.variables is the key → text map the editor and the PDF print, plus ONE reserved key,
 * `__sections`: the bid's sections and total as JSON, so the Pricing Table (variables.ts
 * pricingRows) can be rebuilt by the renderer and the editor without reading the bid again.
 * Reserved keys start with "__"; the Variables tab never lists them (displayVariables).
 */
export const SECTIONS_KEY = "__sections";
export const isReservedVariable = (key: string) => key.startsWith("__");

export interface StoredPricing {
  sections: BidSection[];
  total: number | null;
}

/** The variables map with the pricing stored under the reserved key (a ticket stores none). */
export function withStoredPricing(
  vars: Record<string, string>,
  bid: DocumentSource["bid"],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) if (!isReservedVariable(k)) out[k] = v;
  if (bid) {
    const stored: StoredPricing = { sections: bid.sections, total: bid.total };
    out[SECTIONS_KEY] = JSON.stringify(stored);
  }
  return out;
}

/** The pricing stored on a document, or null (a ticket document, an older row, garbage). */
export function storedPricing(vars: unknown): StoredPricing | null {
  if (!vars || typeof vars !== "object") return null;
  const raw = (vars as Record<string, unknown>)[SECTIONS_KEY];
  if (typeof raw !== "string") return null;
  try {
    const p = JSON.parse(raw) as { sections?: unknown; total?: unknown };
    const sections = Array.isArray(p.sections)
      ? p.sections
          .map((s) => s as Record<string, unknown>)
          .filter((s) => s && typeof s === "object")
          .map((s) => ({
            name: typeof s["name"] === "string" ? s["name"] : "",
            lengthFt: typeof s["lengthFt"] === "number" ? s["lengthFt"] : 0,
            widthFt: typeof s["widthFt"] === "number" ? s["widthFt"] : 0,
            system: typeof s["system"] === "string" ? s["system"] : "",
          }))
      : [];
    const total = typeof p.total === "number" && Number.isFinite(p.total) ? p.total : null;
    return { sections, total };
  } catch {
    return null;
  }
}

/** The `src` pricingRows wants, from a document's variables. */
export function pricingSource(vars: unknown): Pick<DocumentSource, "bid"> {
  const p = storedPricing(vars);
  return {
    bid: p
      ? {
          name: "",
          total: p.total,
          system: "",
          dueDate: null,
          sections: p.sections,
          sqFt: null,
          warranty: "",
        }
      : null,
  };
}

/** The variables the editor lists and the text prints: text values, no reserved keys. */
export function displayVariables(vars: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!vars || typeof vars !== "object") return out;
  for (const [k, v] of Object.entries(vars as Record<string, unknown>))
    if (!isReservedVariable(k) && typeof v === "string") out[k] = v;
  return out;
}

// -------------------------------------------------------------------------- the customer

/** The contact a document names: the first billing contact, else the first contact. */
export function pickContact<T extends { is_billing?: boolean | null }>(
  contacts: readonly T[],
): T | null {
  return contacts.find((c) => c.is_billing) ?? contacts[0] ?? null;
}

/** The ticket's purchase orders as one line: "4471, 4480". */
export const poLine = (
  pos: ReadonlyArray<{ po_number: string | null }>,
  fallback?: string | null,
) => {
  const nums = pos.map((p) => (p.po_number ?? "").trim()).filter(Boolean);
  return nums.length ? nums.join(", ") : (fallback ?? "").trim();
};

/** A profile as the Manager / Account Manager variables; the phone is the office's. */
export const personOf = (
  p: { full_name?: string | null; email?: string | null } | null | undefined,
  officePhone: string,
): DocumentSource["manager"] =>
  p ? { name: displayName(p) ?? "", email: (p.email ?? "").trim(), phone: officePhone } : null;
