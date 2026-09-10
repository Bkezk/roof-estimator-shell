/**
 * Shared bid persistence + reconstruction (Phase 7). The estimator saves a `SavedBidState` into the
 * bid's jsonb; both the estimator and the proposal page turn that same object into the engine's
 * `BidInput` via `savedToBidInput`, so the proposal price is computed the exact same way as the
 * live estimate (the two are pinned to one code path — they cannot drift).
 */

import type {
  BidInput,
  BidSectionInput,
  AccessoryLine,
  NonDlLine,
  ParapetInput,
  CurbInput,
  MetalLine,
} from "@/lib/engine/bid-builder";
import type { MarkupMode } from "@/lib/engine/money";
import type { AccessoriesState } from "@/lib/engine/accessories";
import type { MetalsState } from "@/lib/engine/metals";
import type { NonDlState } from "@/lib/engine/nondl";
import type { EngineAdminData } from "@/lib/engine/adapters";
import { normalizeAdminSnapshot } from "@/lib/engine/adapters";

/** Customer / project header, persisted with the bid and printed on the proposal. */
export interface CustomerInfo {
  name: string;
  contact: string; // contact person
  projectAddress: string; // job-site street address
  notes: string; // optional scope notes for the proposal
  // Client & job-site details (legacy Client / Job Site tabs, modernized; optional so older
  // saved bids stay valid).
  phone?: string;
  email?: string;
  clientAddress?: string; // client billing address (street, city/st/zip)
  jobCityStZip?: string; // job-site city / state / zip (projectAddress carries the street)
  jobNumber?: string;
  shipVia?: string;
  estimatorName?: string; // legacy Home > General Info "Estimator's Name"
  // Legacy frmHome Client tab (ClientAddress1/2, ClientCity/State/Zip, ClientExtension,
  // ClientFax) and Job Site tab (Address2, City/State/Zip, ShipTo). `clientAddress` doubles as
  // Address 1 and `projectAddress` as the job-site Address 1; `jobCityStZip` stays the combined
  // job-site line the proposal prints (kept in sync from the parts).
  clientAddress2?: string;
  clientCity?: string;
  clientState?: string;
  clientZip?: string;
  phoneExt?: string;
  fax?: string;
  projectAddress2?: string;
  jobCity?: string;
  jobState?: string;
  jobZip?: string;
  shipTo?: string;
}

/** Legacy Home "Building Type" list (Estimate.BuildingType). */
export const BUILDING_TYPES = ["Commercial", "Residential"] as const;

/**
 * Legacy Home "Max Expected Wind" combo (frmHome.LoadEstimate): label → Estimate.MaxWindExpected
 * → the high_wind_upcharges wind_band key.
 */
export const MAX_WIND_OPTIONS: ReadonlyArray<{ label: string; value: number; band: string }> = [
  { label: "55-72 mph", value: 72, band: "55-72" },
  { label: "73-80 mph", value: 80, band: "73-80" },
  { label: "81-90 mph", value: 90, band: "81-90" },
  { label: "91-100 mph", value: 100, band: "91-100" },
  { label: "101-110 mph", value: 110, band: "101-110" },
  { label: "111-120 mph", value: 120, band: "111-120" },
];

/** Combined "City, ST Zip" line from the parts (blank parts skipped). */
export function cityStZip(city?: string, state?: string, zip?: string): string {
  const c = (city ?? "").trim();
  const st = (state ?? "").trim();
  const z = (zip ?? "").trim();
  const left = [c, st].filter(Boolean).join(", ");
  return [left, z].filter(Boolean).join(" ");
}

export const emptyCustomer = (): CustomerInfo => ({
  name: "",
  contact: "",
  projectAddress: "",
  notes: "",
});

