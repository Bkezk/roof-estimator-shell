/**
 * The close-out's one-tap Remove on an "On this ticket" material line (owner, Oct 9: "you cant
 * easily get rid of materials if you accidentally add them on the close out workflow"). The
 * button and the toast's words, pure so they are tested without the screen; the take-back
 * itself is materials-section.tsx reduce() over planReduce (materials-utils.ts): the tech's own
 * fresh entries are undone (the entry is deleted, the stock is back where it came from), else a
 * `released` movement the server caps at what the ticket took. No confirm: the toast carries Undo.
 */
import { amountText } from "@/components/service/materials-utils";
import type { PieceDef } from "@/lib/stock-units";

/** The button's accessible name: "Remove Caulk, clear". */
export const removeLabel = (name: string) => `Remove ${name}`;

/** The toast after the line is gone: "Removed 3 cartridges of Caulk, clear" (its action is Undo). */
export function removedToast(
  name: string,
  units: number,
  piece: PieceDef | null | undefined,
  unit: string,
): string {
  return `Removed ${amountText(units, piece, unit)} of ${name}`;
}
