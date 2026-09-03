/**
 * Duro-Last row-style membrane fastener counts, ported from the decompiled
 * `DuroLastFunctions.DLRowStyleFastenersField` (DataAccess.dll rva 0xa50a4) and
 * `DLRowStyleFastenersPerim` (rva 0xa5360). These are the counts the legacy Fasteners screen
 * shows as "needed" membrane screws (with poly plates 1-per-screw) — see
 * docs/legacy-consumption-rules.md §2.2.
 *
 * PORTED PATHS (exact IL math, banker's rounding, In2Ft = banker's-rounded inches/12):
 *  - Field, roll goods (SheetSize.Layout ≠ 1): quick-bid row math and the non-quick-bid outline.
 *  - Perimeter, standard sheet (SheetSize.ID ≠ 1, UseCustomSettings = false): single row per
 *    tab-side (< 120" lap) or the 120"-lap double-row + 90"-corner-offset rule.
 *
 * NOT PORTED (transcribed for the record; each needs bid-model inputs the web app doesn't carry):
 *  - Field, custom-layout sheets (Layout == 1): with N = NumSheetsReq and side = √(area/N):
 *    total = (side/In2Ft(fieldLap))·side/In2Ft(sp)·N + ⌊2N − 2√N⌋·side/In2Ft(sp)
 *          + (length+width)/In2Ft(sp).
 *  - Perimeter, custom-settings path: per-side enhancement strips
 *    (⌈enhWidth/In2Ft(perimLap−overlap)⌉·In2Ft(perimLap−overlap) on perim sides), corner
 *    attribution via IsPerimCorner/PrevSide/NextSide, rows × strip LF at the custom perim/corner
 *    spacings.
 *  - Perimeter for SheetSize.ID == 1 (its own row/strip variant).
 */

import { bankersRound, in2Ft } from "./rounding";

/** Round like VB's Math.Round (banker's, 0 dp) — what both legacy functions return through. */
const vbRound = (x: number): number => bankersRound(x, 0);

export interface RowStyleFieldInputs {
  lengthFt: number;
  widthFt: number;
  /** Effective field tab lap, inches (legacy CustomFieldLap ≠ -1 ? custom : FieldLap). */
  fieldLapIn: number;
  /** Effective field o.c. spacing, inches (custom ≠ -1 ? custom : the pull-test lookup result). */
  fieldSpacingIn: number;
  /** Membrane overlap width, inches (legacy RoofSystem.OverlapWidth — 6 for the DL families). */
  overlapWidthIn: number;
  /**
   * Legacy CustomPerimeterLap(0), inches; -1 on a default section. Feeds the perimeter-strip
   * carve-out verbatim (with enhancement width 0 — the quick-bid default — the term vanishes).
   */
  perimLapIn: number;
  perimEnhancementWidthFt: number;
  /** Sides A–D (legacy 0–3) marked as perimeter. */
  sideIsPerim: [boolean, boolean, boolean, boolean];
  useCustomSettings: boolean;
  quickBid: boolean;
}

/**
 * Field membrane fasteners, roll-goods path (IL rva 0xa50a4, branch SheetSize.Layout ≠ 1).
 * Verbatim per the IL:
 *   stripFt = Round(Ceil(enhWidth / In2Ft(perimLap − overlap))) × In2Ft(perimLap − overlap)
 *   strip[i] = stripFt × isPerim(i); THEN, when !useCustomSettings, sides 0 and 2 are OVERWRITTEN
 *   with the literal 30 × isPerim — FLAGGED FOR BID VALIDATION: 30 is a bare constant in the IL
 *   (reads as a 30-ft strip on the two tab-run sides; units unverified against a real bid).
 *   fieldL = length − strip[1] − strip[3]; fieldW = width − strip[0] − strip[2]
 *   quickBid:  rowLF = Ceil(fieldW / In2Ft(fieldLap − overlap)) × fieldL
 *   otherwise: rowLF = 2 × (fieldL + fieldW)   (drawn-layout sections count rows elsewhere)
 *   fasteners = Round(rowLF / In2Ft(spacing))
 */
