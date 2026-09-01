/**
 * Shared bid persistence + reconstruction (Phase 7). The estimator saves a `SavedBidState` into the
 * bid's jsonb; both the estimator and the proposal page turn that same object into the engine's
 * `BidInput` via `savedToBidInput`, so the proposal price is computed the exact same way as the
 * live estimate (the two are pinned to one code path — they cannot drift).
 */

import type { BidInput, BidSectionInput, AccessoryLine, NonDlLine } from "@/lib/engine/bid-builder";
import type { MarkupMode } from "@/lib/engine/money";

/** Customer / project header, persisted with the bid and printed on the proposal. */
export interface CustomerInfo {
  name: string;
  contact: string; // phone / email
  projectAddress: string;
  notes: string; // optional scope notes for the proposal
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
