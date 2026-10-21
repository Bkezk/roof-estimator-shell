/**
 * The coloured ground behind each section of a customer's page and a property's page (owner,
 * Oct 21: "add color to the boxes for contacts, properties, tickets etc. — keep the actual
 * contact boxes with info in them white and the add contact button white but give the
 * background they sit on color"). One hue per kind of thing, the same on both pages, so a
 * Tickets section looks like a Tickets section wherever it is. The rows and cards inside keep
 * the card colour (INNER_BOX), and the outline buttons already stand on it.
 *
 * Every tint carries its dark-mode pair (a deep, translucent wash on the charcoal page), which is
 * also what lets the dark-mode scan (dark-mode.test.ts) accept the light `-50` colours.
 */
export const SECTION_TINTS = {
  contacts: "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40",
  properties: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40",
  tickets: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
  opportunities: "border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40",
  tasks: "border-teal-200 bg-teal-50 dark:border-teal-900 dark:bg-teal-950/40",
  takeoffs: "border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/40",
  bids: "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/40",
} as const;

export type TintedSection = keyof typeof SECTION_TINTS;

/** The section card's classes: the shared frame plus its tint. */
export const sectionClass = (section: TintedSection): string =>
  `space-y-3 rounded-lg border p-4 ${SECTION_TINTS[section]}`;

/** The rows and cards inside a tinted section stay the card colour (white in light mode). */
export const INNER_BOX = "bg-card";
