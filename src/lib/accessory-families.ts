/**
 * Accessory families on a bid (owner, Oct 26–27): "on the accessories page while making a bid
 * all the current options can be minimized under a label DL accessories. then we need two
 * additional options. Non DL TPO accessories, and EPDM accessories … We need it to behave how
 * the accessories behave for DL … all 3 always available."
 *
 * The frozen engine (src/lib/engine/**) computes ONE accessories tab from ONE AccessoryRefData.
 * This module, outside the engine, builds a ref per family from the catalog branches the seed
 * loads (src/lib/pricing-seed/accessory-families.ts: `non_dl_tpo:<screen>` and `epdm:<screen>`
 * carry the same screen ids and columns as the Duro-Last ones), runs the engine once per family
 * and folds the two extra families' results into the bid's flat `accessories` lines, which the
 * bid builder already bills (price × quantity into the accessory material slot, hours × quantity
 * into crew-rate direct labor).
 *
 * Duro-Tech TPO: the Duro-Last screens carry Duro-Tech rows prefixed `DURO_TECH_PREFIX`. They
 * apply to a bid whose roof system is "Duro-Tech TPO" ONLY — a Duro-Last bid never sees the TPO
 * stacks, vents, corners or boots (the owner's Duro-Tech items are Duro-Tech accessories, not
 * extra Duro-Last options). On a Duro-Tech bid a prefixed vent (by colour) or pipe stack (by
 * size) REPLACES the Duro-Last row of the same key, so the automatic counts land on the TPO
 * part; every other prefixed row is ADDED beside the Duro-Last rows.
 *
 * ONE family counts the roof (owner, Oct 27: the three groups each counted the roof's term bar,
 * so a bid showed the same $134.30 / 22.29 h in the Non-DL TPO and EPDM groups on top of the DL
 * group — triple counting). The bid's roof system picks its ACTIVE family (`activeFamily`): only
 * that family's group counts from the roof (sections, parapets, curbs, fastener needs, term bar
 * footage, vents, T-joints, stripping, ARP); the other two groups stay available but bill the
 * quantities typed into them only — they are computed with no geometry. On a Non-DL TPO or EPDM
 * bid the engine's own §12 pass is switched off (`adminForBid` hands it no accessories ref) and
 * the DL group is computed out here, typed-only, like the two families.
 */

import {
  computeAccessories,
  EDGE_FASTENER_GROUPS,
  normalizeAccessoriesState,
  parapetEdgeFastenersCount,
  type AccessoriesResult,
  type AccessoriesState,
  type AccessoryRefData,
  type AccessoryReviewLine,
  type ComputeAccessoriesArgs,
} from "@/lib/engine/accessories";
import {
  buildAccessoryRefData,
  type EngineAdminData,
  type MembraneScreen,
} from "@/lib/engine/adapters";
import type {
  AccessoryLine,
  BidSectionInput,
  CurbInput,
  ParapetInput,
} from "@/lib/engine/bid-builder";

/* ------------------------------------------------------------------------------------------------
 * The families
 * ---------------------------------------------------------------------------------------------- */

export const FAMILIES = ["duroLast", "nonDlTpo", "epdm"] as const;
export type AccessoryFamily = (typeof FAMILIES)[number];

export const FAMILY_LABEL: Record<AccessoryFamily, string> = {
  duroLast: "DL accessories",
  nonDlTpo: "Non-DL TPO accessories",
  epdm: "EPDM accessories",
};

export const FAMILY_BRANCH: Record<AccessoryFamily, string> = {
  duroLast: "duro_last",
  nonDlTpo: "non_dl_tpo",
  epdm: "epdm",
};

/** The two families always computed outside the engine's own accessories pass. */
export const EXTRA_FAMILIES = ["nonDlTpo", "epdm"] as const;
export type ExtraFamily = (typeof EXTRA_FAMILIES)[number];

/** The two roof systems whose bids are not Duro-Last family (engine/adapters LEGACY_RS_ID_BY_NAME). */
export const NON_DL_TPO_SYSTEM = "Non-DL TPO";
export const EPDM_SYSTEM = "EPDM Rubber";

