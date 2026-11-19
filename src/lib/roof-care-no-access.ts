/**
 * A visit we could not do because we could not get on the roof (owner, Nov 19: "10. Go."). Pure.
 *
 * The agreement's term 7: "The first visit in a plan year that we cannot do because we could not
 * get on the roof is rescheduled at no charge. After that, the return trip is charged at our
 * trip rate."
 *
 * On the ticket of a plan's inspection, No access records one: what happened, who, when. The
 * database counts them for the plan year and decides (roof_care_no_access): the first is free,
 * each one after it is charged the return trip, worked as travel is on a service invoice (the
 * hours of the plan's drive at the Service rates' travel rates). The inspection is also marked
 * as kept off by the customer, so a renewal treats it as theirs and not ours.
 *
 * A charge goes on that inspection's own invoice, as one line of its own, when the invoice is
 * made (it is made by itself when the inspection is authorized). The database lets a return
 * trip be on one invoice only. Until then the plan says "not invoiced yet".
 *
 * No amount lives here.
 */
import { longDay } from "@/lib/followup-rules";
import { allowanceMoney } from "@/lib/roof-care-allowance";
import type { PlanNoAccess } from "@/lib/roof-care-plan";

/** The `source` of a return trip's line on an invoice. */
export const TRIP_SOURCE_PREFIX = "roof-care-trip:";
export const tripLineSource = (noAccessId: string): string => `${TRIP_SOURCE_PREFIX}${noAccessId}`;
export const isTripLine = (l: { source?: string | null | undefined }): boolean =>
  !!l.source && l.source.startsWith(TRIP_SOURCE_PREFIX);

export const NO_ACCESS_LABEL = "No access";
export const NO_ACCESS_QUESTION = "Could not get on the roof?";
export const NO_ACCESS_TITLE = "We could not get on the roof";
export const NO_ACCESS_NOTE_LABEL = "What happened";
export const NO_ACCESS_NOTE_HINT = "Gate locked, nobody on site, no key to the roof hatch";
export const NO_ACCESS_NOTE_NEEDED = "Type what happened";
export const NO_ACCESS_RECORD = "Record no access";
export const NO_ACCESS_RECORDED = "No access recorded. The inspection stays open for a new day.";
export const NO_ACCESS_REMOVE = "Take off";

/** Where a ticket stands before No access is pressed: roof_care_no_access_preview(). */
export interface NoAccessPreview {
  plan_id: string;
  visit_id: string;
  /** How many are recorded for the plan year so far. */
  count: number;
  /** How many a plan year are free. */
  free: number;
  /** This one would be charged. */
  charged: boolean;
  /** What it would be charged: for the office only, and null when it cannot be worked out. */
  amount: number | null;
  /** The charge could be worked out (told to everyone, the amount is not). */
  amount_known: boolean;
}

const whole = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

/** The database's answer, read strictly: anything odd is "not known", never a guess. */
export function readNoAccessPreview(x: unknown): NoAccessPreview | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const count = whole(o["count"]);
  const free = whole(o["free"]);
  const plan = o["plan_id"];
  const visit = o["visit_id"];
  if (count == null || free == null || typeof o["charged"] !== "boolean") return null;
  if (typeof plan !== "string" || typeof visit !== "string") return null;
  const raw = o["amount"];
  const amount = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
  return {
    plan_id: plan,
    visit_id: visit,
    count,
    free,
    charged: o["charged"],
    amount,
    amount_known: o["amount_known"] === true,
  };
}

const nth = (n: number) => (n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : `${n}th`);

/**
 * What the box says before it is pressed: is this one free or charged. The office reads the
 * amount; a technician is told it is charged and that the customer can call the office for the
 * amount (owner, Nov 19, of money on the roof: "they can tell them to call the office").
 */
