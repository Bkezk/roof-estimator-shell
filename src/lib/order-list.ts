/**
 * Order list (inventory phase 2). What a bid needs to BUY, product by product, taken from the
 * same engine lines the bid bills — membrane sq ft per matrix row / colour, underlayment sq ft
 * per board, fastener boxes, adhesive units, every Accessories line — matched to the catalog
 * cell that stock is keyed by (screen › product row › colour / size column) and to the ledger's
 * on-hand figure. Owner rule (2026-09-23): stock NEVER changes the bid's price; it only
 * reduces what this list says to buy.
 */
import type { PriceTarget } from "@/lib/admin-item-numbers.functions";
import type { AccessoryReviewLine } from "@/lib/engine/accessories";
import type { EngineAdminData } from "@/lib/engine/adapters";
import type { BidSectionInput, BuildResult } from "@/lib/engine/bid-builder";
import type { Attachment } from "@/lib/engine/estimate";
import {
  FLAT_PRICE_FAMILY_IDS,
  resolveSectionSystem,
  sectionLayers,
  sectionMembraneDisplayPricing,
} from "@/lib/engine/bid-builder";
import type { StockRow } from "@/lib/inventory.functions";
import { displayStock, type PieceDef } from "@/lib/stock-units";

export interface OrderCell {
  screen_id: string;
  row_label: string;
  price_col: string;
}

export interface OrderLine {
  group: "Membrane" | "Underlayment" | "Fasteners" | "Adhesives" | "Accessories";
  /** What the estimator calls it (the engine's own line name). */
  name: string;
  /** Needed for the job, in the pack unit stock is kept in (sq ft, box, case, each…). */
  needed: number;
  unit: string;
  /** Pieces behind a pack count (fasteners), for the reader. */
  pieces?: number;
  /** The catalog cell, when the line resolves to one; undefined = shown, no stock column. */
  cell?: OrderCell;
  /** Ledger on hand for the cell (pack unit); undefined when no stock row exists. */
  onHand?: number;
  /** needed − on hand, floored at 0; whole packs for pack units. */
  toBuy: number;
  /** Product pack pieces (cartridges / fasteners / gallons) when the catalog states them. */
  piece?: PieceDef | null;
}

const SCREEN = {
  membrane: "duro_last:duro_last_membrane",
  underlayment: "duro_last:underlayment",
  fasteners: "duro_last:fasteners_and_bits",
  adhesives: "duro_last:adhesives",
} as const;

/** Accessories `screen` labels → the catalog screen(s) their rows live on. */
const ACCESSORY_SCREENS: Record<string, string[]> = {
  "Term Bar": ["duro_last:termination_bars"],
  'Fascia Bar 3"': ["duro_last:facia_bars_vinyl_covers"],
  'Fascia Bar 4"': ["duro_last:facia_bars_vinyl_covers"],
  "Drip Edge": ["duro_last:drip_edge"],
  "Gravel Stop": ["duro_last:gravel_stops"],
  "Base & Snap Cover": ["duro_last:facia_bars_vinyl_covers"],
  Corners: ["duro_last:corners"],
  "Pipe Stacks": ["duro_last:pipe_stacks"],
  "Conduit Washers": ["duro_last:conduit_washers"],
  "Roof Drains & Boots": [
    "duro_last:drain_boots",
    "duro_last:cdr_rings",
    "duro_last:drain_boot_accessories",
  ],
  "Walk Pads": ["duro_last:walk_pads_wall_vents"],
  "Panduit Straps": ["duro_last:panduit"],
  "Membrane Acc.": ["duro_last:membrane_accs"],
  Vents: ["duro_last:vents"],
  Sealants: ["duro_last:sealants"],
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** A row key `label [Subtype|Part #]` → its label. */
const labelOf = (rowKey: string) => rowKey.replace(/\s*\[[^\]]*\]\s*$/, "");
/** A row key `label [Subtype|Part #]` → the bracketed disambiguator ("" when none). */
const bracketOf = (rowKey: string) => /\[([^\]]*)\]\s*$/.exec(rowKey)?.[1] ?? "";

/**
 * The accessories module keys a Fasteners & Bits row `description|subtype`; the catalog row key
 * is the description, bracketed with the subtype only when the description repeats.
 */