/** The persisted estimator state (stored in bids.data jsonb). */
export interface SavedBidState {
  /** Legacy Review "Shipping (Other)" editable cell — extra shipping $ on top of freight. */
  extraShipping?: number;
  roofSystem: string;
  attachment: "mechanical" | "adhered";
  sections: BidSectionInput[];
  accessories: AccessoryLine[];
  /** §12 Accessories calculated-screen state (optional so older saved bids stay valid). */
  accessoriesCalc?: Partial<AccessoriesState>;
  /** §13 EXCEPTIONAL Metals screen state (optional so older saved bids stay valid). */
  metalsCalc?: Partial<MetalsState>;
  /** §14 Non-Duro-Last Items screen state (optional so older saved bids stay valid). */
  nonDlCalc?: Partial<NonDlState>;
  nonDlLines: NonDlLine[];
  /** Exceptional Metals lines (optional so older saved bids stay valid). */
  metals?: MetalLine[];
  /** Parapet walls (optional so older saved bids stay valid). */
  parapets?: ParapetInput[];
  /** Curbs (optional so older saved bids stay valid). */
  curbs?: CurbInput[];
  customer: CustomerInfo;
  markupMode: MarkupMode;
  markup: number;
  laborRate: number;
  commission: number;
  taxExempt: boolean;
  // Money controls (optional so older saved bids stay valid; default off).
  prepayDiscount?: boolean;
  stdSizeDiscount?: boolean;
  volumeDiscount?: boolean;
  perDiem?: number;
  perDiemInMarkup?: boolean;
  commissionInMarkup?: boolean;
  adjustLaborPct?: number;
  /** Per-bid setup / inspection time adjustments % (legacy per-item overrides). */
  adjustSetupPct?: number;
  adjustInspectionPct?: number;
  /** Per-category labor template name ("" / unset = none). */
  laborTemplateName?: string;
  // Warranty selection (resolved to $/sqft via the warranties + high-wind admin tables).
  /** Legacy Home > Defaults panel: material defaults applied to new roof sections. */
  sectionDefaults?: {
    deckType: string;
    thickness: number;
    color: string;
    sheetSizeLabel: string;
    /** Legacy Home "Design Table (psf)" default (Estimate.defaultRoofSection.DesignTable). */
    designTable?: number;
  };
  /** Legacy Home "5. Parapets Material" + "2. Wall Type" defaults for NEW parapets. */
  parapetDefaults?: {
    thicknessMil?: number;
    color?: string;
    /** 1 = Wood or Metal, 4 = Brick or Concrete (Parapet.WallType). */
    wallType?: number;
  };
  /** Legacy Home "4. Underlayment Attached With" default (new layers only). */
  underlaymentAttachmentDefault?: "mechanical" | "adhesive" | "none";
  /** Legacy Home General Info: Building Type (Commercial / Residential), start date (ISO date). */
  buildingType?: string;
  startDate?: string;
  /**
   * Legacy per-estimate sales tax (Estimate.SalesTax as a FRACTION, Estimate.TaxMaterialOnly):
   * seeded from Settings on a new bid, editable on Home, zeroed / disabled while Tax Exempt.
   * Absent = the company settings (older saved bids).
   */
  salesTaxRate?: number;
  taxMaterialOnly?: boolean;
  /** Legacy Estimate.MaxWindExpected (72…120; the high-wind band = MAX_WIND_OPTIONS). */
  maxWindExpected?: number;
  /** Membrane adhesive for fully-adhered bids (defaults to Water Based Adhesive). */
  membraneAdhesiveName?: string;
  warrantyName?: string;
  highWind?: boolean;
  highWindTermYears?: number;
  highWindBand?: string;
  // Frozen pricing (legacy "Update Pricing & Labor" semantics): captured at first save; admin
  // changes never reprice this bid until the estimator explicitly updates the snapshot.
  adminSnapshot?: EngineAdminData;
  warrantySnapshot?: WarrantyData;
  /** ISO timestamp of when the snapshot was captured. */
  pricingAsOf?: string;
}

/**
 * Map a markup-preset's stored markup_type enum to the engine's MarkupMode (engine-truth §4.3:
 * 0 = % of cost, 1 = flat $/man-day, 2 = gross-profit %). Returns null for an unrecognized value so
 * the caller can leave the current mode unchanged rather than guess.
 */
