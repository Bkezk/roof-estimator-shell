/**
 * §14 Non-Duro-Last Items — the legacy Non-DL screen money path, extracted from the licensed
 * install's DataAccess.dll IL (BidAdvantage.DataAccess.NDLItem, NDLCollectionBase, the nine
 * collections EdgeBlockings / WallBlockings / DeckMaterials / SheetMetals / Masonry / Services /
 * Subcontractors / CustomApps / NDLOthers, NonDL, ReviewCalc.Recalculate) and Estimator.exe
 * (frmNonDL + frmNonDL1..6 designer IL, FieldChanged handlers, RefreshSummary).
 *
 * Extracted semantics:
 *
 *  NDLItem (one catalog row or a user-added row)
 *   - Qty(total) = Extra (user "Qty"/"Extra") + CalcQty (auto from bid geometry).
 *   - MaterialCost = toSingle(Qty(total) × UnitCost, 4)          (Round 4 dp → Single)
 *   - Labor (hours) = Qty(total) × LaborPerUnit  (recomputed on Qty / CalcQty / LaborPerUnit
 *     changes); typing Hours directly stores Round(hours, 2) and back-derives
 *     LaborPerUnit = Round(hours / Qty(total), 2).
 *   - LaborCost = toSingle(Labor × LaborRate, 4).
 *   - LaborRate: the ref row's rate, or the ESTIMATE crew rate when the ref rate is 0
 *     (NDLCollectionBase.ReadRefData); a user-added row inherits the previous row's rate (crew
 *     rate when first). "Use Estimate Labor" resets every row of the dialog to the crew rate.
 *   - IsPresent = Labor > 0 or Qty(total) > 0.
 *
 *  Collections sum MaterialCost / LaborCost / Labor in double. The "Material Total" override
 *  (NDLCollectionBase.bOverride / m_dMaterialCostOverride, the "Subcontractor" lump sum) is
 *  DEAD CODE in the shipped build: bOverride is initialised false in the ctor and no code path
 *  ever sets it, so the typed total never bills — not reproduced.
 *
 *  Auto CalcQty (RecalcParents, per collection):
 *   - Roof Edge Blocking: per present roof section, greedy-fill the section's underlayment
 *     thickness (Σ layer RealThickness) with the FIRST FOUR rows' thicknesses (ref column
 *     "Thickness" = OtherRefData) from row 3 down to row 0 while thickness > 0.6, then one more
 *     row-0 board when 0.5 ≤ remainder; CalcQty[i] += toInt(Ceil(count[i] × BlockingLinealFt ×
 *     f32(1.03))).
 *   - Top of Parapet Wall Blocking row 0: ToInt32(Ceil(Parapets.BlockingLinealFt × 1.03)).
 *   - Sheet Metal RefID 1 (Curb Counter Flashing): the §8.3 curb counterflash feet.
 *   - Masonry RefID 1 (Remove Only): Ceil(Σ option-1 capstone LF / 2); RefID 2 (Mortar Mix —
 *     the "install" index): Ceil(Σ option-2 capstone LF / 2). "Replace Capstones" is manual.
 *   - Services RefID 3 (Dumpster): RoofSections.TearOffVolume = disposal units.
 *   - Others RefID 1 (DL Approved Slipsheet): Ceil(Parapets.PolyethyleneSqFt +
 *     Curbs.PolyethyleneSqFt); RefID 2: Ceil(Curbs.ISO_SqFt).
 *
 *  ReviewCalc: six groups i=0..5 → [Wall+Edge Blocking, Deck Materials, Sheet Metals, Masonry,
 *  Custom, Others]: dMaterial[14+i] = material (→ MaterialTotalBeforeTax, taxable; dTotals[7]
 *  OtherMaterial = NonDL.MaterialCost = the same six), dLabor[14+i,0] = LaborCost,
 *  dLabor[14+i,1] = hours — direct labor at each row's own rate. Subcontractors and Services
 *  get one dLabor row each PER ITEM = MaterialCost + LaborCost (and hours), all accumulated
 *  into the LaborSubtotal2 row. NonDL.MaterialCostIncludingServices (summary Totals) adds
 *  Services material; Subcontractors material is never material.
 *
 *  Legacy screen: "Non-Duro-Last Items", six tiles (Wood & Edge Blocking / Structural Roof
 *  Deck Materials / Sheet Metal Work / Masonry Work / Sub-Contractors and Services /
 *  Customized Contractor Applications) + lvSummary (Category | Item | Qty. | Cost/Quote |
 *  Hours | Labor Cost, hours shown Round 3) + Edit. Summary categories in order: Roof Edge
 *  Blocking, Wall Blocking, Roof Deck Materials, Sheet Metals, Masonry, Services,
 *  Subcontractors, Custom Applications, Others.
 */

