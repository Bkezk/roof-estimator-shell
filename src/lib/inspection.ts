/**
 * Inspection tickets (owner, Sep 30). A ticket of type Inspection carries a checklist — the
 * admin's items (inspection_checklist_items, edited on Admin › Service Rates) each marked OK /
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
 * it"); nothing is created automatically.
 */
import { z } from "zod";

/** The starting checklist (seeded into inspection_checklist_items when the table is empty). */
export const DEFAULT_CHECKLIST = [
  "Membrane condition",
  "Seams",
  "Flashings",
  "Drains/scuppers",
  "Penetrations",
  "Parapets/coping",
  "Ponding",
  "Debris",
  "Sealants",
  "Recommend repairs",
] as const;

export const INSPECTION_STATUSES = ["ok", "issue", "na"] as const;
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
  saved_at: z.string().max(40).nullable().default(null),
  saved_by: z.string().max(200).nullable().default(null),
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
 * checklist item added since, unanswered. A new inspection is the checklist, unanswered.
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

export interface InspectionCounts {
  ok: number;
  issue: number;
  na: number;
  open: number;
}
export function inspectionCounts(items: readonly InspectionItem[]): InspectionCounts {
  const c: InspectionCounts = { ok: 0, issue: 0, na: 0, open: 0 };
  for (const i of items) {
    if (i.status) c[i.status]++;
    else c.open++;
  }
  return c;
}

/** "2 issues · 7 OK · 1 N/A · 3 not checked". */
export function inspectionSummary(items: readonly InspectionItem[]): string {
  const c = inspectionCounts(items);
  const parts = [
    c.issue ? `${c.issue} ${c.issue === 1 ? "issue" : "issues"}` : null,
    c.ok ? `${c.ok} OK` : null,
    c.na ? `${c.na} N/A` : null,
    c.open ? `${c.open} not checked` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "nothing to check";
}

/** Stages at which an inspection is complete (the tech has marked the ticket Done). */
export const COMPLETE_STAGES: readonly string[] = ["done", "invoiced", "closed"];
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
