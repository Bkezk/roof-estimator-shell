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
}

export const emptyCustomer = (): CustomerInfo => ({
  name: "",
  contact: "",
  projectAddress: "",
  notes: "",
});

/** The persisted estimator state (stored in bids.data jsonb). */
export interface SavedBidState {
  roofSystem: string;
  attachment: "mechanical" | "adhered";
  sections: BidSectionInput[];
  accessories: AccessoryLine[];
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
  /** Per-category labor template name ("" / unset = none). */
  laborTemplateName?: string;
  // Warranty selection (resolved to $/sqft via the warranties + high-wind admin tables).
  warrantyName?: string;
  highWind?: boolean;
  highWindTermYears?: number;
  highWindBand?: string;
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
  warranties: Array<{ name: string; pricePerSqFt: number; nonMasterEliteSurcharge: number }>;
  highWind: Array<{
    termYears: number;
    windBand: string;
    mechPerSqFt: number;
    adheredPerSqFt: number;
  }>;
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
  const isHighWind = s.highWind ?? false;
  let highWindUpcharge = 0;
  if (isHighWind) {
    const hw = data.highWind.find(
      (x) => x.termYears === s.highWindTermYears && x.windBand === s.highWindBand,
    );
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
    sections: s.sections,
    accessories: s.accessories,
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
    ...(s.laborTemplateName ? { laborTemplateName: s.laborTemplateName } : {}),
    extraShipping: 0,
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
