/**
 * §13 EXCEPTIONAL Metals — the legacy Metals screen money path, extracted from the
 * licensed install's DataAccess.dll IL (BidAdvantage.DataAccess.Gutter/GutterAcc/
 * DownSpout/DownSpoutAcc/PitchPan/CollectionBox + their collections and
 * ReviewCalc.Recalculate).
 *
 * Extracted semantics (all arithmetic in .NET Single / float32):
 *
 *  - Gutter / DownSpout are LENGTH-based rows:
 *      MaterialCost = increment10(Length) × PricePerFoot
 *      Labor (hours) = Length × LaborPerFoot          (set by set_Length)
 *      LaborCost     = Labor × LaborRate
 *      Qty (display) = Length == 0 → 0; Length ≤ 10 → 1; else Convert.ToInt32(Length/10)
 *                      (banker's rounding — 25 ft shows 2 "bars")
 *    increment10 (legacy quirk transcribed verbatim):
 *      x ≤ 0 → 0;  0 < x < 10 → 1 (!);  x % 10 == 0 → x;  else x + 10 − x % 10
 *    i.e. lengths round UP to the next 10 ft EXCEPT lengths under 10 ft, which bill as
 *    1 ft of material (the legacy returns the literal 1.0, not 10.0 — parity, documented).
 *
 *  - GutterAcc / DownSpoutAcc / PitchPan / CollectionBox are QTY-based rows:
 *      MaterialCost = Price × Qty
 *      Labor (hours) = Qty × LaborPerUnit             (set by set_Qty)
 *      LaborCost     = Labor × LaborRate
 *
 *  - Gutter accessories live INSIDE their parent gutter (Gutter.oGutterAccs);
 *    Gutters.OnRecalculate sums Gutter.get_MaterialCost(true) — gutter + its accs.
 *    Downspout accessories (per-size drops/elbows AND the General Downspout
 *    Accessories) are one flat top-level DownSpoutAccs collection.
 *
 *  - Metals totals = Gutters + DownSpouts + DownSpoutAccs + PitchPans + CollectionBoxes.
 *    ReviewCalc.Recalculate bills dMaterial[5] = Metals.MaterialCost,
 *    dLabor[5,0] = Metals.LaborCost, dLabor[5,1] = Metals.Labor (hours). Labor is
 *    DIRECT labor at each row's own LaborRate (ref-data $/hr), never the bid crew rate.
 *
 * The frmMetals summary grid (Category | Item | Qty/LF | Cost/Quote | Hours PerUnit/LF |
 * Hours | Labor Cost) itemizes each gutter/downspout with its OWN money
 * (get_MaterialCost(false)) and each accessory as a separate row ("«acc» for «gutter»"),
 * LaborPerFoot shown at 3 dp and Hours at 2 dp — display rounding only.
 */

import type { MetalsScreenData } from "./adapters";

const f32 = Math.fround;

/** Legacy Gutter.increment10 / DownSpout.increment10 (float32; <10 ft → 1 quirk). */
export function increment10(x: number): number {
  const v = f32(x);
  if (v <= 0) return 0;
  if (v < 10) return 1;
  const rem = f32(v % 10);
  if (rem === 0) return v;
  return f32(f32(v + 10) - rem);
}

