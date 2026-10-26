/**
 * The underlayment layer stack's rows and its one tall screw (owner, Oct 26: "make the fastener
 * visual match bid advantage better on the underlayment"). Legacy frmUnderlayment draws the
 * layer bars tight on top of each other over the blue Deck bar and ONE black screw standing in
 * the middle: its head above the topmost mechanically fastened layer, its tip in the deck,
 * piercing every layer beneath it whatever holds those (a loose or adhered board under a
 * fastened one is still pierced). The web drew a short screw between each fastened layer and the
 * one below, which read as several fasteners. Pure: components/layer-stack.tsx lays the rows out
 * at these pixel heights and places the screw from `screwSpan`.
 */

/** Row heights and the gap between rows, in px (the stack's Tailwind classes match them). */
export const ROW = { empty: 28, bar: 36, bed: 20, deck: 36, gap: 4 } as const;

export type StackAttachment = "mechanical" | "adhesive" | "none" | "durobond";

export type StackRow =
  | { kind: "empty"; slot: number }
  | { kind: "bar"; slot: number; attachment: StackAttachment }
  | { kind: "bed"; slot: number }
  | { kind: "deck" };

/**
 * The rows top-down: an "Add Layer" slot or a layer bar per slot, a green adhesive bed under an
 * adhered layer (between it and what it sits on), and the deck last.
 */
export function stackRows<L>(
  slotsTopDown: readonly number[],
  layers: readonly (L | null | undefined)[],
  attachmentOf: (layer: L) => StackAttachment,
): StackRow[] {
  const rows: StackRow[] = [];
  for (const slot of slotsTopDown) {
    const l = layers[slot];
    if (l === null || l === undefined) {
      rows.push({ kind: "empty", slot });
      continue;
    }
    const attachment = attachmentOf(l);
    rows.push({ kind: "bar", slot, attachment });
    if (attachment === "adhesive") rows.push({ kind: "bed", slot });
  }
  rows.push({ kind: "deck" });
  return rows;
}

const heightOf = (r: StackRow): number =>
  r.kind === "empty"
    ? ROW.empty
    : r.kind === "bar"
      ? ROW.bar
      : r.kind === "bed"
        ? ROW.bed
        : ROW.deck;

/**
 * Where the screw stands: the row of the topmost fastened layer (mechanical or Duro-Bond) and
 * the height from that bar's top to the middle of the deck. Null when nothing is fastened.
 */
export function screwSpan(rows: readonly StackRow[]): { fromRow: number; heightPx: number } | null {
  const fromRow = rows.findIndex(
    (r) => r.kind === "bar" && (r.attachment === "mechanical" || r.attachment === "durobond"),
  );
  if (fromRow < 0) return null;
  let heightPx = 0;
  for (let i = fromRow; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.kind === "deck") {
      heightPx += ROW.deck / 2;
      break;
    }
    heightPx += heightOf(r) + ROW.gap;
  }
  return { fromRow, heightPx };
}