/**
 * The family whose group counts from the roof on a bid: "Non-DL TPO" → nonDlTpo, "EPDM Rubber" →
 * epdm, every other system (Duro-Last, Duro-Bond, Duro-Tuff, Duro-Roof, Duro-Fleece, Duro-Tech
 * TPO) → duroLast.
 */
export function activeFamily(roofSystem: string): AccessoryFamily {
  if (roofSystem === NON_DL_TPO_SYSTEM) return "nonDlTpo";
  if (roofSystem === EPDM_SYSTEM) return "epdm";
  return "duroLast";
}

/**
 * The one-line note under a group that is not the bid's active family: its roof counts are in
 * the active group, it bills typed quantities only. Null for the active group.
 */
export function inactiveFamilyNote(family: AccessoryFamily, roofSystem: string): string | null {
  const active = activeFamily(roofSystem);
  if (active === family) return null;
  const article = /^[aeiou]/i.test(roofSystem) ? "an" : "a";
  return `Counts from the roof go to the ${FAMILY_LABEL[active]} group on ${article} ${roofSystem} bid; this group bills the quantities you type.`;
}

/**
 * Seed conventions (src/lib/pricing-seed/accessory-families.ts), repeated here so the estimator
 * bundle does not carry the 1,600-line seed; accessory-families.test.ts pins them equal.
 */
export const DURO_TECH_PREFIX = "Duro-Tech TPO ";
export const DURO_TECH_SYSTEM = "Duro-Tech TPO";
export const OTHER_ACCESSORIES_SCREEN = "other_accessories";

/** One pricing_catalog row as the engine adapters read it. */
export interface CatalogRow {
  id: string;
  category: string;
  data: MembraneScreen;
}

type Cell = string | number | null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/* ------------------------------------------------------------------------------------------------
 * Catalog row shaping
 * ---------------------------------------------------------------------------------------------- */

/**
 * The rows of one family branch with their ids rewritten `${branch}:<screen>` →
 * `duro_last:<screen>`, which is the only id prefix `buildAccessoryRefData` looks up. Rows of any
 * other branch are dropped.
 */
export function familyCatalogRows(branchRows: CatalogRow[], branch: string): CatalogRow[] {
  const prefix = `${branch}:`;
  return branchRows
    .filter((r) => r.id.startsWith(prefix))
    .map((r) => ({ ...r, id: `duro_last:${r.id.slice(prefix.length)}` }));
}

const isDuroTechRow = (r: Record<string, Cell>): boolean =>
  str(r["Description"]).startsWith(DURO_TECH_PREFIX);

const stripPrefix = (r: Record<string, Cell>): Record<string, Cell> => ({
  ...r,
  Description: str(r["Description"]).slice(DURO_TECH_PREFIX.length),
});

/** The replacement key per screen: vents by colour name, pipe stacks by numeric size. */
function replaceKey(screenId: string): ((r: Record<string, Cell>) => string) | null {
  if (screenId === "duro_last:vents") return (r) => str(r["Description"]).trim().toLowerCase();
  if (screenId === "duro_last:pipe_stacks") return (r) => String(Number(r["Size"]));
  return null;
}

/**
 * Split the Duro-Last branch into the two ref-data sources:
 *  - `plain`: every screen without its Duro-Tech-prefixed rows — the ref for every bid that is
 *    not Duro-Tech TPO;
 *  - `duroTech`: the same screens with the prefix stripped off the Duro-Tech rows; on `vents`
 *    (by colour) and `pipe_stacks` (by Size) a Duro-Tech row takes the place of the Duro-Last
 *    row of the same key (in that row's position), everywhere else the stripped rows are
 *    appended beside the Duro-Last ones.
 * Screens with no `rows` array (the Exceptional Metals subscreens shape) pass through untouched.
 */