export function markupTypeToMode(t: string): MarkupMode | null {
  switch (t) {
    case "percent_cost":
      return 0;
    case "dollar_manday":
      return 1;
    case "gross_profit":
      return 2;
    default:
      return null;
  }
}

/** Warranty admin data the resolver needs (from the warranties + high_wind_upcharges tables). */
export interface WarrantyData {
  warranties: Array<{
    name: string;
    pricePerSqFt: number;
    nonMasterEliteSurcharge: number;
    /** Legacy Warranty.ReqThickness / IsHighWind / WarrantyTerm (absent on older snapshots). */
    reqThickness?: number;
    isHighWind?: boolean;
    termYears?: number;
  }>;
  highWind: Array<{
    termYears: number;
    windBand: string;
    mechPerSqFt: number;
    adheredPerSqFt: number;
  }>;
}

/**
 * Legacy high-wind semantics (frmHome.cbWarranty_SelectedIndexChanged): the warranty itself
 * carries IsHighWind and its term (WarrantyHighWind keys on WarrantyLength × MaxWindExpected);
 * the estimator only picks "Max Expected Wind". Warranty rows without the flags (older
 * snapshots) fall back to the bid's saved highWind / term; the band comes from maxWindExpected
 * when set, else the saved highWindBand.
 */
export function effectiveHighWind(
  s: Pick<
    SavedBidState,
    "warrantyName" | "highWind" | "highWindTermYears" | "highWindBand" | "maxWindExpected"
  >,
  data: Pick<WarrantyData, "warranties">,
): { isHighWind: boolean; termYears: number; band: string; fromWarranty: boolean } {
  const w = data.warranties.find((x) => x.name === s.warrantyName);
  const fromWarranty = w?.isHighWind !== undefined;
  const isHighWind = fromWarranty ? (w!.isHighWind as boolean) : (s.highWind ?? false);
  const termYears = w?.termYears ?? s.highWindTermYears ?? 0;
  const band =
    s.maxWindExpected !== undefined
      ? (MAX_WIND_OPTIONS.find((o) => o.value === s.maxWindExpected)?.band ?? "")
      : (s.highWindBand ?? "");
  return { isHighWind, termYears, band, fromWarranty };
}

/** Resolve the selected warranty (+ high-wind) into the engine's numeric warranty inputs. */
export function resolveWarrantyInput(
  s: SavedBidState,
  data: WarrantyData,
): Pick<
  BidInput,
  | "warrantyCostPerSqFt"
  | "warrantyNonEliteMasterCharge"
  | "warrantyIsHighWind"
  | "warrantyHighWindUpcharge"
> {
  const w = data.warranties.find((x) => x.name === s.warrantyName);
  const eff = effectiveHighWind(s, data);
  const isHighWind = eff.isHighWind;
  let highWindUpcharge = 0;
  if (isHighWind) {
    const hw = data.highWind.find((x) => x.termYears === eff.termYears && x.windBand === eff.band);
    highWindUpcharge = hw ? (s.attachment === "adhered" ? hw.adheredPerSqFt : hw.mechPerSqFt) : 0;
  }
  return {
    warrantyCostPerSqFt: w?.pricePerSqFt ?? 0,
    warrantyNonEliteMasterCharge: w?.nonMasterEliteSurcharge ?? 0,
    warrantyIsHighWind: isHighWind,
    warrantyHighWindUpcharge: highWindUpcharge,
  };
}

/**
 * Build the engine BidInput from saved state, resolving the warranty selection against the warranty
 * admin data when it's available. Estimator and proposal both call this, so their warranty pricing
 * stays pinned. Without warranty data (or a selection), warranty stays 0.
 */
export function buildBidInput(s: SavedBidState, warrantyData?: WarrantyData | null): BidInput {
  const base = savedToBidInput(s);
  return warrantyData ? { ...base, ...resolveWarrantyInput(s, warrantyData) } : base;
}