/** Legacy Gutter.get_Qty / DownSpout.get_Qty — display "bars" count (banker's ToInt32). */
export function lengthQty(lengthFt: number): number {
  const v = f32(lengthFt);
  if (v === 0) return 0;
  if (v <= 10) return 1;
  // Convert.ToInt32 rounds half to even.
  const q = v / 10;
  const fl = Math.floor(q);
  const diff = q - fl;
  if (diff > 0.5) return fl + 1;
  if (diff < 0.5) return fl;
  return fl % 2 === 0 ? fl : fl + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ref data (parsed from the seeded duro_last:exceptional_metals subscreens)
// ─────────────────────────────────────────────────────────────────────────────

export interface MetalsRefRow {
  description: string;
  unitCost: number;
  laborPerUnit: number; // hours per unit (qty rows) or per LF (length rows)
  laborRate: number; // $/hr for this row's labor
}

export interface GutterRefEntry {
  /** The length-based gutter row ("… — Gutter per LF"). */
  gutter: MetalsRefRow | null;
  /** Qty-based accessory rows for this style+size (end caps, splice plates, miters). */
  accessories: MetalsRefRow[];
}

export interface MetalsRefData {
  gutters: {
    styles: string[];
    /** Sizes offered per style (legacy cboStyle → cboSize). */
    sizesByStyle: Record<string, string[]>;
    /** `${style}|${size}` → gutter + its accessory rows. */
    byStyleSize: Record<string, GutterRefEntry>;
    /** Style-independent accessory rows (Gutter Sealant, Rivets) appended to every gutter. */
    shared: MetalsRefRow[];
  };
  downspouts: {
    sizes: string[];
    /** size → { spouts: length-based rows (Open/Closed), accessories: qty rows (drop, elbows) }. */
    bySize: Record<string, { spouts: MetalsRefRow[]; accessories: MetalsRefRow[] }>;
    /** General Downspout Accessories (straps, adapters, rivets, snow diverter). */
    general: MetalsRefRow[];
  };
  pitchPans: MetalsRefRow[];
  collectionBoxes: {
    options: string[];
    byOption: Record<string, MetalsRefRow[]>;
  };
}

interface RawMetalRow {
  description?: string | null;
  unit_cost?: number | null;
  labor_per_unit_lf?: number | null;
  labor_rate?: number | null;
}

function refRow(r: RawMetalRow): MetalsRefRow | null {
  const d = (r.description ?? "").trim();
  if (!d) return null;
  const num = (v: number | null | undefined) => (typeof v === "number" ? v : 0);
  return {
    description: d,
    unitCost: num(r.unit_cost),
    laborPerUnit: num(r.labor_per_unit_lf),
    laborRate: num(r.labor_rate),
  };
}

/**
 * Gutter seed rows are keyed `"DX-4 (A=6\" B=4\" C=4\") — «part»"`; styles are listed as
 * "DX-Style" and sizes as `"A = 6\" B = 4\" C = 4\""`. Match on the style prefix and the
 * whitespace-stripped dimension triple.
 *
 * ⚠ OPEN FLAG — docs/legacy-money-parity.md §22.10. Legacy binds an accessory to its gutter by a
 * DATA COLUMN (`GutterAccs.readRefTable` 0xa2730: rows with `GutterID == gutter.GutterID`, then
 * rows with `GutterID == -1` = shared on every gutter). The captured screen has no such column, so
 * the relationship is recovered from the description here. Consequences to keep in mind before
 * touching this: a row that does NOT match falls through to `ref.gutters.shared` and bills on
 * EVERY gutter (silently), and a row whose style/size is not in the pickers is dropped. The em
 * dash and the `STYLE-N` prefix are load-bearing. Today only "Gutter Sealant" and "Rivets (250
 * count)" fall through, and both belong there — see §22.10 for the fix options.
 */
const GUTTER_ROW_RE = /^([A-Z]+)-\d+\s*\(([^)]*)\)\s*—\s*(.+)$/;

const stripWs = (s: string) => s.replace(/\s+/g, "");

