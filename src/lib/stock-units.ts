/**
 * Stock units: leftovers are usually PART of a priced pack — three cartridges from a
 * 4-Cartridge Case, 600 screws from a box of 1,000, a few gallons in a bucket. Stock is kept in
 * the priced pack (so it lines up with what the estimator bills and orders) as a decimal, and
 * the catalog says how many pieces one pack holds so a count of pieces converts exactly.
 */

/** The unit stock is kept in, per catalog screen (adhesives use the product's own unit type). */
export const STOCK_UNIT_BY_SCREEN: Record<string, string> = {
  "duro_last:duro_last_membrane": "sq ft",
  "duro_last:underlayment": "sq ft",
  "duro_last:fasteners_and_bits": "box",
  "duro_last:sealants": "tube",
  "duro_last:corners": "each",
  "duro_last:conduit_washers": "each",
  "duro_last:pipe_stacks": "each",
  "duro_last:panduit": "bag",
  "duro_last:drain_boots": "each",
  "duro_last:cdr_rings": "each",
  "duro_last:drain_boot_accessories": "each",
  "duro_last:vents": "each",
  "duro_last:termination_bars": "ft",
  "duro_last:facia_bars_vinyl_covers": "ft",
  "duro_last:drip_edge": "piece",
  "duro_last:gravel_stops": "piece",
  "duro_last:walk_pads_wall_vents": "each",
  "duro_last:membrane_accs": "package",
  "duro_last:adhesives": "pail",
};
export const stockUnitFor = (screenId: string): string => STOCK_UNIT_BY_SCREEN[screenId] ?? "each";

/** Catalog columns that say how many pieces one priced pack holds. */
export const PACK_QTY_COLS = ["Fasteners/Box", "Parts/Bag", "Parts/Package"];

export interface PieceDef {
  /** Singular piece name ("cartridge", "fastener", "gallon", "part"). */
  name: string;
  /** Pieces in one priced pack. */
  perPack: number;
}

/** Adhesive unit types as captured on the catalog ("4-Cartridge Case", "5-gal. Bucket", …). */
export function pieceDefFromUnitType(unitType: string | null | undefined): PieceDef | null {
  const u = (unitType ?? "").trim();
  let m = /^(\d+)\s*-\s*cartridge\b/i.exec(u);
  if (m) return { name: "cartridge", perPack: Number(m[1]) };
  m = /^(\d+(?:\.\d+)?)\s*-?\s*gal\b/i.exec(u);
  // A "Box Set" is two-part (A + B) — a partial set is not a usable quantity of pieces.
  if (m && !/box set/i.test(u)) return { name: "gallon", perPack: Number(m[1]) };
  return null;
}

/** Row screens with a pack-quantity column ("Fasteners/Box", "Parts/Bag", "Parts/Package"). */
export function pieceDefFromPack(
  packCol: string | undefined,
  packQty: number | null | undefined,
): PieceDef | null {
  if (!packCol || typeof packQty !== "number" || !Number.isFinite(packQty) || packQty <= 0)
    return null;
  const name = /^fasteners/i.test(packCol) ? "fastener" : "part";
  return { name, perPack: packQty };
}

/**
 * The piece definition read back from ledger entries of ONE cell when the catalog no longer
 * says: a piece count is written as counted_note "3 cartridges" beside qty −0.25, so one pack
 * holds 3 / 0.25 = 12. The ledger keeps a few decimals of the pack; 12.048 snaps back to 12.
 */
export function pieceFromCountedNotes(
  rows: readonly { qty: number | string; counted_note: string | null }[],
): PieceDef | null {
  for (const r of rows) {
    if (!r.counted_note) continue;
    const m = /^(\d+(?:\.\d+)?)\s+([A-Za-z][A-Za-z -]*)$/.exec(r.counted_note.trim());
    const qty = Math.abs(Number(r.qty));
    if (!m || !(qty > 0)) continue;
    const n = Number(m[1]);
    if (!(n > 0)) continue;
    let name = (m[2] ?? "").trim();
    if (Math.abs(n - 1) > 1e-6) name = name.replace(/s$/i, "");
    let perPack = n / qty;
    const whole = Math.round(perPack);
    if (whole > 0 && Math.abs(perPack - whole) / whole < 0.02) perPack = whole;
    if (!name || !Number.isFinite(perPack) || perPack <= 0) continue;
    return { name, perPack };
  }
  return null;
}

export const packsFromPieces = (pieces: number, def: PieceDef): number => pieces / def.perPack;

export const plural = (n: number, name: string): string => `${name}${Math.abs(n) === 1 ? "" : "s"}`;

const fmt = (n: number): string =>
  Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : n.toFixed(3).replace(/\.?0+$/, "");

/**
 * What a stock quantity (kept in priced packs) reads as: in PIECES when the product has a pack
 * size ("10 cartridges", "600 fasteners"), else in the pack unit ("2 pail").
 */
export function displayStock(
  qty: number,
  unit: string,
  def: PieceDef | null | undefined,
): { amount: number; unit: string } {
  if (!def) return { amount: qty, unit };
  const pieces = qty * def.perPack;
  return { amount: pieces, unit: plural(pieces, def.name) };
}

/** "10 cartridges" / "2 pail" — displayStock as one string. */
export function describeStock(qty: number, unit: string, def: PieceDef | null | undefined): string {
  const d = displayStock(qty, unit, def);
  return `${fmt(d.amount)} ${d.unit}`;
}