export function splitDuroTech(duroLastRows: CatalogRow[]): {
  plain: CatalogRow[];
  duroTech: CatalogRow[];
} {
  const plain: CatalogRow[] = [];
  const duroTech: CatalogRow[] = [];
  for (const row of duroLastRows) {
    const rows = Array.isArray(row.data?.rows) ? row.data.rows : null;
    if (!rows) {
      plain.push(row);
      duroTech.push(row);
      continue;
    }
    const base = rows.filter((r) => !isDuroTechRow(r));
    const dt = rows.filter(isDuroTechRow).map(stripPrefix);
    plain.push({ ...row, data: { ...row.data, rows: base } });
    if (dt.length === 0) {
      duroTech.push({ ...row, data: { ...row.data, rows: base } });
      continue;
    }
    const keyOf = replaceKey(row.id);
    let merged: Array<Record<string, Cell>>;
    if (keyOf) {
      const byKey = new Map(dt.map((r) => [keyOf(r), r] as const));
      const used = new Set<string>();
      merged = base.map((r) => {
        const k = keyOf(r);
        const rep = byKey.get(k);
        if (!rep) return r;
        used.add(k);
        return rep;
      });
      for (const r of dt) if (!used.has(keyOf(r))) merged.push(r);
    } else {
      merged = [...base, ...dt];
    }
    duroTech.push({ ...row, data: { ...row.data, rows: merged } });
  }
  return { plain, duroTech };
}

/* ------------------------------------------------------------------------------------------------
 * Other accessories (typed quantity × price, hours per unit)
 * ---------------------------------------------------------------------------------------------- */

export interface OtherAccessoryItem {
  description: string;
  part: string;
  price: number;
  laborHoursPerUnit: number;
}

/** The `other_accessories` screen rows (Description | Part # | Price | Labor (Hrs)) as pickables. */
export function otherAccessoryItems(
  screen: MembraneScreen | null | undefined,
): OtherAccessoryItem[] {
  const out: OtherAccessoryItem[] = [];
  for (const r of screen?.rows ?? []) {
    const description = str(r["Description"]).trim();
    if (!description) continue;
    out.push({
      description,
      part: str(r["Part #"]),
      price: num(r["Price"]),
      laborHoursPerUnit: num(r["Labor (Hrs)"] ?? r["Labor(Hrs)"]),
    });
  }
  return out;
}

/** The picked Other-accessories lines per family (saved on the bid). */
export interface OtherAccessoryLines {
  duroLast: AccessoryLine[];
  nonDlTpo: AccessoryLine[];
  epdm: AccessoryLine[];
}

export const emptyOtherAccessories = (): OtherAccessoryLines => ({
  duroLast: [],
  nonDlTpo: [],
  epdm: [],
});

/** Fill a saved (possibly partial / older) `otherAccessories` so every family has an array. */
export function normalizeOtherAccessories(
  o: Partial<OtherAccessoryLines> | null | undefined,
): OtherAccessoryLines {
  const arr = (v: unknown): AccessoryLine[] => (Array.isArray(v) ? (v as AccessoryLine[]) : []);
  return { duroLast: arr(o?.duroLast), nonDlTpo: arr(o?.nonDlTpo), epdm: arr(o?.epdm) };
}