export function buildMetalsRefData(data: MetalsScreenData | null): MetalsRefData {
  const ref: MetalsRefData = {
    gutters: { styles: [], sizesByStyle: {}, byStyleSize: {}, shared: [] },
    downspouts: { sizes: [], bySize: {}, general: [] },
    pitchPans: [],
    collectionBoxes: { options: [], byOption: {} },
  };
  const s = data?.subscreens;
  if (!s) return ref;

  // Gutters
  const g = s.gutters;
  ref.gutters.styles = g?.styles ?? [];
  ref.gutters.sizesByStyle = g?.sizes_by_style ?? {};
  const sizeByStripped: Record<string, Record<string, string>> = {};
  for (const [style, sizes] of Object.entries(ref.gutters.sizesByStyle)) {
    const prefix = style.replace(/-Style$/, "");
    sizeByStripped[prefix] = {};
    for (const size of sizes) sizeByStripped[prefix][stripWs(size)] = size;
  }
  for (const raw of g?.rows ?? []) {
    const row = refRow(raw);
    if (!row) continue;
    const m = GUTTER_ROW_RE.exec(row.description);
    if (!m) {
      // Style-independent rows (Gutter Sealant, Rivets) — legacy `GutterID == -1`. NOTE: this is
      // also where a MIS-NAMED per-style row lands, and it would then bill on every gutter with
      // no warning (open flag, docs §22.10).
      ref.gutters.shared.push(row);
      continue;
    }
    const prefix = m[1] ?? "";
    const dims = m[2] ?? "";
    const part = m[3] ?? "";
    const style = ref.gutters.styles.find((st) => st.replace(/-Style$/, "") === prefix);
    const size = sizeByStripped[prefix]?.[stripWs(dims)];
    if (!style || !size) continue; // row for a style/size the pickers don't offer
    const key = `${style}|${size}`;
    const entry = (ref.gutters.byStyleSize[key] ??= { gutter: null, accessories: [] });
    const partRow = { ...row, description: part.trim() };
    if (/^Gutter per LF$/i.test(partRow.description)) entry.gutter = partRow;
    else entry.accessories.push(partRow);
  }

  // Downspouts
  const d = s.downspouts;
  ref.downspouts.sizes = d?.sizes ?? Object.keys(d?.size_grid?.rows_by_size ?? {});
  for (const [size, rows] of Object.entries(d?.size_grid?.rows_by_size ?? {})) {
    const spouts: MetalsRefRow[] = [];
    const accessories: MetalsRefRow[] = [];
    for (const raw of rows) {
      const row = refRow(raw);
      if (!row) continue;
      if (/Downspout\s*-\s*(Open|Closed)/i.test(row.description)) spouts.push(row);
      else accessories.push(row);
    }
    ref.downspouts.bySize[size] = { spouts, accessories };
  }
  for (const raw of d?.general_downspout?.rows ?? []) {
    const row = refRow(raw);
    if (row) ref.downspouts.general.push(row);
  }

  // Pitch pans
  for (const raw of s.pitch_pans?.rows ?? []) {
    const row = refRow(raw);
    if (row) ref.pitchPans.push(row);
  }

  // Collection boxes
  const byOption = s.collection_boxes?.rows_by_option ?? {};
  ref.collectionBoxes.options = s.collection_boxes?.options ?? Object.keys(byOption);
  for (const [option, rows] of Object.entries(byOption)) {
    const list: MetalsRefRow[] = [];
    for (const raw of rows) {
      const row = refRow(raw);
      if (row) list.push(row);
    }
    ref.collectionBoxes.byOption[option] = list;
  }

  return ref;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bid-side state (what the estimator typed on the four dialogs)
// ─────────────────────────────────────────────────────────────────────────────

export interface GutterEntryState {
  style: string;
  size: string;
  lengthFt: number;
  /** Accessory description → qty (per-style rows + shared Gutter Sealant / Rivets). */
  accQty: Record<string, number>;
}

export interface DownspoutEntryState {
  size: string;
  /** Length LF per length-based row description ("4\"X4\" Downspout - Open" → 40). */
  lengthByDesc: Record<string, number>;
  /** Per-size accessory description → qty (Drop/Outlet, elbows). */
  accQty: Record<string, number>;
}

export interface MetalsState {
  gutters: GutterEntryState[];
  downspouts: DownspoutEntryState[];
  /** General Downspout Accessories description → qty. */
  generalAccQty: Record<string, number>;
  /** Pitch pan description → qty. */
  pitchPanQty: Record<string, number>;
  /** Scupper option → box description → qty. */
  collectionBoxQty: Record<string, Record<string, number>>;
}

export function emptyMetalsState(): MetalsState {
  return {
    gutters: [],
    downspouts: [],
    generalAccQty: {},
    pitchPanQty: {},
    collectionBoxQty: {},
  };
}

/** Coerce a possibly-partial saved blob into a full MetalsState (bad fields dropped). */
export function normalizeMetalsState(raw: unknown): MetalsState {
  const st = emptyMetalsState();
  if (!raw || typeof raw !== "object") return st;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  const numMap = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (v && typeof v === "object")
      for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
        const q = num(n);
        if (q > 0) out[k] = q;
      }
    return out;
  };
  if (Array.isArray(o["gutters"]))
    for (const e of o["gutters"] as Array<Record<string, unknown>>) {
      if (!e || typeof e !== "object") continue;
      if (typeof e["style"] !== "string" || typeof e["size"] !== "string") continue;
      st.gutters.push({
        style: e["style"],
        size: e["size"],
        lengthFt: num(e["lengthFt"]),
        accQty: numMap(e["accQty"]),
      });
    }
  if (Array.isArray(o["downspouts"]))
    for (const e of o["downspouts"] as Array<Record<string, unknown>>) {
      if (!e || typeof e !== "object") continue;
      if (typeof e["size"] !== "string") continue;
      st.downspouts.push({
        size: e["size"],
        lengthByDesc: numMap(e["lengthByDesc"]),
        accQty: numMap(e["accQty"]),
      });
    }
  st.generalAccQty = numMap(o["generalAccQty"]);
  st.pitchPanQty = numMap(o["pitchPanQty"]);
  if (o["collectionBoxQty"] && typeof o["collectionBoxQty"] === "object")
    for (const [opt, m] of Object.entries(o["collectionBoxQty"] as Record<string, unknown>)) {
      const qm = numMap(m);
      if (Object.keys(qm).length > 0) st.collectionBoxQty[opt] = qm;
    }
  return st;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute (mirrors the collection OnRecalculate roll-ups, float32)