import { bankersRound } from "./rounding";

const f32 = Math.fround;
/** DACommon.toSingle(x, 4): Round to 4 dp (banker's) then to Single. */
const toSingle4 = (x: number) => f32(bankersRound(x, 4));

export type NonDlGroup =
  | "roofEdgeBlocking"
  | "wallBlocking"
  | "deckMaterials"
  | "sheetMetal"
  | "masonry"
  | "services"
  | "subcontractors"
  | "customApps"
  | "others";

export const NON_DL_GROUPS: NonDlGroup[] = [
  "roofEdgeBlocking",
  "wallBlocking",
  "deckMaterials",
  "sheetMetal",
  "masonry",
  "services",
  "subcontractors",
  "customApps",
  "others",
];

/** pricing_catalog screen id per legacy collection. */
export const NON_DL_SCREEN_ID: Record<NonDlGroup, string> = {
  roofEdgeBlocking: "non_dl:roof_edge_blocking",
  wallBlocking: "non_dl:parapet_wall_blocking",
  deckMaterials: "non_dl:structural_deck_materials",
  sheetMetal: "non_dl:sheet_metal_work",
  masonry: "non_dl:masonry",
  services: "non_dl:3rd_party_services",
  subcontractors: "non_dl:subcontractors",
  customApps: "non_dl:preset_custom_applications",
  others: "non_dl:others",
};

/** Legacy lvSummary category labels (frmNonDL.RefreshSummary). */
export const NON_DL_CATEGORY_LABEL: Record<NonDlGroup, string> = {
  roofEdgeBlocking: "Roof Edge Blocking",
  wallBlocking: "Wall Blocking",
  deckMaterials: "Roof Deck Materials",
  sheetMetal: "Sheet Metals",
  masonry: "Masonry",
  services: "Services",
  subcontractors: "Subcontractors",
  customApps: "Custom Applications",
  others: "Others",
};

/** Groups whose whole cost (material + labor) is LaborSubtotal2 in ReviewCalc. */
export const NON_DL_LS2_GROUPS: ReadonlySet<NonDlGroup> = new Set(["services", "subcontractors"]);

// ─────────────────────────────────────────────────────────────────────────────
// Ref data
// ─────────────────────────────────────────────────────────────────────────────

export interface NonDlRefRow {
  description: string;
  unitCost: number;
  laborPerUnit: number;
  /** Ref $/hr; 0 means "use the estimate crew rate" (legacy ReadRefData). */
  laborRate: number;
  /** Legacy RefID (seed order, 1-based) — the auto-quantity hooks key on it. */
  refId: number;
  /** Roof Edge Blocking rows: the legacy "Thickness" ref column (OtherRefData), inches. */
  thicknessIn?: number;
  /** Seeded with `_uncaptured` — the row exists but its money was never captured. */
  uncaptured?: boolean;
}

export interface NonDlRefData {
  rows: Partial<Record<NonDlGroup, NonDlRefRow[]>>;
  /** Settings.DumpsterYards (3rd Party Services screen extras.yardage). */
  dumpsterYardage?: number;
}