export function noAccessBefore(p: NoAccessPreview, office: boolean): string[] {
  const which = `This is the ${nth(p.count + 1)} time this plan year we could not get on the roof.`;
  if (!p.charged) {
    const left = p.free - p.count - 1;
    return [
      which,
      "The return trip is at no charge.",
      left > 0
        ? `${left} more this plan year ${left === 1 ? "is" : "are"} at no charge.`
        : "The next one is charged at our trip rate.",
    ];
  }
  if (!office)
    return [
      which,
      "The return trip is charged at our trip rate. The customer can call the office for the amount.",
    ];
  if (!p.amount_known || p.amount == null)
    return [
      which,
      "The return trip is charged, but the amount could not be worked out: the travel rates on the Service rates page are blank, or the plan has no drive time.",
      "Record it, then add the charge to this inspection's invoice by hand.",
    ];
  return [
    which,
    `The return trip is charged ${allowanceMoney(p.amount)}. It goes on this inspection's invoice.`,
  ];
}

/** After it is recorded: what the person is told. */
export function noAccessAfter(p: Pick<NoAccessPreview, "charged">): string {
  return `${NO_ACCESS_RECORDED} ${p.charged ? "The return trip is charged." : "The return trip is at no charge."}`;
}

/**
 * One record on the plan, for the office: "No access Nov 19, 2026: Gate locked (Tyler). Return
 * trip charged $…, on invoice #6071."
 */
export function noAccessLine(n: PlanNoAccess, showMoney: boolean): string {
  const head = `No access ${longDay(n.on)}: ${n.note.trim().replace(/[.\s]+$/, "")}${n.by_name ? ` (${n.by_name})` : ""}.`;
  if (!n.charged) return `${head} No charge.`;
  if (n.amount == null)
    return `${head} Return trip charged, but the amount could not be worked out. Add it to the inspection's invoice by hand.`;
  const what = showMoney
    ? `Return trip charged ${allowanceMoney(n.amount)}`
    : "Return trip charged";
  if (n.billed === null) return `${head} ${what}.`;
  return n.invoice
    ? `${head} ${what}, on invoice #${n.invoice.number}.`
    : `${head} ${what}, not invoiced yet. It goes on this inspection's invoice.`;
}

/** How many this plan year, and how many of them were charged. */
export function noAccessTally(list: readonly PlanNoAccess[]): {
  count: number;
  charged: number;
  words: string;
} {
  const charged = list.filter((n) => n.charged).length;
  return {
    count: list.length,
    charged,
    words:
      charged > 0
        ? `${list.length} this plan year, ${charged} charged`
        : `${list.length} this plan year, no charge`,
  };
}

/**
 * A charged return trip whose inspection is signed off with the charge on no invoice: the
 * office's to bill. Not one whose amount is not known to the reader.
 */
export function tripUnbilled(n: PlanNoAccess, ticketStage: string | null | undefined): boolean {
  return (
    n.charged &&
    n.billed === false &&
    !!ticketStage &&
    ["authorized", "invoiced", "closed"].includes(ticketStage)
  );
}

/** What the customer reads on the invoice line. */
export const tripLineWords = (on: string): string =>
  `Return trip: we could not get on the roof on ${longDay(on)}`;

/** A charged return trip, as the inspection's invoice builder needs it. */
export interface TripToBill {
  id: string;
  on: string;
  amount: number;
}

/** The line itself: listed on the customer's copy with its amount, not taxed, no cost. */
export function tripLine(t: TripToBill, sort: number) {
  const amount = Math.max(0, Math.round(t.amount * 100) / 100);
  return {
    sort,
    kind: "other",
    description: tripLineWords(t.on),
    qty: 1,
    unit: "ea",
    rate: amount,
    total: amount,
    cost_rate: 0,
    cost_total: 0,
    on_date: t.on,
    source: tripLineSource(t.id),
    // A service, as travel is: not taxed.
    taxable: false,
    rate_overridden: false,
    show_on_invoice: true,
    hide_price: false,
  };
}

export const roofCareNoAccessKey = (jobId: string) => ["roof-care-no-access", jobId] as const;
