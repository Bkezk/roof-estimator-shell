/**
 * Inspection tickets (owner, Sep 30). A ticket of type Inspection carries a checklist — the
 * admin's items (inspection_checklist_items, edited on Setup › Inspection checklist) each marked OK /
 * Issue / N/A with a note — plus general notes, stored as one JSON document on the ticket
 * (service_jobs.inspection). Pure: no I/O.
 *
 * Why one JSON column and not a table of answers: the answers are only ever read and written
 * together with their ticket, never queried across tickets; and each answer keeps the item's
 * label as it was when inspected, so renaming or removing a checklist item later never changes
 * an inspection already done.
 *
 * From a completed inspection the office may start a repair ticket or a bid (or nothing — "just
 * because we identify an issue doesn't mean they're going to move forward with us repairing
 * it"); nothing is created automatically. Since Oct 12 the choice is recorded on the ticket
 * (service_jobs.inspection_outcome: repair_ticket / bid / none; INSPECTION_OUTCOMES).
 *
 * Owner, Oct 12: the inspection close-out is its own flow (closeout-steps.ts
 * closeoutSteps("inspection")). The checklist is step 2 and must be saved; step 3 "Findings" is
 * ONE note (the ticket's closing_notes) with two switches — "Recommend repairs"
 * (`recommend_repairs`, kept in this JSON: it is an answer of the inspection, read and written
 * with the checklist) and "Recommend a new roof" (service_jobs.recommend_new_roof, as before),
 * and since Oct 26 the day the roof was inspected and its grade (`inspected_on`, `grade`). The
 * seed's "Recommend repairs" checklist row (20260930092000) stays in the live table — the screen
 * hides a row with that label (hiddenChecklistItem / visibleChecklist) so the question is asked
 * once, by the switch.
 *
 * Owner, Oct 26: "not every part needs a comment or status, just ones with problems". A row is
 * flagged (status "issue", with its note and pictures) or it is not; a row with no status reads
 * as OK (isFlagged / inspectionCounts). Nothing is "unanswered" any more: the only checklist gap
 * on Complete is a checklist never saved (closeout-check.ts). "ok" and "na" stay valid statuses —
 * older saves carry them, and a row can still be ticked OK or set N/A by hand.
 */
import { z } from "zod";

/**
 * The starting checklist: the 20260930092000 seed (inspection_checklist_items when the table was
 * empty) as 20261028131000 relabelled it (owner, Oct 28: "Flashings" → "Perimeter flashings",
 * "Gutters/downspouts" added between Drains/scuppers and Penetrations).
 */
export const DEFAULT_CHECKLIST = [
  "Membrane condition",
  "Seams",
  "Perimeter flashings",
  "Drains/scuppers",
  "Gutters/downspouts",
  "Penetrations",
  "Parapets/coping",
  "Ponding",
  "Debris",
  "Sealants",
  "Recommend repairs",
] as const;

export const INSPECTION_STATUSES = ["ok", "issue", "na"] as const;
/** The roof's grade on an inspection (CenterPoint's Property Grade). */
export const INSPECTION_GRADES = ["A", "B", "C", "D", "F"] as const;
export type InspectionGrade = (typeof INSPECTION_GRADES)[number];
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];
export const STATUS_LABELS: Record<InspectionStatus, string> = {
  ok: "OK",
  issue: "Issue",
  na: "N/A",
};

export const ITEM_LABEL_MAX = 80;
export const ITEM_NOTE_MAX = 1000;
export const NOTES_MAX = 10000;

export const inspectionItemSchema = z.object({
  /** The checklist item's id (inspection_checklist_items.id) the answer was given for. */
  id: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(ITEM_LABEL_MAX),
  status: z.enum(INSPECTION_STATUSES).nullable(),
  note: z.string().trim().max(ITEM_NOTE_MAX).default(""),
});
export type InspectionItem = z.output<typeof inspectionItemSchema>;