export function fastenerRowKey(accessoriesKey: string, target: PriceTarget | undefined): string {
  if (!target) return accessoriesKey;
  const [desc = "", subtype = ""] = accessoriesKey.split("|");
  const candidates = target.rows.filter((r) => labelOf(r) === desc.trim());
  if (candidates.length === 1) return candidates[0]!;
  return (
    candidates.find((r) => bracketOf(r).split("|")[0]?.trim() === subtype.trim()) ??
    candidates[0] ??
    accessoriesKey
  );
}

/**
 * Best catalog cell for an Accessories line: on the screen(s) the line's screen maps to, the row
 * whose label is contained in the line name (longest wins); the colour column named in the
 * line when the screen has several price columns, else its only price column.
 */
export function matchAccessoryCell(
  line: Pick<AccessoryReviewLine, "screen" | "name">,
  targets: readonly PriceTarget[],
): OrderCell | undefined {
  const screens = ACCESSORY_SCREENS[line.screen];
  if (!screens) return undefined;
  const name = norm(line.name);
  let best: { cell: OrderCell; len: number } | undefined;
  for (const t of targets) {
    if (!screens.includes(t.screen_id)) continue;
    for (const rowKey of t.rows) {
      const label = norm(labelOf(rowKey));
      if (!label || !name.includes(label)) continue;
      // Ties (a label repeated on the screen, e.g. the 3" and 4" fascia vinyl covers): the 4"
      // screens take the later row, the 3" the earlier.
      if (best && label.length < best.len) continue;
      if (best && label.length === best.len && !/4"/.test(line.screen)) continue;
      let col = t.price_cols[0] ?? "";
      if (t.price_cols.length > 1) {
        const hit = t.price_cols.find((c) => {
          const colour = c.replace(/\s*price$/i, "").trim();
          return colour && new RegExp(`\\b${colour.toLowerCase()}\\b`).test(name);
        });
        if (hit) col = hit;
      }
      best = {
        cell: { screen_id: t.screen_id, row_label: rowKey, price_col: col },
        len: label.length,
      };
    }
  }
  return best?.cell;
}

/** The membrane matrix row the engine prices a section from. */
export function membraneRowForSection(
  admin: EngineAdminData,
  roofSystem: string,
  attachment: Attachment,
  s: BidSectionInput,
): string {
  const sys = resolveSectionSystem({ roofSystem, attachment }, s);
  if (FLAT_PRICE_FAMILY_IDS.has(sys.rsId)) {
    const variant = sys.rsId === 5 ? `${s.thickness}mil` : String(s.thickness);
    return `${sys.roofSystem} - ${variant}`;
  }
  const { tierLabel } = sectionMembraneDisplayPricing(admin, roofSystem, attachment, s);
  return `Duro-Last - ${s.thickness}mil ${tierLabel}`;
}

export interface OrderListInput {
  admin: EngineAdminData;
  roofSystem: string;
  attachment: Attachment;
  sections: BidSectionInput[];
  build: Pick<BuildResult, "inputs" | "accessories" | "adhesiveLines">;
  targets: readonly PriceTarget[];
  stock: readonly StockRow[];
}

const isPackUnit = (unit: string) => unit !== "sq ft" && unit !== "ft";

export function buildOrderList(i: OrderListInput): OrderLine[] {
  const stockByCell = new Map<string, StockRow>();
  for (const r of i.stock)
    stockByCell.set(`${r.screen_id}\u0000${r.row_label}\u0000${r.price_col}`, r);
  const targetByScreen = new Map(i.targets.map((t) => [t.screen_id, t]));
  const cellExists = (c: OrderCell) => {
    const t = targetByScreen.get(c.screen_id);
    return !!t && t.rows.includes(c.row_label) && t.price_cols.includes(c.price_col);
  };
  const pieceFor = (c: OrderCell) => targetByScreen.get(c.screen_id)?.pieces?.[c.row_label] ?? null;
  const unitFor = (c: OrderCell, fallback: string) =>
    targetByScreen.get(c.screen_id)?.row_units?.[c.row_label] ?? fallback;

  const out: OrderLine[] = [];
  const add = (
    group: OrderLine["group"],
    name: string,
    needed: number,
    unit: string,
    cell: OrderCell | undefined,
    pieces?: number,
  ) => {
    if (needed <= 0) return;
    const resolved = cell && cellExists(cell) ? cell : undefined;
    const stock = resolved
      ? stockByCell.get(
          `${resolved.screen_id}\u0000${resolved.row_label}\u0000${resolved.price_col}`,
        )
      : undefined;
    const u = resolved ? unitFor(resolved, unit) : unit;
    const onHand = stock ? stock.on_hand : undefined;
    const remaining = Math.max(0, needed - (onHand ?? 0));
    const toBuy = isPackUnit(u) ? Math.ceil(remaining - 1e-9) : Math.round(remaining * 100) / 100;
    const line: OrderLine = { group, name, needed, unit: u, toBuy };
    if (pieces !== undefined) line.pieces = pieces;
    if (resolved) {
      line.cell = resolved;
      line.piece = pieceFor(resolved);
    }
    if (onHand !== undefined) line.onHand = onHand;
    out.push(line);
  };

  // Membrane: MembraneWithOverlap per section, grouped by matrix row + colour column.
  const membrane = new Map<string, { row: string; col: string; sqFt: number }>();
  i.sections.forEach((s, idx) => {
    const rs = i.build.inputs.sections[idx];
    if (!rs || rs.membraneWithOverlap <= 0) return;
    const row = membraneRowForSection(i.admin, i.roofSystem, i.attachment, s);
    const key = `${row}\u0000${s.color}`;
    const cur = membrane.get(key) ?? { row, col: s.color, sqFt: 0 };
    cur.sqFt += rs.membraneWithOverlap;
    membrane.set(key, cur);
  });
  for (const m of membrane.values())
    add("Membrane", `${m.row} · ${m.col}`, Math.ceil(m.sqFt), "sq ft", {
      screen_id: SCREEN.membrane,
      row_label: m.row,
      price_col: m.col,
    });

  // Underlayment: area × the engine's waste factor per priced (non-quote) layer, by board.
  const boards = new Map<string, number>();
  for (const s of i.sections) {
    const area = s.length * s.width;
    for (const layer of sectionLayers(s)) {
      if (layer.quote) continue; // quoted layers are bought on the quote, not the catalog
      const waste = layer.board.trim().toLowerCase() === "geotextile" ? 1.06 : 1.03;
      boards.set(layer.board, (boards.get(layer.board) ?? 0) + area * waste);
    }
  }
  for (const [board, sqFt] of boards)
    add("Underlayment", board, Math.ceil(sqFt), "sq ft", {
      screen_id: SCREEN.underlayment,
      row_label: board,
      price_col: "Cost/Sq. Ft.",
    });

  // Fasteners: whole boxes per Fasteners & Bits row (the accessories module's own rows, keyed
  // `description|subtype`; the catalog row key differs — fastenerRowKey).
  for (const r of i.build.accessories?.fasteners.rows ?? []) {
    const rowKey = fastenerRowKey(r.key, targetByScreen.get(SCREEN.fasteners));
    const [desc = r.key, subtype = ""] = r.key.split("|");
    add(
      "Fasteners",
      `${desc.trim()} ${subtype.trim()}`.trim(),
      r.boxes,
      "box",
      { screen_id: SCREEN.fasteners, row_label: rowKey, price_col: "Price/Box" },
      r.totalQty,
    );
  }

  // Adhesives: whole units (calc + extras) per adhesive.
  for (const l of i.build.adhesiveLines)
    add("Adhesives", l.name, l.qty, "unit", {
      screen_id: SCREEN.adhesives,
      row_label: l.name,
      price_col: "price",
    });

  // Every other Accessories line, matched to its catalog row by name.
  for (const l of i.build.accessories?.lines ?? []) {
    if (l.screen === "Fasteners" || l.qty <= 0) continue;
    if (/labor only|reuse ring/i.test(l.name)) continue;
    add("Accessories", `${l.screen} — ${l.name}`, l.qty, "each", matchAccessoryCell(l, i.targets));
  }
  return out;
}

/** "10 cartridges" / "600 fasteners" / "2 sq ft" for a line's figure in its unit. */
export const describeOrderQty = (line: OrderLine, qty: number): string =>
  describeStock(qty, line.unit, line.piece);

function describeStock(qty: number, unit: string, piece: PieceDef | null | undefined): string {
  const d = displayStock(qty, unit, piece);
  const n = Number.isInteger(d.amount) ? String(d.amount) : d.amount.toFixed(2);
  return `${n} ${d.unit}`;
}
