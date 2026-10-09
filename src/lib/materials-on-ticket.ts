/**
 * The close-out's one "On this ticket" list (owner, Oct 9: the screenshot showed three ways to
 * add material, a dead truck block for someone with no truck and the heading still saying "off
 * the truck" — "one list of what is on the ticket, at the top"). Everything this ticket logged
 * from ANY place — the truck, the shop, another truck — is one list, first logged first, each
 * row the same −, typed count and + as a truck row (materials-section.tsx TruckRow). Pure, so it
 * is tested without the screen.
 *
 * The ledger is kept in PACKS (negative = used, positive = put back); a row's `packs` is the net
 * for the cell at that place. A cell taken back to zero is not a row; a cell that was only put
 * back (a return, nothing used) is a row with negative packs, shown read-only.
 */
import {
  EPS,
  catalogKey,
  cellKey,
  pieceFromLedger,
  round6,
  type LedgerRow,
  type LocatedCell,
} from "@/components/service/materials-utils";
import type { PieceDef } from "@/lib/stock-units";

/** A ledger entry as listServiceJobMaterials returns it (the service name beside the cell). */
export interface OnTicketEntry extends LedgerRow {
  label: string | null;
}

/** A row this screen already knows the stock and the piece of (the truck list, the browse panel). */
export interface KnownCell extends LocatedCell {
  label: string | null;
  category: string;
  unit: string;
  /** Packs there now. */
  on_hand: number;
  piece: PieceDef | null;
  item_no: string | null;
  location_name: string;
}

export interface OnTicketRow extends KnownCell {
  key: string;
  /** Net packs on this ticket from this place: used minus put back. Negative: a return only. */
  packs: number;
  /**
   * Whether `on_hand` is what the app really shows there (a truck row, the browse panel or the
   * all-locations read). False: 0 stands in and the server checks the stock when + takes more.
   */
  known: boolean;
  /** When the cell was first logged on this ticket (ISO): the list's order. */
  first: string;
  /** "from Shop", "from Truck 2". */
  from: string;
}

/**
 * One row per cell-at-a-place this ticket has a net quantity of, oldest first (by the earliest
 * entry of the cell, so a row never moves when a count is corrected).
 *
 * `known` lends the rows their category, piece, item # and on-hand; a cell this screen has no
 * row for takes the ledger's name and unit, the piece written in its counted notes
 * (pieceFromLedger) and, when `onHandAt` answers, the on-hand of the all-locations read.
 */
export function onTicketRows(
  ledger: readonly OnTicketEntry[],
  known: readonly KnownCell[],
  locName: (locationId: string) => string,
  onHandAt: (cell: LocatedCell) => number | null = () => null,
): OnTicketRow[] {
  const byCell = new Map<string, { m: OnTicketEntry; packs: number; first: string; id: number }>();
  for (const m of ledger) {
    const key = cellKey(m);
    const cur = byCell.get(key) ?? { m, packs: 0, first: m.created_at, id: m.id };
    cur.packs = round6(cur.packs - Number(m.qty));
    if (m.created_at < cur.first || (m.created_at === cur.first && m.id < cur.id)) {
      cur.first = m.created_at;
      cur.id = m.id;
      cur.m = m;
    }
    byCell.set(key, cur);
  }
  const knownByKey = new Map(known.map((k) => [cellKey(k), k]));
  const out: (OnTicketRow & { id: number })[] = [];
  for (const [key, { m, packs, first, id }] of byCell) {
    if (Math.abs(packs) <= EPS) continue;
    const here = knownByKey.get(key);
    // The same product on another shelf still says what a piece is and its item #.
    const alike = here ?? known.find((k) => catalogKey(k) === catalogKey(m));
    const onHand = here ? here.on_hand : onHandAt(m);
    const location_name = here?.location_name || locName(m.location_id);
    out.push({
      key,
      location_id: m.location_id,
      screen_id: m.screen_id,
      row_label: m.row_label,
      price_col: m.price_col,
      label: here?.label ?? m.label,
      category: alike?.category ?? "",
      unit: here?.unit ?? m.unit,
      on_hand: onHand ?? 0,
      piece: alike?.piece ?? pieceFromLedger(ledger, m),
      item_no: alike?.item_no ?? null,
      location_name,
      packs,
      known: onHand !== null,
      first,
      from: `from ${location_name}`,
      id,
    });
  }
  // The entry id breaks a tie between two cells first logged in the same instant.
  return out
    .sort((a, b) => a.first.localeCompare(b.first) || a.id - b.id)
    .map(({ id: _id, ...row }) => row);
}