/** An Other-accessories pick as the bid stores it: quantity blank (0) until typed. */
export function otherAccessoryLine(item: OtherAccessoryItem): AccessoryLine {
  return {
    description: item.description,
    price: item.price,
    quantity: 0,
    laborHoursPerUnit: item.laborHoursPerUnit,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Family ref data on the admin snapshot
 * ---------------------------------------------------------------------------------------------- */

export interface FamilyAccessoryData {
  refs: {
    /** Duro-Last screens without the Duro-Tech rows: every bid that is not Duro-Tech TPO. */
    plain: AccessoryRefData;
    /** Duro-Last screens with the Duro-Tech rows merged in: a "Duro-Tech TPO" bid. */
    duroTech: AccessoryRefData;
    nonDlTpo: AccessoryRefData;
    epdm: AccessoryRefData;
  };
  other: {
    duroLast: OtherAccessoryItem[];
    nonDlTpo: OtherAccessoryItem[];
    epdm: OtherAccessoryItem[];
  };
}

/** The engine's admin data plus the family refs; the engine ignores the extra field. */
export type AdminSnapshot = EngineAdminData & {
  accessoryFamilies?: FamilyAccessoryData | undefined;
};

/**
 * Build the family data from the raw catalog rows: the whole `duro_last` branch, the
 * `non_dl_tpo` + `epdm` branch rows, and the `accessory_labor` rows (the lead seeds labor rows
 * for the family descriptions and for the Duro-Tech descriptions WITHOUT the prefix).
 */
export function buildFamilyAccessoryData(args: {
  duroLastRows: CatalogRow[];
  familyRows: CatalogRow[];
  laborRows: CatalogRow[];
}): FamilyAccessoryData {
  const { plain, duroTech } = splitDuroTech(args.duroLastRows);
  const tpo = familyCatalogRows(args.familyRows, FAMILY_BRANCH.nonDlTpo);
  const epdm = familyCatalogRows(args.familyRows, FAMILY_BRANCH.epdm);
  const otherOf = (rows: CatalogRow[], branch: string) =>
    otherAccessoryItems(rows.find((r) => r.id === `${branch}:${OTHER_ACCESSORIES_SCREEN}`)?.data);
  return {
    refs: {
      plain: buildAccessoryRefData(plain, args.laborRows),
      duroTech: buildAccessoryRefData(duroTech, args.laborRows),
      nonDlTpo: buildAccessoryRefData(tpo, args.laborRows),
      epdm: buildAccessoryRefData(epdm, args.laborRows),
    },
    other: {
      duroLast: otherOf(args.duroLastRows, FAMILY_BRANCH.duroLast),
      // The family rows keep their own branch ids here (familyCatalogRows rewrote copies).
      nonDlTpo: otherOf(args.familyRows, FAMILY_BRANCH.nonDlTpo),
      epdm: otherOf(args.familyRows, FAMILY_BRANCH.epdm),
    },
  };
}

/** The Duro-Last screens' ref for a bid: the Duro-Tech merge on a "Duro-Tech TPO" bid, else plain. */
const duroLastRef = (fam: FamilyAccessoryData, roofSystem: string): AccessoryRefData =>
  roofSystem === DURO_TECH_SYSTEM ? fam.refs.duroTech : fam.refs.plain;

/**
 * The admin data the engine runs a bid with. On a Duro-Last-family bid the DL accessories ref is
 * the Duro-Tech merge on a "Duro-Tech TPO" bid and the plain Duro-Last screens otherwise. On a
 * Non-DL TPO or EPDM bid the engine must NOT run its §12 pass with the roof (the active family's
 * group counts it; the DL group is computed typed-only by computeFamilyResults), so the ref is
 * withheld — and the engine's legacy no-ref fallback, which would auto-price the roof's ARP sq ft
 * from `autoRates.arpPricePerSqFt` (a Duro-Last "ARP (SqFt)" row) or warn that it could not, is
 * neutralised with a zero ARP rate: no Duro-Last charge, no misleading warning. A snapshot without
 * families (frozen before they existed) is returned unchanged, so the engine runs DL with the roof
 * exactly as before.
 */
export function adminForBid<A extends AdminSnapshot>(admin: A, roofSystem: string): A {
  const fam = admin.accessoryFamilies;
  if (!fam) return admin;
  if (activeFamily(roofSystem) !== "duroLast") {
    return {
      ...admin,
      accessories: undefined,
      autoRates: { ...(admin.autoRates ?? {}), arpPricePerSqFt: 0 },
    };
  }
  return { ...admin, accessories: duroLastRef(fam, roofSystem) };
}

/**
 * The ref the DL group's screens read on this bid (undefined on a snapshot without any). Present
 * on every roof system: on a Non-DL TPO / EPDM bid the DL screens still show, typed-only.
 */
export function duroLastRefForBid(
  admin: AdminSnapshot | null | undefined,
  roofSystem: string,
): AccessoryRefData | undefined {
  if (!admin) return undefined;
  const fam = admin.accessoryFamilies;
  return fam ? duroLastRef(fam, roofSystem) : admin.accessories;
}

/* ------------------------------------------------------------------------------------------------
 * Running the engine per family and folding the result into the bid
 * ---------------------------------------------------------------------------------------------- */

/** The bid geometry the family computes read (the same the bid builder hands the engine). */
export interface FamilyGeometry {
  sections: BidSectionInput[];
  parapets?: ParapetInput[] | undefined;
  curbs?: CurbInput[] | undefined;
  roofSystem: string;
  attachment: "mechanical" | "adhered";
}

/** The saved per-family state (optional so older saved bids stay valid). */
export interface FamilyBidState {
  /** The DL group's state — read here only on a Non-DL TPO / EPDM bid (typed-only DL group). */
  accessoriesCalc?: Partial<AccessoriesState> | undefined;
  accessoriesCalcTpo?: Partial<AccessoriesState> | undefined;
  accessoriesCalcEpdm?: Partial<AccessoriesState> | undefined;
  otherAccessories?: Partial<OtherAccessoryLines> | undefined;
}

export const FAMILY_STATE_KEY: Record<
  AccessoryFamily,
  "accessoriesCalc" | "accessoriesCalcTpo" | "accessoriesCalcEpdm"
> = {
  duroLast: "accessoriesCalc",
  nonDlTpo: "accessoriesCalcTpo",
  epdm: "accessoriesCalcEpdm",
};

/**
 * The engine args for one family: the bid-builder's shape minus stripping, which is a Duro-Last
 * engine row. The bid's ACTIVE family gets the roof (sections, parapets, curbs, the parapet
 * wall-tab fastener count); any other family is computed with no geometry, so only the quantities
 * typed into its screens bill. Null when the snapshot carries no family refs.
 */
export function familyComputeArgs(
  family: AccessoryFamily,
  state: AccessoriesState,
  admin: AdminSnapshot,
  geo: FamilyGeometry,
): ComputeAccessoriesArgs | null {
  const fam = admin.accessoryFamilies;
  if (!fam) return null;
  const ref = family === "duroLast" ? duroLastRef(fam, geo.roofSystem) : fam.refs[family];
  const countsRoof = activeFamily(geo.roofSystem) === family;
  const parapets = countsRoof ? (geo.parapets ?? []) : [];
  const byBoard = admin.underlaymentGroups?.groupIdByBoard;
  return {
    state,
    ref,
    sections: countsRoof ? geo.sections : [],
    parapets,
    curbs: countsRoof ? (geo.curbs ?? []) : [],
    roofSystem: geo.roofSystem,
    attachment: geo.attachment,
    arpCalcSqFt: 0,
    parapetEdgeFasteners: countsRoof
      ? parapetEdgeFastenersCount(parapets, geo.roofSystem, geo.attachment)
      : 0,
    ...(byBoard ? { underlaymentSubtypeByBoard: byBoard } : {}),
  };
}

export type FamilyResults = Partial<Record<AccessoryFamily, AccessoriesResult>>;

/**
 * Run the engine for the Non-DL TPO and EPDM groups — the active one with the roof, the other
 * typed-only — and, on a Non-DL TPO / EPDM bid, for the DL group too (typed-only, with the
 * Duro-Last ref), since the engine's own pass is switched off there (adminForBid). Absent when
 * the snapshot has no families.
 */
export function computeFamilyResults(
  saved: FamilyBidState & FamilyGeometry,
  admin: AdminSnapshot | null | undefined,
): FamilyResults {
  const out: FamilyResults = {};
  if (!admin?.accessoryFamilies) return out;
  const families: readonly AccessoryFamily[] =
    activeFamily(saved.roofSystem) === "duroLast" ? EXTRA_FAMILIES : FAMILIES;
  for (const family of families) {
    const args = familyComputeArgs(
      family,
      normalizeAccessoriesState(saved[FAMILY_STATE_KEY[family]]),
      admin,
      saved,
    );
    if (args) out[family] = computeAccessories(args);
  }
  return out;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/**
 * A family's computed result as flat `AccessoryLine`s for the engine input — one line per
 * Accessories Summary row (`<Family label> · <screen> — <name>`), priced so that
 * Σ price × quantity = Σ line totals and Σ hours/unit × quantity = Σ line hours. When the
 * engine's own totals do not equal those sums (a screen billed outside its summary rows), the
 * family bills as ONE aggregate line instead, so the bid never drifts from the engine's figure.
 */
export function familyAccessoryLines(
  result: AccessoriesResult,
  family: AccessoryFamily,
): AccessoryLine[] {
  const label = FAMILY_LABEL[family];
  const lines: AccessoryLine[] = result.lines.map((l) => {
    const quantity = l.qty > 0 ? l.qty : 1;
    return {
      description: `${label} · ${l.screen} — ${l.name}`,
      price: l.totalCost / quantity,
      quantity,
      laborHoursPerUnit: l.hours / quantity,
    };
  });
  const cost = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const hours = lines.reduce((s, l) => s + (l.laborHoursPerUnit ?? 0) * l.quantity, 0);
  if (near(cost, result.totalCost, 0.005) && near(hours, result.manHours, 1e-6)) return lines;
  if (result.totalCost === 0 && result.manHours === 0) return [];
  return [
    {
      description: `${label} accessories`,
      price: result.totalCost,
      quantity: 1,
      laborHoursPerUnit: result.manHours,
    },
  ];
}

/**
 * The bid's engine-input `accessories`: the old flat picker lines, then each family's computed
 * lines (the DL group's only on a Non-DL TPO / EPDM bid, where the engine does not run them),
 * then every family's Other-accessories picks. Estimator and proposal both compose through here
 * so their totals cannot drift.
 */
export function composeAccessoryLines(
  flat: AccessoryLine[],
  results: FamilyResults,
  other: Partial<OtherAccessoryLines> | null | undefined,
): AccessoryLine[] {
  const o = normalizeOtherAccessories(other);
  return [
    ...flat,
    ...(results.duroLast ? familyAccessoryLines(results.duroLast, "duroLast") : []),
    ...(results.nonDlTpo ? familyAccessoryLines(results.nonDlTpo, "nonDlTpo") : []),
    ...(results.epdm ? familyAccessoryLines(results.epdm, "epdm") : []),
    ...o.duroLast,
    ...o.nonDlTpo,
    ...o.epdm,
  ];
}

/** `bid` with the family lines folded into its `accessories` (see composeAccessoryLines). */
export function withFamilyAccessories<B extends { accessories: AccessoryLine[] }>(
  bid: B,
  saved: FamilyBidState & FamilyGeometry,
  admin: AdminSnapshot | null | undefined,
): B {
  const results = computeFamilyResults(saved, admin);
  return {
    ...bid,
    accessories: composeAccessoryLines(bid.accessories, results, saved.otherAccessories),
  };
}

/* ------------------------------------------------------------------------------------------------
 * The family groups' fastener screens (owner's screenshot, Oct 27: Non-DL TPO › Parapet Wall-Tabs
 * showed "Fasteners Needed: 632 / Steel Plates Needed: 632" and no rows)
 * ---------------------------------------------------------------------------------------------- */

/** The two families whose fastener screens list rows by subtype (the DL group keeps its catalog keys). */
export const isNonDlFamily = (family: AccessoryFamily | undefined): family is ExtraFamily =>
  family === "nonDlTpo" || family === "epdm";

/**
 * Natural inch-size sort key for a fastener description: `1 1/2" Spade` → 1.5, `1-1/4" All-Purpose`
 * → 1.25, `10" Pre-Assembled` → 10; descriptions without a leading size sort last.
 */
export function fastenerInchKey(description: string): number {
  const m = /^(\d+)(?:[\s-]+(\d+)\/(\d+))?"/.exec(description.trim());
  if (!m) return 999;
  return Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
}

/**
 * The fastener catalog keys of a family ref's rows of the given subtypes, size-sorted — what a
 * family group's edge / parapet / plate grid lists instead of the engine's fixed Duro-Last keys
 * (EDGE_FASTENER_GROUPS / PLATE_ROWS: '3" Square Steel|DL-Plates', 'Metal Anchors|' …), which the
 * Firestone catalogs do not carry. Edge screens → Spade + XHD; Parapet Wall-Tabs → XHD; Steel
 * Plates → DL-Plates; Masonry Bits → Bit-*.
 */
export function familyFastenerKeys(
  ref: Pick<AccessoryRefData, "fasteners"> | undefined,
  subtypes: readonly string[],
): string[] {
  return (ref?.fasteners ?? [])
    .filter((f) => subtypes.includes(f.subtype))
    .sort((a, b) => fastenerInchKey(a.description) - fastenerInchKey(b.description))
    .map((f) => f.key);
}

export const FAMILY_EDGE_SUBTYPES: readonly string[] = ["Spade", "XHD"];
export const FAMILY_PARAPET_SUBTYPES: readonly string[] = ["XHD"];
export const FAMILY_PLATE_SUBTYPES: readonly string[] = ["DL-Plates"];

/**
 * The parapet screen's Needed figures for a family group. The frozen engine nets the parapet
 * entries against its Duro-Last group keys only (EDGE_FASTENER_GROUPS.parapet / PLATE_ROWS.steel),
 * so a family's typed XHD and plate rows would leave its counters red for ever; this nets them
 * for display exactly as the engine nets its own rows: fasteners = needed − Σ typed non-plate
 * rows, steel plates = max(needed, typed fasteners) − Σ typed plate rows. Rows the engine already
 * netted (its own group keys) are not counted twice. The money is untouched: the engine bills
 * every typed box whatever its key.
 */
export function familyParapetNeeds(
  result: Pick<AccessoriesResult, "parapetTabs"> | undefined,
  state: Pick<AccessoriesState, "fastenerQty">,
  ref: Pick<AccessoryRefData, "fasteners"> | undefined,
): { fastenersNeeded: number; steelPlatesNeeded: number } {
  const needed = result?.parapetTabs.fastenersNeeded ?? 0;
  const plates = result?.parapetTabs.steelPlatesNeeded ?? 0;
  const subtypeOf = new Map((ref?.fasteners ?? []).map((f) => [f.key, f.subtype] as const));
  let typedFasteners = 0;
  let typedPlates = 0;
  for (const [key, qty] of Object.entries(state.fastenerQty.parapet ?? {})) {
    if (!qty || EDGE_FASTENER_GROUPS.parapet.includes(key)) continue;
    const subtype = subtypeOf.get(key);
    if (subtype === undefined) continue;
    if (subtype === "DL-Plates") typedPlates += qty;
    else typedFasteners += qty;
  }
  return {
    fastenersNeeded: needed - typedFasteners,
    steelPlatesNeeded: Math.max(plates, typedFasteners) - typedPlates,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Review / Accessories Summary rows
 * ---------------------------------------------------------------------------------------------- */

/**
 * Accessories Summary rows for the family results (the DL group's only when computed out here,
 * on a Non-DL TPO / EPDM bid) and every family's Other picks, grouped by `<Family label> ·
 * <screen>` so the card lists them under their family.
 */
export function familyReviewLines(
  results: FamilyResults,
  other: Partial<OtherAccessoryLines> | null | undefined,
): AccessoryReviewLine[] {
  const out: AccessoryReviewLine[] = [];
  for (const family of FAMILIES) {
    const r = results[family];
    if (!r) continue;
    for (const l of r.lines) out.push({ ...l, screen: `${FAMILY_LABEL[family]} · ${l.screen}` });
  }
  const o = normalizeOtherAccessories(other);
  for (const family of FAMILIES) {
    for (const l of o[family]) {
      if (l.quantity <= 0) continue;
      out.push({
        screen: `${FAMILY_LABEL[family]} · Other accessories`,
        qty: l.quantity,
        name: l.description,
        unitCost: l.price,
        totalCost: l.price * l.quantity,
        hours: (l.laborHoursPerUnit ?? 0) * l.quantity,
      });
    }
  }
  return out;
}

/** Material $ and hours of a set of flat lines (the family header figures). */
export function linesTotals(lines: AccessoryLine[]): { material: number; hours: number } {
  return {
    material: lines.reduce((s, l) => s + l.price * l.quantity, 0),
    hours: lines.reduce((s, l) => s + (l.laborHoursPerUnit ?? 0) * l.quantity, 0),
  };
}

/** The message the two family groups show on a frozen snapshot that predates them. */
export const FAMILIES_MISSING_MESSAGE =
  "This bid's frozen pricing predates the Non-DL TPO and EPDM accessories; refresh its pricing to use them";
