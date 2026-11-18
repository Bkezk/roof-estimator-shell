/**
 * The second line of a row on a property's page (owner, Nov 18, with a picture of the page: "can
 * you include more detail on the tickets and bids and opps here on the property?"). He chose a
 * second, smaller line on each row, and for tickets "type, technician, dates" and "what was
 * found and done". No money is added to a ticket's row: technicians read these too.
 *
 *  ticket        Repair · Tyler Mitchell · done Oct 23
 *                Repairs: resealed the curb; replaced two drains · Notes: wants a quote on…
 *  opportunity   $18,000 · Referral · Mark Barger
 *                expected close Dec 5 · last contact Nov 12
 *  bid           Project bid · due Nov 30 · by Braden Keck
 *
 * Pure: the words only. The rows are read by getProperty (crm.functions.ts).
 */
import { flaggedItems, OUTCOME_LABELS, parseInspection } from "@/lib/inspection";
import { gist } from "@/lib/service-history";

const join = (parts: readonly (string | null | undefined | false)[]) =>
  parts.filter((p): p is string => !!p).join(" · ");

/**
 * "Oct 23", or "Oct 23, 2025" in another year. A plain day (YYYY-MM-DD) is that day wherever the
 * reader is; a moment is the reader's own day.
 */
export function rowDay(value: string | null | undefined, today: Date = new Date()): string {
  if (!value) return "";
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = plain
    ? new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]))
    : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

// ── Tickets ────────────────────────────────────────────────────────────────────────────────

const TYPE_WORDS: Record<string, string> = {
  repair: "Repair",
  warranty: "Warranty",
  inspection: "Inspection",
  other: "Other",
};
export const NOBODY_ASSIGNED = "Nobody assigned";

export interface TicketFactsIn {
  service_type?: string | null | undefined;
  completed_at?: string | null | undefined;
}
/** "Repair · Tyler Mitchell · done Oct 23": what kind, who, and when it was done. */
export function ticketFacts(
  job: TicketFactsIn,
  technicianName: string | null | undefined,
  today: Date = new Date(),
): string {
  const type = job.service_type ? (TYPE_WORDS[job.service_type] ?? job.service_type) : "";
  const done = rowDay(job.completed_at, today);
  return join([type, (technicianName ?? "").trim() || NOBODY_ASSIGNED, done && `done ${done}`]);
}

export interface TicketRepairIn {
  name?: string | null | undefined;
  resolution_text?: string | null | undefined;
}
export interface TicketWorkIn {
  service_type?: string | null | undefined;
  inspection?: unknown;
  inspection_outcome?: string | null | undefined;
  closing_notes?: string | null | undefined;
}
export interface RowPart {
  label: string;
  text: string;
}
/** How much of one repair's or the notes' first line is shown. */
const REPAIR_MAX = 90;
const NOTES_MAX = 200;

/**
 * What was found and done, in parts: "Found" (what the inspection flagged, or "no issues"),
 * "Outcome" (what the office chose after it), "Repairs" (what was done, repair by repair, else
 * the repair's name) and "Notes" (the closing notes' first line). A part with nothing is left out.
 */
export function ticketWork(job: TicketWorkIn, repairs: readonly TicketRepairIn[] = []): RowPart[] {
  const parts: RowPart[] = [];
  const ins = job.service_type === "inspection" ? parseInspection(job.inspection) : null;
  if (ins) {
    const flagged = flaggedItems(ins.items)
      .map((i) => i.label.trim())
      .filter(Boolean);
    parts.push({ label: "Found", text: flagged.length ? flagged.join(", ") : "no issues" });
  }
  const outcome = job.inspection_outcome as keyof typeof OUTCOME_LABELS | null | undefined;
  if (outcome && OUTCOME_LABELS[outcome])
    parts.push({ label: "Outcome", text: OUTCOME_LABELS[outcome] });
  const done = repairs
    .map((r) => gist(r.resolution_text, REPAIR_MAX) || gist(r.name, REPAIR_MAX))
    .filter(Boolean);
  if (done.length) parts.push({ label: "Repairs", text: done.join("; ") });
  const notes = gist(job.closing_notes, NOTES_MAX);
  if (notes) parts.push({ label: "Notes", text: notes });
  return parts;
}
/** The parts as one sentence, for the row's hover note: "Found: Seams · Notes: …". */
export const partsText = (parts: readonly RowPart[]): string =>
  parts.map((p) => `${p.label}: ${p.text}`).join(" · ");

// ── Opportunities ──────────────────────────────────────────────────────────────────────────

const dollars = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export interface OpportunityFactsIn {
  est_value?: number | string | null | undefined;
  lead_source?: string | null | undefined;
  assignee_name?: string | null | undefined;
  expected_close?: string | null | undefined;
  contacted_at?: string | null | undefined;
  referred_by?: string | null | undefined;
}
/** "$18,000 · Referral · Mark Barger": what it is worth, where it came from, who follows it up. */
export function opportunityFacts(o: OpportunityFactsIn): string {
  const value = Number(o.est_value);
  return join([
    Number.isFinite(value) && value > 0 && dollars(value),
    capital((o.lead_source ?? "").trim()),
    (o.assignee_name ?? "").trim() || "Unassigned",
  ]);
}
/** "expected close Dec 5 · last contact Nov 12 · brought in by Tyler": the dates and the credit. */
export function opportunityDates(o: OpportunityFactsIn, today: Date = new Date()): string {
  const close = rowDay(o.expected_close, today);
  const contact = rowDay(o.contacted_at, today);
  const by = (o.referred_by ?? "").trim();
  return join([
    close && `expected close ${close}`,
    contact ? `last contact ${contact}` : "not contacted yet",
    by && `brought in by ${by}`,
  ]);
}

// ── Bids ───────────────────────────────────────────────────────────────────────────────────

export interface BidFactsIn {
  kind?: string | null | undefined;
  trade_number?: number | string | null | undefined;
  due_date?: string | null | undefined;
  estimator_name?: string | null | undefined;
  updated_by_name?: string | null | undefined;
  submitted_at?: string | null | undefined;
  won_on?: string | null | undefined;
}
/**
 * "Project bid · due Nov 30 · by Braden Keck": which kind (a trade bid with its number), when it
 * is due, whose it is (the estimator, else whoever saved it last), and when it went out or was won.
 */
export function bidFacts(b: BidFactsIn, today: Date = new Date()): string {
  const trade = b.kind === "trade";
  const number = b.trade_number == null || b.trade_number === "" ? "" : ` T-${b.trade_number}`;
  const due = rowDay(b.due_date, today);
  const who = (b.estimator_name ?? "").trim() || (b.updated_by_name ?? "").trim();
  const won = rowDay(b.won_on, today);
  const sent = rowDay(b.submitted_at, today);
  return join([
    trade ? `Trade bid${number}` : "Project bid",
    due && `due ${due}`,
    who && `by ${who}`,
    won ? `won ${won}` : sent && `submitted ${sent}`,
  ]);
}