export const inspectionSchema = z.object({
  v: z.literal(1),
  items: z.array(inspectionItemSchema).max(100),
  notes: z.string().trim().max(NOTES_MAX).default(""),
  /** The findings step's "Recommend repairs" switch (owner, Oct 12); absent on older saves. */
  recommend_repairs: z.boolean().default(false),
  saved_at: z.string().max(40).nullable().default(null),
  saved_by: z.string().max(200).nullable().default(null),
  /**
   * The day the roof was inspected and its grade (CenterPoint's Property Inspected / Property
   * Grade; the document generator's variables, phase 2 — owner, Oct 26). Null on older saves.
   */
  inspected_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  grade: z.enum(INSPECTION_GRADES).nullable().default(null),
});
export type Inspection = z.output<typeof inspectionSchema>;

/** A stored inspection, or null when there is none (or it cannot be read). */
export function parseInspection(raw: unknown): Inspection | null {
  const r = inspectionSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export interface ChecklistItem {
  id: string;
  label: string;
  sort: number;
}

/**
 * The rows to show: the saved answers in their saved order (labels as they were), then any
 * checklist item added since, unflagged. A new inspection is the checklist, nothing flagged.
 */
export function mergeChecklist(
  saved: Inspection | null,
  checklist: readonly ChecklistItem[],
): InspectionItem[] {
  const sorted = [...checklist].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
  const fresh = (c: ChecklistItem): InspectionItem => ({
    id: c.id,
    label: c.label,
    status: null,
    note: "",
  });
  if (!saved) return sorted.map(fresh);
  const have = new Set(saved.items.map((i) => i.id));
  return [...saved.items, ...sorted.filter((c) => !have.has(c.id)).map(fresh)];
}

/**
 * The checklist row the switch replaced (owner, Oct 12): the seed's "Recommend repairs" item is
 * still in the live table, so a row with that label is hidden wherever the checklist shows and
 * never counts; the findings step's switch (`recommend_repairs`) asks it instead.
 */
export const RECOMMEND_REPAIRS_LABEL = "Recommend repairs";
export const hiddenChecklistItem = (label: string): boolean =>
  label.trim().toLowerCase() === RECOMMEND_REPAIRS_LABEL.toLowerCase();
/** The rows to show and to count: everything but the hidden "Recommend repairs" row. */
export function visibleChecklist<T extends { label: string }>(items: readonly T[]): T[] {
  return items.filter((i) => !hiddenChecklistItem(i.label));
}

/** A row with a problem (owner, Oct 26): status "issue". Every other row reads as OK or N/A. */
export const isFlagged = (item: { status: InspectionStatus | null }): boolean =>
  item.status === "issue";
/** "No issues" / "1 issue" / "3 issues" (the close-out's step aside). */
export const issueCountText = (n: number): string =>
  n === 0 ? "No issues" : `${n} ${n === 1 ? "issue" : "issues"}`;
/** The visible rows flagged as an issue. */
export function flaggedItems<T extends { label: string; status: InspectionStatus | null }>(
  items: readonly T[],
): T[] {
  return visibleChecklist(items).filter(isFlagged);
}

/**
 * Kept for callers written under the Oct 12 rule ("every item answered"): since Oct 26 a row
 * with no status reads as OK, so nothing is ever unanswered — always [] / 0.
 */
export function unansweredItems<T extends { label: string; status: InspectionStatus | null }>(
  _items: readonly T[],
): T[] {
  return [];
}
export function unansweredCount(_saved: Inspection | null, _checklist: readonly ChecklistItem[]) {
  return 0;
}

export interface InspectionCounts {
  ok: number;
  issue: number;
  na: number;
}
/** The counts under the checklist: a row with no status counts as OK (owner, Oct 26). */
export function inspectionCounts(
  items: readonly { status: InspectionStatus | null }[],
): InspectionCounts {
  const c: InspectionCounts = { ok: 0, issue: 0, na: 0 };
  for (const i of items) c[i.status ?? "ok"]++;
  return c;
}

/** "2 issues · 7 OK · 1 N/A"; with nothing flagged "No issues · 9 OK"; "nothing to check" on []. */
export function inspectionSummary(items: readonly { status: InspectionStatus | null }[]): string {
  if (items.length === 0) return "nothing to check";
  const c = inspectionCounts(items);
  const parts = [
    c.issue ? `${c.issue} ${c.issue === 1 ? "issue" : "issues"}` : "No issues",
    c.ok ? `${c.ok} OK` : null,
    c.na ? `${c.na} N/A` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Property Inspected / Property Grade as the screens hold and save them (owner, Oct 26). */
export interface InspectionDetails {
  /** YYYY-MM-DD on the technician's own calendar, or null when not given. */
  inspected_on: string | null;
  grade: InspectionGrade | null;
}

/** "Oct 20" from a YYYY-MM-DD read as a calendar day (never UTC's day). */
export function shortInspectedDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The saved line's tail: "Inspected Oct 20 · Grade D", either half alone, or null when neither
 * is set (the line then says only the counts and the save).
 */
export function inspectedLine(d: InspectionDetails): string | null {
  const parts = [
    d.inspected_on ? `Inspected ${shortInspectedDay(d.inspected_on)}` : null,
    d.grade ? `Grade ${d.grade}` : null,
  ].filter((x): x is string => x !== null);
  return parts.length ? parts.join(" · ") : null;
}

/** What the screens edit (inspection-draft.ts) and the autosave sends. */
export interface InspectionDraftFields extends InspectionDetails {
  items: InspectionItem[];
  recommend_repairs: boolean;
}
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const asInspectionGrade = (v: unknown): InspectionGrade | null =>
  (INSPECTION_GRADES as readonly unknown[]).includes(v) ? (v as InspectionGrade) : null;
/**
 * The draft as saveTicketInspection takes it: notes trimmed, a blank date ("" from the date
 * input) sent as null, a grade outside A–F as null.
 */
export function inspectionPayload(d: InspectionDraftFields): InspectionDraftFields {
  return {
    items: d.items.map((i) => ({ ...i, note: i.note.trim() })),
    recommend_repairs: d.recommend_repairs,
    inspected_on: d.inspected_on && YMD.test(d.inspected_on) ? d.inspected_on : null,
    grade: asInspectionGrade(d.grade),
  };
}

/**
 * A photo row as the checklist's pictures read it (service_job_photos). `item_keys` is every
 * checklist item the photo is on (service_job_photo_items, Oct 28: one photo on several items;
 * listJobPhotos fills it); `item_key` is the first of them, kept for older rows and readers. A
 * row that came without `item_keys` (an older JSON, a row another save wrote back into the list)
 * reads its one item from `item_key`.
 */
export interface ItemPhotoLike {
  role: string;
  repair_id: string | null;
  item_key: string | null;
  item_keys?: readonly string[] | undefined;
}
/** Every checklist item a photo is on: `item_keys` when the row carries it, else its `item_key`. */
export function photoItemKeys(p: {
  item_key: string | null;
  item_keys?: readonly string[] | undefined;
}): string[] {
  if (p.item_keys) return [...p.item_keys];
  return p.item_key ? [p.item_key] : [];
}
/** A ticket picture: role "other", on no repair (the signature, an aerial and a repair's are not). */
export const isTicketPicture = (p: { role: string; repair_id: string | null }) =>
  p.role === "other" && !p.repair_id;
/** Is this ticket picture on the checklist item? */
export function isPhotoOnItem(p: ItemPhotoLike, itemKey: string): boolean {
  return isTicketPicture(p) && photoItemKeys(p).includes(itemKey);
}
/** The ticket pictures on one checklist item, in list order. */
export function photosOnItem<T extends ItemPhotoLike>(photos: readonly T[], itemKey: string): T[] {
  return photos.filter((p) => isPhotoOnItem(p, itemKey));
}
/**
 * The ticket's photos on no checklist item at all (the findings roll, "Other photos"): ticket
 * pictures — role "other", on no repair — with no link. A repair's Before / After, the signature
 * and an aerial are never counted.
 */
export function unattachedTicketPhotos<T extends ItemPhotoLike>(photos: readonly T[]): T[] {
  return photos.filter((p) => isTicketPicture(p) && photoItemKeys(p).length === 0);
}
/**
 * The ticket's photos the "From ticket photos" picker offers for a checklist item (owner, Oct
 * 26; Oct 28: one photo may be on several items): every ticket picture not already on THIS item
 * — the ones on another item too, marked "also on …" (alsoOnText). A repair's Before / After,
 * the signature and an aerial are not offered.
 */
export function attachableTicketPhotos<T extends ItemPhotoLike>(
  photos: readonly T[],
  itemKey: string,
): T[] {
  return photos.filter((p) => isTicketPicture(p) && !photoItemKeys(p).includes(itemKey));
}
/** The item keys with `itemKey` added at the end (attach) or taken out (detach); no repeats. */
export function toggleItemKey(keys: readonly string[], itemKey: string, on: boolean): string[] {
  const rest = keys.filter((k, i) => k !== itemKey && keys.indexOf(k) === i);
  return on ? [...rest, itemKey] : rest;
}
/**
 * The primary item (service_job_photos.item_key) for a set of links: the current one while it is
 * still in the set, else the first of the set, else null — the database trigger's rule
 * (20261028130000 photo_item_links_sync_primary).
 */
export function primaryItemKey(current: string | null, keys: readonly string[]): string | null {
  if (current && keys.includes(current)) return current;
  return keys[0] ?? null;
}
/**
 * The labels of the OTHER checklist items a photo is on (not `itemKey`), in checklist order; an
 * item no longer on the checklist is left out.
 */
export function otherItemLabels(
  p: ItemPhotoLike,
  itemKey: string,
  items: ReadonlyArray<{ id: string; label: string }>,
): string[] {
  const keys = photoItemKeys(p).filter((k) => k !== itemKey);
  return items.filter((i) => keys.includes(i.id)).map((i) => i.label);
}
/** "also on Seams", "also on Seams and Debris", "also on Seams, Drains and Debris"; "" for none. */
export function alsoOnText(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return `also on ${labels[0]}`;
  return `also on ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
/**
 * Photo rows with their links folded in (listJobPhotos): `item_keys` = the photo's links in the
 * order given (the server orders them earliest first); a photo with none gets [].
 */
export function withItemKeys<T extends { id: string }>(
  photos: readonly T[],
  links: ReadonlyArray<{ photo_id: string; item_key: string }>,
): Array<T & { item_keys: string[] }> {
  const by = new Map<string, string[]>();
  for (const l of links) {
    const list = by.get(l.photo_id) ?? [];
    if (!list.includes(l.item_key)) list.push(l.item_key);
    by.set(l.photo_id, list);
  }
  return photos.map((p) => ({ ...p, item_keys: by.get(p.id) ?? [] }));
}

/**
 * What the Findings step recommends, as the folded step and the Done notice say it: "repairs",
 * "a new roof", "repairs and a new roof", or null when neither switch is on.
 */
export function recommendationText(rec: {
  recommend_repairs: boolean;
  recommend_new_roof: boolean;
}): string | null {
  const parts = [
    rec.recommend_repairs ? "repairs" : null,
    rec.recommend_new_roof ? "a new roof" : null,
  ].filter((x): x is string => x !== null);
  return parts.length ? parts.join(" and ") : null;
}

/**
 * The Done notice for an inspection (ticket-events.server.ts; owner, Oct 12): "Inspection #6012
 * Acme is done — 2 issues found, recommends repairs — ready for your review". With no saved
 * checklist (null) the counts are left out: "Inspection #6012 Acme is done — ready for your
 * review".
 */
export function inspectionDoneTitle(
  number: number,
  customer: string,
  ins: Pick<Inspection, "items" | "recommend_repairs"> | null,
  recommendNewRoof: boolean,
): string {
  const head = `Inspection #${number} ${customer} is done`;
  const tail = "ready for your review";
  if (!ins) return `${head} — ${tail}`;
  const c = inspectionCounts(visibleChecklist(ins.items));
  const found = `${c.issue} ${c.issue === 1 ? "issue" : "issues"} found`;
  const rec = recommendationText({
    recommend_repairs: ins.recommend_repairs,
    recommend_new_roof: recommendNewRoof,
  });
  return `${head} — ${found}${rec ? `, recommends ${rec}` : ""} — ${tail}`;
}

/** What the office chose after the inspection (service_jobs.inspection_outcome). */
export const INSPECTION_OUTCOMES = ["repair_ticket", "bid", "none"] as const;
export type InspectionOutcome = (typeof INSPECTION_OUTCOMES)[number];
export const OUTCOME_LABELS: Record<InspectionOutcome, string> = {
  repair_ticket: "Repair ticket",
  bid: "Bid",
  none: "No action needed",
};
/**
 * "Outcome: Repair ticket #6013 — by Mo Manager, Oct 12" (the After the inspection panel).
 * `detail` names the ticket ("#6013") or the bid; `by` and `when` are left out when unknown.
 */
export function outcomeLine(o: {
  outcome: InspectionOutcome;
  detail?: string | null | undefined;
  by?: string | null | undefined;
  when?: string | null | undefined;
}): string {
  const what = `${OUTCOME_LABELS[o.outcome]}${o.detail ? ` ${o.detail}` : ""}`;
  const who = [o.by ? `by ${o.by}` : null, o.when ?? null].filter(Boolean).join(", ");
  return `Outcome: ${what}${who ? ` — ${who}` : ""}`;
}

/** Stages at which an inspection is complete (the tech has marked the ticket Done). */
export const COMPLETE_STAGES: readonly string[] = ["done", "authorized", "invoiced", "closed"];
export const inspectionComplete = (stage: string): boolean => COMPLETE_STAGES.includes(stage);

/** The ticket description's limit (service.functions jobSchema). */
export const DESCRIPTION_MAX = 500;

const clip = (s: string, max: number) =>
  s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * A repair ticket's prefilled text from an inspection: the description names the Issue items
 * (with their notes) on one line, clipped to the ticket's 500 characters; the notes carry the
 * full list and the inspection's general notes.
 */
export function repairTicketText(
  inspectionNumber: number,
  ins: Pick<Inspection, "items" | "notes">,
): { description: string; notes: string } {
  const issues = ins.items.filter((i) => i.status === "issue");
  const head = `From inspection #${inspectionNumber}`;
  const list = issues.map((i) => (i.note ? `${i.label} — ${oneLine(i.note)}` : i.label));
  const description = clip(
    list.length
      ? `${head}: ${list.join("; ")}`
      : ins.notes.trim()
        ? `${head}: ${oneLine(ins.notes)}`
        : head,
    DESCRIPTION_MAX,
  );
  const lines: string[] = [];
  if (issues.length) {
    lines.push(`Issues found on inspection #${inspectionNumber}:`);
    for (const i of issues) lines.push(`- ${i.label}${i.note ? `: ${i.note.trim()}` : ""}`);
  }
  if (ins.notes.trim()) {
    if (lines.length) lines.push("");
    lines.push("Inspection notes:", ins.notes.trim());
  }
  return { description, notes: clip(lines.join("\n"), NOTES_MAX) };
}

/** The ticket and site fields a bid is prefilled from. */
export interface BidSource {
  number: number;
  customer_name: string;
  account_id: string | null;
  site_id: string | null;
  site_name: string | null;
  site: {
    address1: string | null;
    address2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
}

/** /estimate's URL prefill for a NEW bid (src/lib/estimate-search.ts). */
export interface BidPrefill {
  pfName: string;
  pfOwner?: string;
  pfAddr?: string;
  pfAddr2?: string;
  pfCity?: string;
  pfState?: string;
  pfZip?: string;
  pfAccount?: string;
  pfSite?: string;
  pfNotes?: string;
}

/** Estimator notes stay short enough for a URL. */
export const BID_NOTES_MAX = 1500;

/**
 * "Create bid" from an inspection: the customer (linked profile and site), the job-site address
 * and the inspection's findings as the bid's notes. Only non-empty values are passed.
 */
export function bidPrefillFromInspection(
  src: BidSource,
  ins: Pick<Inspection, "items" | "notes">,
): BidPrefill {
  const { notes } = repairTicketText(src.number, ins);
  const name = [src.site_name, src.customer_name].filter((s) => s && s.trim()).join(" — ");
  const out: BidPrefill = { pfName: name || `Inspection #${src.number}` };
  const put = (k: Exclude<keyof BidPrefill, "pfName">, v: string | null | undefined) => {
    const t = (v ?? "").trim();
    if (t) out[k] = t;
  };
  put("pfOwner", src.customer_name);
  put("pfAddr", src.site?.address1);
  put("pfAddr2", src.site?.address2);
  put("pfCity", src.site?.city);
  put("pfState", src.site?.state);
  put("pfZip", src.site?.zip);
  put("pfAccount", src.account_id);
  put("pfSite", src.account_id ? src.site_id : null);
  put(
    "pfNotes",
    notes ? clip(notes, BID_NOTES_MAX) : `From inspection #${src.number}: no issues recorded.`,
  );
  return out;
}

/** "From inspection #6012" on a ticket created from one. */
export const fromInspectionLabel = (n: number): string => `From inspection #${n}`;
