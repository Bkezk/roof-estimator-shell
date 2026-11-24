/**
 * Text in a spreadsheet file stays text (Nov 24, the public pages audit).
 *
 * A spreadsheet program reads a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage
 * return as a formula to work out. A name or a note typed by a person can start that way, so
 * every file the site writes for a spreadsheet puts one single quote `'` in front of such a
 * cell. The program then shows the words as they were typed and works nothing out.
 *
 * Numbers stay numbers: a negative amount such as -12.50 is never given a quote.
 *
 * One rule for every writer:
 *   - the estimate's Review file, the inventory files and the margin report, through `toCsv`
 *     (review-export.ts), and the bookkeeper's invoice file (invoices.server.ts `sageCsv`).
 *     These get every cell as words already, so `csvSafeCell` tells a number by its shape;
 *   - the takeoff's quantities file (components/takeoff/shapes.ts `csvCell`), which still knows
 *     which cells are numbers, so its words go through `csvSafeText`.
 *
 * Pure. This only guards the start of a cell: quoting a cell that holds a comma, a quote mark
 * or a line break is still each writer's own job, and is done AFTER this.
 */

/** The first characters a spreadsheet program takes as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A plain number as the site writes one: digits, with an optional minus sign in front, an
 * optional decimal part and an optional exponent ("12", "-12.50", "0.0313", "1e+21").
 */
const PLAIN_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** True for a cell that is a number and nothing else. */
export const isPlainNumber = (cell: string): boolean => PLAIN_NUMBER.test(cell);

/**
 * A cell known to be words (a name, a note, a label): one single quote in front when it
 * starts like a formula, otherwise exactly as given.
 */
export function csvSafeText(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/**
 * A cell of a writer that gets every cell as words: a plain number is left exactly as it is,
 * anything else is treated as words (`csvSafeText`).
 */
export function csvSafeCell(cell: string): string {
  return isPlainNumber(cell) ? cell : csvSafeText(cell);
}