export interface BidComputeData {
  admin: EngineAdminData | null;
  warranty: WarrantyData | null;
  /** ISO timestamp the bid's pricing was frozen at; null = computing from live admin data. */
  frozenAsOf: string | null;
}

/**
 * Resolve which admin/warranty data a bid computes against — the legacy "Update Pricing & Labor"
 * semantics: a saved bid carries a frozen snapshot and keeps that pricing until it is explicitly
 * updated; without a snapshot (a new bid, or one saved before snapshots existed) it computes from
 * live data. Estimator and proposal both resolve through here, so the two stay pinned.
 */
export function resolveBidComputeData(
  s: Pick<SavedBidState, "adminSnapshot" | "warrantySnapshot" | "pricingAsOf">,
  liveAdmin: EngineAdminData | null | undefined,
  liveWarranty: WarrantyData | null | undefined,
): BidComputeData {
  if (s.adminSnapshot) {
    return {
      // Older snapshots predate later-added fields; normalize so newer builds never crash.
      admin: normalizeAdminSnapshot(s.adminSnapshot),
      // Snapshots from before warranty freezing fall back to live rather than dropping warranty $.
      warranty: s.warrantySnapshot ?? liveWarranty ?? null,
      frozenAsOf: s.pricingAsOf ?? "",
    };
  }
  return { admin: liveAdmin ?? null, warranty: liveWarranty ?? null, frozenAsOf: null };
}

/**
 * Turn the saved estimator state into the engine's BidInput. The remaining fixed values are the
 * seam inputs the estimator folds in elsewhere (extra shipping, subs/services and other material
 * come from the non-DL lines) and the warranty inputs (wired separately). Keeping this in ONE place
 * is what pins the estimator and the proposal to the same computation.
 */
export function savedToBidInput(s: SavedBidState): BidInput {
  return {
    roofSystem: s.roofSystem,
    attachment: s.attachment,
    ...(s.membraneAdhesiveName ? { membraneAdhesiveName: s.membraneAdhesiveName } : {}),
    sections: s.sections,
    accessories: s.accessories,
    ...(s.accessoriesCalc ? { accessoriesCalc: s.accessoriesCalc } : {}),
    ...(s.metalsCalc ? { metalsCalc: s.metalsCalc } : {}),
    ...(s.nonDlCalc ? { nonDlCalc: s.nonDlCalc } : {}),
    nonDlLines: s.nonDlLines,
    metals: s.metals ?? [],
    parapets: s.parapets ?? [],
    curbs: s.curbs ?? [],
    markupMode: s.markupMode,
    markup: s.markup,
    crewLaborRatePerHour: s.laborRate,
    commission: s.commission,
    commissionInMarkup: s.commissionInMarkup ?? false,
    perDiem: s.perDiem ?? 0,
    perDiemInMarkup: s.perDiemInMarkup ?? true,
    prepayDiscount: s.prepayDiscount ?? false,
    stdSizeDiscount: s.stdSizeDiscount ?? false,
    volumeDiscount: s.volumeDiscount ?? false,
    taxExempt: s.taxExempt,
    adjustLaborPct: s.adjustLaborPct ?? 0,
    adjustSetupPct: s.adjustSetupPct ?? 0,
    adjustInspectionPct: s.adjustInspectionPct ?? 0,
    ...(s.laborTemplateName ? { laborTemplateName: s.laborTemplateName } : {}),
    ...(s.salesTaxRate !== undefined ? { salesTaxRate: s.salesTaxRate } : {}),
    ...(s.taxMaterialOnly !== undefined ? { taxMaterialOnly: s.taxMaterialOnly } : {}),
    extraShipping: s.extraShipping ?? 0,
    subsCost: 0,
    servicesCost: 0,
    materialUnderlayment: 0,
    otherMaterial: 0,
    warrantyCostPerSqFt: 0,
    warrantyNonEliteMasterCharge: 0,
    warrantyIsHighWind: false,
    warrantyHighWindUpcharge: 0,
  };
}