// ─────────────────────────────────────────────────────────────────────────────

export type MetalsCategory = "Gutters" | "Downspouts" | "Pitch Pans" | "Collection Boxes";

/** Where a summary line came from, so the screen can remove exactly that entry. */
export type MetalsLineSource =
  | { kind: "gutter"; style: string; size: string }
  | { kind: "gutterAcc"; style: string; size: string; desc: string }
  | { kind: "downspout"; size: string; desc: string }
  | { kind: "downspoutAcc"; size: string; desc: string }
  | { kind: "generalAcc"; desc: string }
  | { kind: "pitchPan"; desc: string }
  | { kind: "collectionBox"; option: string; desc: string };

/** One frmMetals lvSummary row. */
export interface MetalsLine {
  category: MetalsCategory;
  item: string;
  source: MetalsLineSource;
  /** Qty/LF column: LF for length rows, qty for qty rows. */
  qtyOrLf: number;
  isLength: boolean;
  /** Cost/Quote column: this row's own material cost. */
  materialCost: number;
  /** Hours PerUnit/LF column. */
  hoursPerUnit: number;
  hours: number;
  laborCost: number;
}

export interface MetalsResult {
  lines: MetalsLine[];
  /** → dMaterial[5] (inside M0/Duro-Last material). */
  materialCost: number;
  /** → dLabor[5,0] — direct labor $ at each row's own rate. */
  laborCost: number;
  /** → dLabor[5,1] — hours. */
  laborHours: number;
}

/** Length-based row money (legacy Gutter/DownSpout getters). */
function lengthRowMoney(lengthFt: number, row: MetalsRefRow) {
  const len = f32(lengthFt);
  const materialCost = f32(increment10(len) * f32(row.unitCost));
  const hours = f32(len * f32(row.laborPerUnit));
  const laborCost = f32(hours * f32(row.laborRate));
  return { materialCost, hours, laborCost };
}

