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
  DECK_BUCKETS,
  EDGE_FASTENER_GROUPS,
  normalizeAccessoriesState,
  parapetEdgeFastenersCount,
  PLATE_ROWS,
  TERM_COLORS,
  type AccessoriesResult,
  type AccessoriesState,
  type AccessoryRefData,
  type AccessoryReviewLine,
  type ComputeAccessoriesArgs,
  type DeckBucket,
  type DeckBucketNeeds,
  type TermColor,
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
      epdm: withEpdmBlackPrices(buildAccessoryRefData(epdm, args.laborRows)),
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

export type FamilyResults = Partial<Record<AccessoryFamily, FamilyResult>>;

/**
 * Run the engine for the Non-DL TPO and EPDM groups — the active one with the roof, the other
 * typed-only — and, on a Non-DL TPO / EPDM bid, for the DL group too (typed-only, with the
 * Duro-Last ref), since the engine's own pass is switched off there (adminForBid). The active
 * Non-DL TPO / EPDM family's result carries its term bar caulk count (withFamilyCaulk). Absent
 * when the snapshot has no families.
 */
export function computeFamilyResults(
  saved: FamilyBidState & FamilyGeometry,
  admin: AdminSnapshot | null | undefined,
): FamilyResults {
  const out: FamilyResults = {};
  if (!admin?.accessoryFamilies) return out;
  const active = activeFamily(saved.roofSystem);
  const families: readonly AccessoryFamily[] = active === "duroLast" ? EXTRA_FAMILIES : FAMILIES;
  for (const family of families) {
    const args = familyComputeArgs(
      family,
      normalizeAccessoriesState(saved[FAMILY_STATE_KEY[family]]),
      admin,
      saved,
    );
    if (!args) continue;
    const result = computeAccessories(args);
    out[family] =
      active === family && isNonDlFamily(family)
        ? withFamilyCaulk(result, family, args.ref)
        : result;
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
  result: FamilyResult,
  family: AccessoryFamily,
): AccessoryLine[] {
  const label = FAMILY_LABEL[family];
  // The term bar caulk counted outside the engine (familyCaulkLine) joins after the engine's
  // own lines, whichever shape they take: it is not part of the engine's totalCost.
  const caulk = familyCaulkLine(result, family);
  const tail = caulk ? [caulk] : [];
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
  if (near(cost, result.totalCost, 0.005) && near(hours, result.manHours, 1e-6))
    return [...lines, ...tail];
  if (result.totalCost === 0 && result.manHours === 0) return tail;
  return [
    {
      description: `${label} accessories`,
      price: result.totalCost,
      quantity: 1,
      laborHoursPerUnit: result.manHours,
    },
    ...tail,
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
    const caulk = familyCaulkReviewLine(r, family);
    if (caulk) out.push(caulk);
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

/* ------------------------------------------------------------------------------------------------
 * The family groups' colours (owner, Oct 27: EPDM accessories are black or white, black first and
 * by default — lib/membrane-colors.ts EPDM_COLORS; Firestone TPO has no Dark Gray / Terra Cotta)
 * ---------------------------------------------------------------------------------------------- */

/** The Duro-Last colour columns the DL group's pipe stack and corners pickers offer. */
export const DL_ACCESSORY_COLORS: readonly string[] = [
  "White",
  "Tan",
  "Gray",
  "Dark Gray",
  "Terra Cotta",
];

/** The pipe stack / corners colours per family, in picker order (the default first). */
export const FAMILY_ACCESSORY_COLORS: Record<AccessoryFamily, readonly string[]> = {
  duroLast: DL_ACCESSORY_COLORS,
  nonDlTpo: ["White", "Tan", "Gray"],
  epdm: ["Black", "White"],
};

/** The pipe stack and corners colours a group offers; no family = the DL group. */
export function familyAccessoryColors(family: AccessoryFamily | undefined): string[] {
  return [...FAMILY_ACCESSORY_COLORS[family ?? "duroLast"]];
}

/**
 * The EPDM ref with a `Black` price equal to the `White` price on every corner row and pipe stack
 * size. The frozen engine prices corners strictly by colour name (`priceByColor[color] ?? 0`) and
 * pipe stacks with a White fallback, while the Firestone EPDM parts are black and priced under
 * White (the seed's note); an EPDM pick of "Black" prices like White. Rows without a White price
 * stay without a Black one (the corners grid shows "—" for both).
 */
export function withEpdmBlackPrices(ref: AccessoryRefData): AccessoryRefData {
  const black = (p: Record<string, number>): Record<string, number> =>
    p["White"] === undefined ? p : { ...p, Black: p["White"] };
  return {
    ...ref,
    corners: ref.corners.map((r) => ({ ...r, priceByColor: black(r.priceByColor) })),
    pipeStackSizes: ref.pipeStackSizes.map((s) => ({
      ...s,
      priceByColor: black(s.priceByColor),
    })),
  };
}

/**
 * One term bar colour row as a group shows it: `label` on the screen, `key` the engine's
 * TermColor the footage is stored under (AccessoriesState.termBar.additional* / result.*ByColor).
 */
export interface TermBarColorOption {
  label: string;
  key: TermColor;
}

/**
 * The term bar screen's colour rows per family. The engine knows White / Tan / Gray bars only and
 * folds any other colour to Gray (`foldColor`: an EPDM section coloured "Black" counts its roof
 * footage under Gray); the family term bar rows are priced the same for every colour. So the EPDM
 * group shows **Black ↔ engine key `Gray`** and White ↔ `White` — a display mapping only, the
 * state keeps the engine's keys — and its term bar caulk therefore counts on the Gray index
 * (sealant part "1134"; familyCaulkTubes sums every index). The Non-DL TPO group shows White /
 * Tan / Gray under their own keys; the DL group is unchanged.
 */
export function familyTermBarColors(family: AccessoryFamily | undefined): TermBarColorOption[] {
  if (family === "epdm")
    return [
      { label: "Black", key: "Gray" },
      { label: "White", key: "White" },
    ];
  return TERM_COLORS.map((c) => ({ label: c, key: c }));
}

/* ------------------------------------------------------------------------------------------------
 * Term bar caulk for the families (owner approved: Non-DL TPO → "UltraPly TPO General Purpose
 * Sealant - White", EPDM → "Lap Sealant-HS Tubes")
 * ---------------------------------------------------------------------------------------------- */

/**
 * The family's caulk row, matched by description prefix on its `sealants` rows. The frozen engine
 * counts caulk tubes from the term bar footage (plus pipe stacks, drains, washers and capstones)
 * but writes them against the Duro-Caulk part keys only, so a Firestone row gets no count of its
 * own; the count is folded onto this row outside the engine (withFamilyCaulk).
 */
export const FAMILY_TERM_BAR_CAULK: Record<ExtraFamily, RegExp> = {
  nonDlTpo: /^UltraPly TPO General Purpose Sealant/,
  epdm: /^Lap Sealant-HS Tubes/,
};

/**
 * The engine's Duro-Caulk part keys, one per colour index: "1136" White, "1138" Tan, "1134" Gray
 * (+ Dark Gray + Rock Ply), "1135" Terra Cotta. A family caulk product has one colour, so every
 * index counts toward it.
 */
export const CAULK_TUBE_PARTS: readonly string[] = ["1136", "1138", "1134", "1135"];

/** The caulk tubes the engine counted on a result, every colour summed. */
export function familyCaulkTubes(result: Pick<AccessoriesResult, "sealants">): number {
  return CAULK_TUBE_PARTS.reduce((s, part) => s + (result.sealants.calcByPart[part] ?? 0), 0);
}

/** The family's caulk row on its ref (the first `sealants` row matching the family's prefix). */
export function familyCaulkRow(
  family: AccessoryFamily,
  ref: Pick<AccessoryRefData, "sealants"> | undefined,
): { description: string; part: string; price: number } | null {
  if (!isNonDlFamily(family)) return null;
  const re = FAMILY_TERM_BAR_CAULK[family];
  return ref?.sealants.find((s) => re.test(s.description)) ?? null;
}

/** The counted caulk on a family's result: the row and the tubes the engine counted. */
export interface FamilyCaulk {
  description: string;
  part: string;
  /** The row's price as the catalog carries it (per tube). */
  price: number;
  tubes: number;
}

/** An engine result plus the family's counted term bar caulk (the active family's only). */
export type FamilyResult = AccessoriesResult & { caulk?: FamilyCaulk | undefined };

/**
 * `result` with the family's caulk row counted: the engine's tubes (every colour) land on the
 * row's part in `sealants.calcByPart`, so the group's Sealants screen shows the count in the
 * row's Calc Qty column like Duro-Caulk on the DL screen, and `caulk` carries the row for the
 * bid's lines. Typed extras on the row still bill through the engine as today; the count bills
 * through familyCaulkLine. Unchanged when the ref has no matching row.
 */
export function withFamilyCaulk(
  result: AccessoriesResult,
  family: AccessoryFamily,
  ref: Pick<AccessoryRefData, "sealants"> | undefined,
): FamilyResult {
  const row = familyCaulkRow(family, ref);
  if (!row) return result;
  const tubes = familyCaulkTubes(result);
  return {
    ...result,
    sealants: {
      ...result.sealants,
      calcByPart: { ...result.sealants.calcByPart, [row.part]: tubes },
    },
    caulk: { description: row.description, part: row.part, price: row.price, tubes },
  };
}

/** The caulk line's description: `<Family label> · Sealants — <row description> (counted)`. */
export const familyCaulkDescription = (family: AccessoryFamily, rowDescription: string): string =>
  `${FAMILY_LABEL[family]} · Sealants — ${rowDescription} (counted)`;

/**
 * The bid line for a family's counted caulk: the row's price × the tubes, no labor (sealants carry
 * none in the engine). Null when the result carries no caulk or counted nothing.
 */
export function familyCaulkLine(
  result: FamilyResult,
  family: AccessoryFamily,
): AccessoryLine | null {
  const c = result.caulk;
  if (!c || c.tubes <= 0) return null;
  return {
    description: familyCaulkDescription(family, c.description),
    price: c.price,
    quantity: c.tubes,
    laborHoursPerUnit: 0,
  };
}

/** The Accessories Summary row for a family's counted caulk (familyCaulkLine's figures). */
export function familyCaulkReviewLine(
  result: FamilyResult,
  family: AccessoryFamily,
): AccessoryReviewLine | null {
  const c = result.caulk;
  if (!c || c.tubes <= 0) return null;
  return {
    screen: `${FAMILY_LABEL[family]} · Sealants`,
    qty: c.tubes,
    name: `${c.description} (counted)`,
    unitCost: c.price,
    totalCost: c.price * c.tubes,
    hours: 0,
  };
}

/* ------------------------------------------------------------------------------------------------
 * The family groups' deck screens: seam / insulation / induction plates (owner approved the
 * classification). The engine nets Items Required against three exact Duro-Last rows only
 * (PLATE_ROWS.poly / insulation / induction), so a typed Firestone or Duro-Tech plate never
 * reduced a family's need.
 * ---------------------------------------------------------------------------------------------- */

export type FamilyPlateKind = "seam" | "insulation" | "induction";

/**
 * Which Items Required bucket a plate row covers, by description keyword (case-insensitive):
 * induction — InvisiWeld, Induction Plate; insulation — 3" Insulation Fastening Plate (Round),
 * Polymer Fastener Insulation Plate; seam — HD Seam Plate, HD Plus Seam Plate, 2" Metal Plates,
 * Polymer Fastener Seam Plate, V-Plate. Null for anything else.
 */
export function familyPlateKind(description: string): FamilyPlateKind | null {
  const d = description.toLowerCase();
  if (/invisiweld|induction/.test(d)) return "induction";
  if (/insulation/.test(d)) return "insulation";
  if (/seam plate|metal plate|v-plate/.test(d)) return "seam";
  return null;
}

const DECK_NEED_FIELD: Record<FamilyPlateKind, keyof DeckBucketNeeds> = {
  seam: "polyPlates",
  insulation: "insulPlates",
  induction: "inductionPlates",
};

/**
 * The deck screens' Items Required per bucket for a family group: the engine's figures with the
 * family's typed plate rows (subtype DL-Plates, classified by familyPlateKind) netted off their
 * bucket — seam plates off `polyPlates` (shown as "Seam Plates"), insulation off `insulPlates`,
 * induction off `inductionPlates` — the way the engine nets its own three rows. Rows the engine
 * already netted (PLATE_ROWS) are not counted twice; the Gypsum bucket keeps the engine's forced
 * zero Poly / Insul. plates. The money is untouched: typed boxes bill as typed. Zeros without a
 * result.
 */
export function familyDeckNeeds(
  result: Pick<AccessoriesResult, "deckNeeds"> | undefined,
  state: Pick<AccessoriesState, "fastenerQty">,
  ref: Pick<AccessoryRefData, "fasteners"> | undefined,
): Record<DeckBucket, DeckBucketNeeds> {
  const rowByKey = new Map((ref?.fasteners ?? []).map((f) => [f.key, f] as const));
  const engineKeys: readonly string[] = Object.values(PLATE_ROWS);
  const out = {} as Record<DeckBucket, DeckBucketNeeds>;
  for (const bucket of DECK_BUCKETS) {
    const need: DeckBucketNeeds = {
      ...(result?.deckNeeds[bucket] ?? {
        fasteners: 0,
        polyPlates: 0,
        insulPlates: 0,
        inductionPlates: 0,
      }),
    };
    for (const [key, qty] of Object.entries(state.fastenerQty[bucket] ?? {})) {
      if (!qty || engineKeys.includes(key)) continue;
      const row = rowByKey.get(key);
      if (!row || row.subtype !== "DL-Plates") continue;
      const kind = familyPlateKind(row.description);
      if (!kind) continue;
      const field = DECK_NEED_FIELD[kind];
      if (bucket === "gypsum" && field !== "inductionPlates") continue;
      need[field] -= qty;
    }
    out[bucket] = need;
  }
  return out;
}
