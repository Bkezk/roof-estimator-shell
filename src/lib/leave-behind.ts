/**
 * The printed leave-behind (owner, Nov 25, 2026: "create the one sheeter with the qr codes for
 * the care plans and then another page for the additional services that i can print front and
 * back ... dont show pricing on it", then "plz put the design in the setup qr pages").
 *
 * One sheet of letter paper, printed on both sides, in the look of his own Roof Care flyer:
 *
 *   front  the three Roof Care plans and the code for /care
 *   back   the additional services and the code for /request
 *
 * What it says is never typed twice. The plans' lines are the public page's own
 * (roof-care-benefits.ts planIncludes) with the numbers the database holds today; the services
 * are the list saved on Setup › QR pages; the codes hold the saved web address. So a change to
 * a plan, to the list or to the address is on the next print with nothing to remember.
 *
 * No price is ever printed (owner, Nov 18; and of a "Priced to your roof" line on Nov 25: "its
 * unnecessary"). The minor repairs amounts stay: they say what a plan includes, not what it
 * costs (owner, Nov 25: "the repair amounts are fine to keep").
 *
 * Pure: words only. components/leave-behind-sheet.tsx draws them.
 */
import {
  PLAN_PITCH,
  PLAN_RECOMMENDED,
  planIncludes,
  type BenefitNumbers,
} from "@/lib/roof-care-benefits";
import { PLAN_KEYS, PLAN_NAMES, type PlanKey } from "@/lib/roof-care-price";

/** One line of a plan: its first words in bold, as on the flyer, then the rest. */
export interface SheetLine {
  bold: string;
  rest: string;
}
export interface SheetPlan {
  key: PlanKey;
  name: string;
  pitch: string;
  recommended: boolean;
  lines: SheetLine[];
}

/**
 * A plan's line as the sheet prints it: the public page's own line, a little shorter, because a
 * third of a sheet of paper is narrower than a phone. Nothing is added and no number changes.
 */
export function sheetLineText(line: string): string {
  let s = line
    .replace(/, spring and fall$/, "")
    .replace(/ after each one$/, "")
    .replace(", with no trip charge", ", no trip charge");
  // "A photo report …" reads "Photo report …", as on the flyer.
  if (/^A [a-z]/.test(s)) s = s.charAt(2).toUpperCase() + s.slice(3);
  return s;
}

/** The words the flyer sets in bold at the start of a line. Longest first. */
const BOLD_LEADS: readonly RegExp[] = [
  /^\d+ inspections?/,
  /^Drains and scuppers cleaned/,
  /^Gutters cleaned/,
  /^\$[\d,]+ of minor repairs/,
  /^Minor repairs/,
  /^Next-business-day leak response/,
  /^\d+ storm inspections?/,
  /^Storm inspection/,
];

export function sheetLine(line: string): SheetLine {
  const text = sheetLineText(line);
  for (const lead of BOLD_LEADS) {
    const m = lead.exec(text);
    if (m) return { bold: m[0], rest: text.slice(m[0].length) };
  }
  return { bold: "", rest: text };
}

/** The three plans, left to right. `numbers` null: the lines say it without a number. */
export function sheetPlans(numbers: BenefitNumbers | null): SheetPlan[] {
  return PLAN_KEYS.map((key) => ({
    key,
    name: PLAN_NAMES[key],
    pitch: PLAN_PITCH[key],
    recommended: key === PLAN_RECOMMENDED,
    lines: planIncludes(key, numbers ? numbers[key] : null).map(sheetLine),
  }));
}

export const SHEET_FRONT_TITLE = "Roof Care Plans.";
export const SHEET_FRONT_LEAD: readonly string[] = [
  "Two inspections a year, spring and fall, with a photo report after every visit.",
  "Pick the level of care that fits your building.",
];
/**
 * The small print under the plans: what the star and the dagger mean, then the rest. No roof
 * size is named for the custom quote: that number lives in the price settings and can change,
 * and the public page works it out for each roof.
 */
export const SHEET_FRONT_NOTE = {
  star: "Gutters that can be reached without a lift or other access equipment.",
  dagger: "Call us after the storm to ask for your inspection.",
  rest: "Minor repairs are valued at our standard rates, and an unused amount does not carry over to the next year. Very large roofs and customers with several buildings get a custom quote.",
} as const;
export const SHEET_FRONT_FOOT = {
  title: "Get your plan price",
  line: "Point your phone's camera at the code and type the building's address. You will see your price for all three plans.",
  cap: "Scan for your price",
} as const;