/** Qty-based row money (legacy GutterAcc/DownSpoutAcc/PitchPan/CollectionBox getters). */
function qtyRowMoney(qty: number, row: MetalsRefRow) {
  const materialCost = f32(f32(row.unitCost) * qty);
  const hours = f32(qty * f32(row.laborPerUnit));
  const laborCost = f32(hours * f32(row.laborRate));
  return { materialCost, hours, laborCost };
}

export function computeMetals(state: MetalsState, ref: MetalsRefData): MetalsResult {
  const lines: MetalsLine[] = [];
  let materialCost = 0;
  let laborCost = 0;
  let laborHours = 0;
  const add = (
    category: MetalsCategory,
    item: string,
    qtyOrLf: number,
    isLength: boolean,
    row: MetalsRefRow,
    money: { materialCost: number; hours: number; laborCost: number },
    source: MetalsLineSource,
  ) => {
    if (qtyOrLf <= 0) return;
    lines.push({
      category,
      item,
      source,
      qtyOrLf,
      isLength,
      materialCost: money.materialCost,
      hoursPerUnit: row.laborPerUnit,
      hours: money.hours,
      laborCost: money.laborCost,
    });
    materialCost = f32(materialCost + money.materialCost);
    laborCost = f32(laborCost + money.laborCost);
    laborHours = f32(laborHours + money.hours);
  };

  // Gutters (each gutter's accessories itemized "«acc» for «gutter»", like RefreshSummary)
  for (const entry of state.gutters) {
    const key = `${entry.style}|${entry.size}`;
    const refEntry = ref.gutters.byStyleSize[key];
    const gutterDesc = `${entry.style.replace(/-Style$/, "")} Gutter (${entry.size})`;
    if (refEntry?.gutter && entry.lengthFt > 0) {
      add(
        "Gutters",
        gutterDesc,
        entry.lengthFt,
        true,
        refEntry.gutter,
        lengthRowMoney(entry.lengthFt, refEntry.gutter),
        { kind: "gutter", style: entry.style, size: entry.size },
      );
    }
    const accRows = [...(refEntry?.accessories ?? []), ...ref.gutters.shared];
    for (const row of accRows) {
      const qty = entry.accQty[row.description] ?? 0;
      if (qty > 0)
        add(
          "Gutters",
          `${row.description} for ${gutterDesc}`,
          qty,
          false,
          row,
          qtyRowMoney(qty, row),
          { kind: "gutterAcc", style: entry.style, size: entry.size, desc: row.description },
        );
    }
  }

  // Downspouts (length rows) + their per-size accessories (top-level DownSpoutAccs in legacy)
  for (const entry of state.downspouts) {
    const sizeRef = ref.downspouts.bySize[entry.size];
    if (!sizeRef) continue;
    for (const row of sizeRef.spouts) {
      const len = entry.lengthByDesc[row.description] ?? 0;
      if (len > 0)
        add("Downspouts", row.description, len, true, row, lengthRowMoney(len, row), {
          kind: "downspout",
          size: entry.size,
          desc: row.description,
        });
    }
    for (const row of sizeRef.accessories) {
      const qty = entry.accQty[row.description] ?? 0;
      if (qty > 0)
        add(
          "Downspouts",
          `${row.description} (${entry.size})`,
          qty,
          false,
          row,
          qtyRowMoney(qty, row),
          { kind: "downspoutAcc", size: entry.size, desc: row.description },
        );
    }
  }
  for (const row of ref.downspouts.general) {
    const qty = state.generalAccQty[row.description] ?? 0;
    if (qty > 0)
      add("Downspouts", row.description, qty, false, row, qtyRowMoney(qty, row), {
        kind: "generalAcc",
        desc: row.description,
      });
  }

  // Pitch pans
  for (const row of ref.pitchPans) {
    const qty = state.pitchPanQty[row.description] ?? 0;
    if (qty > 0)
      add("Pitch Pans", row.description, qty, false, row, qtyRowMoney(qty, row), {
        kind: "pitchPan",
        desc: row.description,
      });
  }

  // Collection boxes
  for (const [option, qtyByDesc] of Object.entries(state.collectionBoxQty)) {
    for (const row of ref.collectionBoxes.byOption[option] ?? []) {
      const qty = qtyByDesc[row.description] ?? 0;
      if (qty > 0)
        add(
          "Collection Boxes",
          `${row.description} (${option})`,
          qty,
          false,
          row,
          qtyRowMoney(qty, row),
          { kind: "collectionBox", option, desc: row.description },
        );
    }
  }

  return { lines, materialCost, laborCost, laborHours };
}