interface RawScreenRow {
  [k: string]: unknown;
}
interface RawScreen {
  rows?: RawScreenRow[];
  extras?: Record<string, unknown>;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Parse a leading inch dimension from a board / blocking description: `1/4"`, `1 1/2"`,
 * `2.7"`, `2"`, `½"`, `¾"`, `5/4"`. Returns 0 when the name carries no dimension (slip sheets).
 * NOTE: the legacy reads the ref column "Thickness" (RoofEdgeBlocking) / Underlayment
 * RealThickness — neither column was captured into the seed, so the dimension in the row's own
 * name stands in (docs §14). A seeded numeric "Thickness" key wins when present.
 */
export function parseInches(desc: string): number {
  const s = desc.trim().replace("½", "1/2").replace("¼", "1/4").replace("¾", "3/4");
  let m = /^(\d+)\s+(\d+)\/(\d+)\s*"/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\/(\d+)\s*"/.exec(s);
  if (m) return Number(m[1]) / Number(m[2]);
  m = /^(\d+(?:\.\d+)?)\s*"/.exec(s);
  if (m) return Number(m[1]);
  return 0;
}

export function buildNonDlRefData(
  screens: Array<{ id: string; category?: string; data: unknown }>,
): NonDlRefData {
  const ref: NonDlRefData = { rows: {} };
  for (const group of NON_DL_GROUPS) {
    const screen = screens.find((s) => s.id === NON_DL_SCREEN_ID[group]);
    if (!screen) continue;
    const data = (screen.data ?? {}) as RawScreen;
    const rows: NonDlRefRow[] = [];
    for (const r of data.rows ?? []) {
      const description = String(r["Description"] ?? r["Name"] ?? "").trim();
      if (!description) continue;
      const row: NonDlRefRow = {
        description,
        unitCost: num(r["Price"]),
        laborPerUnit: num(r["LaborPerUnit"]),
        laborRate: num(r["Labor Rate"]),
        refId: rows.length + 1,
      };
      if (group === "roofEdgeBlocking") {
        row.thicknessIn =
          typeof r["Thickness"] === "number"
            ? (r["Thickness"] as number)
            : parseInches(description);
      }
      if (r["_uncaptured"] === true) row.uncaptured = true;
      rows.push(row);
    }
    ref.rows[group] = rows;
    if (group === "services") {
      const y = num(data.extras?.["yardage"]);
      if (y > 0) ref.dumpsterYardage = y;
    }
  }
  return ref;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bid-side state
// ─────────────────────────────────────────────────────────────────────────────

export interface NonDlRowState {
  /** The user "Extra" / "Qty" on top of CalcQty. */
  extra: number;
  /** Per-bid overrides of the ref values (undefined = ref default). */
  unitCost?: number;
  laborPerUnit?: number;
  laborRate?: number;
  /** Typed Hours (legacy set_Labor, Round 2): used verbatim until the qty changes. */
  laborHours?: number;
}

export interface NonDlCustomRow {
  description: string;
  qty: number;
  unitCost: number;
  laborPerUnit: number;
  laborRate: number;
  laborHours?: number;
}

export interface NonDlState {
  /** group → ref row description → state. */
  rows: Partial<Record<NonDlGroup, Record<string, NonDlRowState>>>;
  /** group → user-added rows (the dialogs' blank last row). */
  custom: Partial<Record<NonDlGroup, NonDlCustomRow[]>>;
}

export function emptyNonDlState(): NonDlState {
  return { rows: {}, custom: {} };
}

export function normalizeNonDlState(raw: unknown): NonDlState {
  const st = emptyNonDlState();
  if (!raw || typeof raw !== "object") return st;
  const o = raw as Record<string, unknown>;
  const pos = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  const opt = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
  const isGroup = (g: string): g is NonDlGroup => (NON_DL_GROUPS as string[]).includes(g);
  if (o["rows"] && typeof o["rows"] === "object") {
    for (const [g, m] of Object.entries(o["rows"] as Record<string, unknown>)) {
      if (!isGroup(g) || !m || typeof m !== "object") continue;
      const out: Record<string, NonDlRowState> = {};
      for (const [desc, rs] of Object.entries(m as Record<string, unknown>)) {
        if (!rs || typeof rs !== "object") continue;
        const r = rs as Record<string, unknown>;
        const s: NonDlRowState = { extra: pos(r["extra"]) };
        const uc = opt(r["unitCost"]);
        const lpu = opt(r["laborPerUnit"]);
        const lr = opt(r["laborRate"]);
        const lh = opt(r["laborHours"]);
        if (uc !== undefined) s.unitCost = uc;
        if (lpu !== undefined) s.laborPerUnit = lpu;
        if (lr !== undefined) s.laborRate = lr;
        if (lh !== undefined) s.laborHours = lh;
        if (
          s.extra > 0 ||
          s.unitCost !== undefined ||
          s.laborPerUnit !== undefined ||
          s.laborRate !== undefined ||
          s.laborHours !== undefined
        )
          out[desc] = s;
      }
      if (Object.keys(out).length > 0) st.rows[g] = out;
    }
  }
  if (o["custom"] && typeof o["custom"] === "object") {
    for (const [g, arr] of Object.entries(o["custom"] as Record<string, unknown>)) {
      if (!isGroup(g) || !Array.isArray(arr)) continue;
      const list: NonDlCustomRow[] = [];
      for (const c of arr as Array<Record<string, unknown>>) {
        if (!c || typeof c !== "object" || typeof c["description"] !== "string") continue;
        const row: NonDlCustomRow = {
          description: c["description"],
          qty: pos(c["qty"]),
          unitCost: pos(c["unitCost"]),
          laborPerUnit: pos(c["laborPerUnit"]),
          laborRate: pos(c["laborRate"]),
        };
        const lh = opt(c["laborHours"]);
        if (lh !== undefined) row.laborHours = lh;
        list.push(row);
      }
      if (list.length > 0) st.custom[g] = list;
    }
  }
  return st;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry → CalcQty
// ─────────────────────────────────────────────────────────────────────────────

export interface NonDlGeometry {
  /** Present roof sections: wood-blocking lineal ft + total underlayment thickness (in). */
  sections: Array<{ blockingLinealFt: number; underlaymentThicknessIn: number }>;
  /** Parapets.BlockingLinealFt = Σ Length where HasBlocking. */
  parapetBlockingLinealFt: number;
  /** §8.3 curb counter-flashing feet (already ceiled). */
  curbCounterflashFt: number;
  /** Σ option-1 / option-2 capstone lengths (ft). */
  capstoneRemoveLf: number;
  capstoneReplaceLf: number;
  /** RoofSections.TearOffVolume — disposal units. */
  disposalUnits: number;
  /** Parapets.PolyethyleneSqFt + Curbs.PolyethyleneSqFt. */
  polyethyleneSqFt: number;
  /** Curbs.ISO_SqFt. */
  curbIsoSqFt: number;
}

/** Legacy EdgeBlockings.RecalcParents — the thickness greedy fill over the first four rows. */
export function edgeBlockingCalcQty(
  rows: NonDlRefRow[],
  sections: NonDlGeometry["sections"],
): number[] {
  const calc = rows.map(() => 0);
  if (rows.length < 4) return calc;
  const ord = [0, 1, 2, 3].map((i) => rows[i]!.thicknessIn ?? 0);
  for (const s of sections) {
    let t = s.underlaymentThicknessIn;
    const counts = [0, 0, 0, 0];
    let guard = 0;
    while (t > 0.6 && guard++ < 64) {
      let i = 3;
      let placed = false;
      while (i >= 0) {
        if (ord[i]! <= t) {
          counts[i]!++;
          t -= ord[i]!;
          placed = true;
          break;
        }
        i--;
      }
      if (!placed) break; // no board fits (would spin in the legacy)
    }
    if (t >= 0.5) counts[0]!++;
    for (let i = 3; i >= 0; i--) {
      calc[i]! += Math.ceil(counts[i]! * s.blockingLinealFt * f32(1.03));
    }
  }
  return calc;
}

/** CalcQty per group per ref row index (legacy RecalcParents). */
export function nonDlCalcQuantities(
  ref: NonDlRefData,
  geo: NonDlGeometry,
): Partial<Record<NonDlGroup, number[]>> {
  const out: Partial<Record<NonDlGroup, number[]>> = {};
  const zeros = (g: NonDlGroup) => (ref.rows[g] ?? []).map(() => 0);
  const setRef = (g: NonDlGroup, refId: number, qty: number) => {
    const rows = ref.rows[g] ?? [];
    const idx = rows.findIndex((r) => r.refId === refId);
    if (idx < 0) return false;
    (out[g] ??= zeros(g))[idx] = qty;
    return true;
  };
  if (ref.rows.roofEdgeBlocking) {
    out.roofEdgeBlocking = edgeBlockingCalcQty(ref.rows.roofEdgeBlocking, geo.sections);
  }
  if (geo.parapetBlockingLinealFt > 0)
    setRef("wallBlocking", 1, Math.ceil(geo.parapetBlockingLinealFt * 1.03));
  if (geo.curbCounterflashFt > 0) setRef("sheetMetal", 1, geo.curbCounterflashFt);
  if (geo.capstoneRemoveLf > 0) setRef("masonry", 1, Math.ceil(geo.capstoneRemoveLf / 2));
  if (geo.capstoneReplaceLf > 0) setRef("masonry", 2, Math.ceil(geo.capstoneReplaceLf / 2));
  if (geo.disposalUnits > 0) setRef("services", 3, geo.disposalUnits);
  if (geo.polyethyleneSqFt > 0) setRef("others", 1, Math.ceil(geo.polyethyleneSqFt));
  if (geo.curbIsoSqFt > 0) setRef("others", 2, Math.ceil(geo.curbIsoSqFt));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute
// ─────────────────────────────────────────────────────────────────────────────

export interface NonDlLine {
  group: NonDlGroup;
  category: string;
  item: string;
  calcQty: number;
  extraQty: number;
  qty: number;
  unitCost: number;
  materialCost: number;
  laborPerUnit: number;
  hours: number;
  laborRate: number;
  laborCost: number;
  isCustom: boolean;
  /** Row exists in the seed without captured money (docs §14). */
  unpriced?: boolean;
}

export interface NonDlGroupTotal {
  material: number;
  hours: number;
  laborCost: number;
}

export interface NonDlResult {
  lines: NonDlLine[];
  byGroup: Record<NonDlGroup, NonDlGroupTotal>;
  /** dTotals[7] / dMaterial[14..19]: the six material groups (no services, no subs). */
  otherMaterial: number;
  /** dLabor[14..19] — direct labor at each row's own rate; hours join man-days. */
  ownRateLaborCost: number;
  ownRateLaborHours: number;
  /** LaborSubtotal2 shares: material + labor per item. */
  subsCost: number;
  subsHours: number;
  servicesCost: number;
  servicesHours: number;
  /** Summary "Totals" row (NonDL.MaterialCostIncludingServices / Labor / LaborCost). */
  totalMaterialIncludingServices: number;
  totalHours: number;
  totalLaborCost: number;
  /** Rows carrying auto quantities the seed can't price yet (uncaptured money). */
  warnings: string[];
}

function emptyTotals(): Record<NonDlGroup, NonDlGroupTotal> {
  const out = {} as Record<NonDlGroup, NonDlGroupTotal>;
  for (const g of NON_DL_GROUPS) out[g] = { material: 0, hours: 0, laborCost: 0 };
  return out;
}

export interface ComputeNonDlArgs {
  state: NonDlState;
  ref: NonDlRefData;
  geometry: NonDlGeometry;
  crewRate: number;
}

export function computeNonDl(args: ComputeNonDlArgs): NonDlResult {
  const { state, ref, geometry, crewRate } = args;
  const calc = nonDlCalcQuantities(ref, geometry);
  const lines: NonDlLine[] = [];
  const byGroup = emptyTotals();
  const warnings: string[] = [];

  const push = (
    group: NonDlGroup,
    item: string,
    calcQty: number,
    extraQty: number,
    unitCost: number,
    laborPerUnit: number,
    laborRate: number,
    laborHoursOverride: number | undefined,
    isCustom: boolean,
    unpriced: boolean,
  ) => {
    const qty = extraQty + calcQty;
    const hours = laborHoursOverride ?? f32(qty * f32(laborPerUnit));
    if (!(hours > 0) && !(qty > 0)) return; // NDLItem.IsPresent
    const materialCost = toSingle4(qty * unitCost);
    const laborCost = toSingle4(hours * laborRate);
    lines.push({
      group,
      category: NON_DL_CATEGORY_LABEL[group],
      item,
      calcQty,
      extraQty,
      qty,
      unitCost,
      materialCost,
      laborPerUnit,
      hours,
      laborRate,
      laborCost,
      isCustom,
      ...(unpriced ? { unpriced: true } : {}),
    });
    const t = byGroup[group];
    t.material += materialCost;
    t.hours += hours;
    t.laborCost += laborCost;
  };

  for (const group of NON_DL_GROUPS) {
    const rows = ref.rows[group] ?? [];
    const rowState = state.rows[group] ?? {};
    const calcRow = calc[group] ?? [];
    rows.forEach((row, i) => {
      const st = rowState[row.description];
      const calcQty = calcRow[i] ?? 0;
      const extra = st?.extra ?? 0;
      const unitCost = st?.unitCost ?? row.unitCost;
      const laborPerUnit = st?.laborPerUnit ?? row.laborPerUnit;
      const laborRate = st?.laborRate ?? (row.laborRate !== 0 ? row.laborRate : crewRate);
      const unpriced = row.uncaptured === true && unitCost === 0 && laborPerUnit === 0;
      if (unpriced && calcQty + extra > 0)
        warnings.push(
          `${NON_DL_CATEGORY_LABEL[group]}: "${row.description}" needs ${calcQty + extra} but its price/labor were never captured — enter them on the admin Non-DL screen.`,
        );
      push(
        group,
        row.description,
        calcQty,
        extra,
        unitCost,
        laborPerUnit,
        laborRate,
        st?.laborHours,
        false,
        unpriced,
      );
    });
    for (const c of state.custom[group] ?? []) {
      push(
        group,
        c.description,
        0,
        c.qty,
        c.unitCost,
        c.laborPerUnit,
        c.laborRate,
        c.laborHours,
        true,
        false,
      );
    }
  }

  const materialGroups = NON_DL_GROUPS.filter((g) => !NON_DL_LS2_GROUPS.has(g));
  const otherMaterial = materialGroups.reduce((s, g) => s + byGroup[g].material, 0);
  const ownRateLaborCost = materialGroups.reduce((s, g) => s + byGroup[g].laborCost, 0);
  const ownRateLaborHours = materialGroups.reduce((s, g) => s + byGroup[g].hours, 0);
  const subsCost = byGroup.subcontractors.material + byGroup.subcontractors.laborCost;
  const servicesCost = byGroup.services.material + byGroup.services.laborCost;

  return {
    lines,
    byGroup,
    otherMaterial,
    ownRateLaborCost,
    ownRateLaborHours,
    subsCost,
    subsHours: byGroup.subcontractors.hours,
    servicesCost,
    servicesHours: byGroup.services.hours,
    totalMaterialIncludingServices: otherMaterial + byGroup.services.material,
    totalHours: NON_DL_GROUPS.reduce((s, g) => s + byGroup[g].hours, 0),
    totalLaborCost: NON_DL_GROUPS.reduce((s, g) => s + byGroup[g].laborCost, 0),
    warnings,
  };
}