export function dlRowStyleFastenersField(i: RowStyleFieldInputs): number {
  const stripBase =
    Math.round(Math.ceil(i.perimEnhancementWidthFt / in2Ft(i.perimLapIn - i.overlapWidthIn))) *
    in2Ft(i.perimLapIn - i.overlapWidthIn);
  const strip = i.sideIsPerim.map((p) => (p ? stripBase : 0)) as [number, number, number, number];
  if (!i.useCustomSettings) {
    strip[0] = i.sideIsPerim[0] ? 30 : 0;
    strip[2] = i.sideIsPerim[2] ? 30 : 0;
  }
  const fieldL = i.lengthFt - strip[1] - strip[3];
  const fieldW = i.widthFt - strip[2] - strip[0];
  const rowLF = i.quickBid
    ? Math.ceil(fieldW / in2Ft(i.fieldLapIn - i.overlapWidthIn)) * fieldL
    : 2 * (fieldL + fieldW);
  return vbRound(rowLF / in2Ft(i.fieldSpacingIn));
}

export interface RowStylePerimInputs {
  /** Raw FieldLap, inches — both the < 120 branch test and the spacing lookup key use it. */
  fieldLapIn: number;
  /**
   * Spacing, inches: the legacy standard path runs UniversalFastenerSpacing with the FIELD lap
   * and the FIELD column (offset 0) — not PerimSpacing — then divides by it. Pass that value.
   */
  spacingIn: number;
  /** Per-side perimeter-enhancement lengths, ft (legacy PerimSideLength 0–3). */
  perimSideLengthsFt: [number, number, number, number];
  sideIsPerim: [boolean, boolean, boolean, boolean];
}

/**
 * Perimeter membrane fasteners, standard path (IL rva 0xa5360; SheetSize.ID ≠ 1,
 * UseCustomSettings = false). Verbatim per the IL:
 *   fieldLap < 120: one fastener row along each perim TAB side (sides 0 and 2 only):
 *     total = Σ_{i∈{0,2}, perim} sideLen(i) / In2Ft(sp)
 *   fieldLap ≥ 120: doubled rows on sides 0/2, plus doubled rows on sides 1/3 shortened by a
 *     90-inch (7.5 ft) corner offset for each adjacent perim tab side:
 *     total = Σ_{i∈{0,2}, perim} 2·sideLen(i)/In2Ft(sp)
 *           + Σ_{i∈{1,3}, perim} 2·(sideLen(i) − isPerim(0)·In2Ft(90) − isPerim(2)·In2Ft(90))/In2Ft(sp)
 *   fasteners = Round(total)
 */
export function dlRowStyleFastenersPerim(i: RowStylePerimInputs): number {
  const sp = in2Ft(i.spacingIn);
  let total = 0;
  if (i.fieldLapIn < 120) {
    if (i.sideIsPerim[0]) total += i.perimSideLengthsFt[0] / sp;
    if (i.sideIsPerim[2]) total += i.perimSideLengthsFt[2] / sp;
  } else {
    if (i.sideIsPerim[0]) total += (2 * i.perimSideLengthsFt[0]) / sp;
    if (i.sideIsPerim[2]) total += (2 * i.perimSideLengthsFt[2]) / sp;
    const cornerCut = (i.sideIsPerim[0] ? in2Ft(90) : 0) + (i.sideIsPerim[2] ? in2Ft(90) : 0);
    if (i.sideIsPerim[1]) total += (2 * (i.perimSideLengthsFt[1] - cornerCut)) / sp;
    if (i.sideIsPerim[3]) total += (2 * (i.perimSideLengthsFt[3] - cornerCut)) / sp;
  }
  return vbRound(total);
}