export const SHEET_BACK_TITLE = "Additional Services.";
export const SHEET_BACK_LEAD: readonly string[] = [
  "One call covers whatever your roof needs next.",
  "Tell us what is going on and we will call you back.",
];
export const SHEET_BACK_FOOT = {
  title: "Request service",
  line: "Point your phone's camera at the code and tell us what your roof needs. Or call us, and we will take it from there.",
  cap: "Scan to request service",
} as const;
export const SHEET_STEPS: readonly { bold: string; rest: string }[] = [
  { bold: "Scan the code", rest: "with your phone." },
  { bold: "Tell us what you need.", rest: "It takes about a minute." },
  { bold: "We call you back", rest: "to set up the visit." },
];

export interface SheetService {
  title: string;
  /** One line under it; empty for a service the office added that has no line here yet. */
  line: string;
}

/**
 * The starter services of the Request service form, as the sheet says them: a headline and one
 * line. Keyed by the saved name, in small letters. A service the office adds later prints under
 * its own saved name with no line, so nothing on the sheet is ever invented for it.
 */
const SERVICE_WORDS: Readonly<Record<string, SheetService>> = {
  "roof leak or repair": {
    title: "Roof leaks & repairs",
    line: "Leaks, punctures, open seams and flashing problems, found and fixed.",
  },
  "roof inspection": {
    title: "Roof inspections",
    line: "A full look at the roof, with a photo report and a list of what it needs.",
  },
  "roof replacement or new roof quote": {
    title: "Re-roofs & new roofs",
    line: "A quote for a full replacement, or for the roof on a new building or addition.",
  },
  "roof care maintenance plan": {
    title: "Roof Care plans",
    line: "Two inspections a year with the upkeep built in. See the other side of this sheet.",
  },
  "gutters and downspouts": {
    title: "Gutters & downspouts",
    line: "Cleaned, repaired or replaced, so water leaves the roof the way it should.",
  },
  "sheet metal and flashing": {
    title: "Sheet metal & flashing",
    line: "Coping, edge metal, counterflashing and custom metal work.",
  },
  "storm damage": {
    title: "Storm damage",
    line: "An inspection after wind or hail, with photos for your records.",
  },
  "something else": {
    title: "Something else",
    line: "Not sure what it needs? Tell us what you are seeing and we will take a look.",
  },
};

/** The most services the back of the sheet has room for. */
export const SHEET_SERVICES_MAX = 10;

/** The saved services as the back of the sheet prints them, in the saved order. */
export function sheetServices(saved: readonly string[]): SheetService[] {
  const seen = new Set<string>();
  const out: SheetService[] = [];
  for (const raw of saved) {
    const name = (raw ?? "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(SERVICE_WORDS[key] ?? { title: name, line: "" });
  }
  return out.slice(0, SHEET_SERVICES_MAX);
}

/** Said beside the sheet when the saved list is longer than the paper. */
export function sheetServicesLeftOut(saved: readonly string[]): string | null {
  const n = new Set(saved.map((s) => (s ?? "").trim().toLowerCase()).filter(Boolean)).size;
  return n > SHEET_SERVICES_MAX
    ? `The back of the sheet has room for ${SHEET_SERVICES_MAX} services. The last ${n - SHEET_SERVICES_MAX} on the list are not printed.`
    : null;
}

/** A fuller side is set smaller a step at a time, this many steps at most. */
export const SHEET_FIT_MAX = 3;
/** Said under the sheet when a side is still too full at its smallest. */
export const SHEET_TOO_FULL =
  "The sheet is too full to print whole: the last lines run off the paper. Shorten the services list or its names.";

export const SHEET_PRINT_BUTTON = "Print the sheet, front and back";
export const SHEET_PRINT_NOTE =
  "Letter paper, printed on both sides, flipped on the long edge. In the print window choose no margins if it asks, and leave headers and footers off. An office printer leaves a thin white edge round the colour.";
export const SHEET_NO_PRICE_NOTE =
  "No price is printed: the price shows on the customer's phone once they type their address.";
