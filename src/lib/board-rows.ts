/**
 * The Tech Board's row shading (owner, Nov 13: "can you have every other technician row be
 * slightly darker to diffrientiate them a bit more"). Every second technician's row is a shade
 * off the page, so the eye can follow one person across the week. Today's column keeps its tint
 * on both kinds of row, and the cell a ticket is dragged over still wins over everything.
 * Whole class strings, so Tailwind keeps them. Pure: no imports.
 */

/** Is this the second, fourth… row of its group? Rows count from 0. */
export const shadedRow = (index: number): boolean => index % 2 === 1;

/** The technician's name cell. It is sticky, so its fill is solid: tickets scroll under it. */
export const rowHeaderTone = (shaded: boolean): string => (shaded ? "bg-muted" : "bg-background");

/** One day's cell in a technician's row. */
export function cellTone(c: { shaded: boolean; today: boolean; over: boolean }): string {
  if (c.over) return "bg-primary/10 ring-2 ring-inset ring-primary";
  if (c.today) return c.shaded ? "bg-primary/10" : "bg-primary/5";
  return c.shaded ? "bg-muted" : "";
}
