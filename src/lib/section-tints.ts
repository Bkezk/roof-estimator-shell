/**
 * The coloured ground behind each section of a customer's page and a property's page (owner,
 * Oct 21: "add color to the boxes for contacts, properties, tickets etc. — keep the actual
 * contact boxes with info in them white and the add contact button white but give the
 * background they sit on color"). One hue per kind of thing, the same on both pages, so a
 * Tickets section looks like a Tickets section wherever it is. The rows and cards inside keep
 * the card colour (INNER_BOX), and the outline buttons already stand on it.
 *
 * A `-100` wash with a `-300` edge (owner, Oct 21: "a tad more vibrant — contacts almost blends
 * into the background"; the `-50` washes did). Every tint carries its dark-mode pair (a deep,
 * translucent wash on the charcoal page), which is also what lets the dark-mode scan
 * (dark-mode.test.ts) accept the fixed light colours.
 */
export const SECTION_TINTS = {
  contacts: "border-sky-300 bg-sky-100 dark:border-sky-800 dark:bg-sky-950/60",
  properties: "border-emerald-300 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60",
  tickets: "border-amber-300 bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60",
  opportunities: "border-violet-300 bg-violet-100 dark:border-violet-800 dark:bg-violet-950/60",
  tasks: "border-teal-300 bg-teal-100 dark:border-teal-800 dark:bg-teal-950/60",
  takeoffs: "border-indigo-300 bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60",
  bids: "border-orange-300 bg-orange-100 dark:border-orange-800 dark:bg-orange-950/60",
} as const;

export type TintedSection = keyof typeof SECTION_TINTS;

/** The section card's classes: the shared frame plus its tint. */
export const sectionClass = (section: TintedSection): string =>
  `space-y-3 rounded-lg border p-4 ${SECTION_TINTS[section]}`;

/** The rows and cards inside a tinted section stay the card colour (white in light mode). */
export const INNER_BOX = "bg-card";