const without = (m: Record<string, number>, key: string): Record<string, number> => {
  const out = { ...m };
  delete out[key];
  return out;
};

/**
 * Remove one summary line (legacy frmMetals Remove on lvSummary): drops just that entry's
 * quantity / length; a gutter or downspout size with nothing left on it is dropped entirely.
 */
export function removeMetalsLine(state: MetalsState, src: MetalsLineSource): MetalsState {
  const next: MetalsState = {
    ...state,
    gutters: state.gutters.map((g) => ({ ...g, accQty: { ...g.accQty } })),
    downspouts: state.downspouts.map((d) => ({
      ...d,
      lengthByDesc: { ...d.lengthByDesc },
      accQty: { ...d.accQty },
    })),
    generalAccQty: { ...state.generalAccQty },
    pitchPanQty: { ...state.pitchPanQty },
    collectionBoxQty: Object.fromEntries(
      Object.entries(state.collectionBoxQty).map(([k, v]) => [k, { ...v }]),
    ),
  };
  const hasQty = (m: Record<string, number>) => Object.values(m).some((q) => q > 0);
  switch (src.kind) {
    case "gutter":
    case "gutterAcc": {
      const i = next.gutters.findIndex((g) => g.style === src.style && g.size === src.size);
      if (i < 0) return state;
      const g = next.gutters[i]!;
      if (src.kind === "gutter") g.lengthFt = 0;
      else g.accQty = without(g.accQty, src.desc);
      if (g.lengthFt <= 0 && !hasQty(g.accQty)) next.gutters.splice(i, 1);
      return next;
    }
    case "downspout":
    case "downspoutAcc": {
      const i = next.downspouts.findIndex((d) => d.size === src.size);
      if (i < 0) return state;
      const d = next.downspouts[i]!;
      if (src.kind === "downspout") d.lengthByDesc = without(d.lengthByDesc, src.desc);
      else d.accQty = without(d.accQty, src.desc);
      if (!hasQty(d.lengthByDesc) && !hasQty(d.accQty)) next.downspouts.splice(i, 1);
      return next;
    }
    case "generalAcc":
      next.generalAccQty = without(next.generalAccQty, src.desc);
      return next;
    case "pitchPan":
      next.pitchPanQty = without(next.pitchPanQty, src.desc);
      return next;
    case "collectionBox": {
      const byDesc = without(next.collectionBoxQty[src.option] ?? {}, src.desc);
      if (hasQty(byDesc)) next.collectionBoxQty[src.option] = byDesc;
      else delete next.collectionBoxQty[src.option];
      return next;
    }
  }
}

/** Remove every entry of one tile (gutters / downspouts / pitch pans / collection boxes). */
export function clearMetalsCategory(state: MetalsState, category: MetalsCategory): MetalsState {
  switch (category) {
    case "Gutters":
      return { ...state, gutters: [] };
    case "Downspouts":
      return { ...state, downspouts: [], generalAccQty: {} };
    case "Pitch Pans":
      return { ...state, pitchPanQty: {} };
    case "Collection Boxes":
      return { ...state, collectionBoxQty: {} };
  }
}
