/**
 * Legacy Roof Section "Field Tab Spacing / Field Roll Width" combo — `frmRoofSection.
 * LoadLapSpacings` (Estimator.exe 0x94de0) and `cbLapWidth_SelectedIndexChanged` (0x950f4).
 */
import type { EngineAdminData } from "./adapters";
import {
  resolveSectionSheetLabel,
  resolveSectionSystem,
  TAB_OPTIONS_BY_SYSTEM,
  type BidInput,
  type BidSectionInput,
} from "./bid-builder";
import {
  LEGACY_ROOF_SYSTEM_IDS,
  universalFastenerSpacing,
  type MechFastenerRow,
} from "./fastener-spacing";

/** The legacy cbLapWidth "no lap qualifies for this pull test" entry (FieldLap = 0). */
export const CHECK_PULL = "Check Pull";

/**
 * Legacy `frmRoofSection.LoadLapSpacings` (0x94de0): the Field Tab Spacing / Field Roll Width
 * combo lists the roof system's SheetTabSpacings (sheet layouts) or RollGoodWidths (rolls).
 * Under a MECHANICAL attachment each candidate lap is offered only when
 * `cMechanicalSystem.UniversalFastenerSpacing(thickness, designTable, [lap], pullTest, 0)` finds
 * a field spacing; an empty list becomes the single "Check Pull" entry, whose selection stores
 * FieldLap = 0 (`cbLapWidth_SelectedIndexChanged`). Adhered sections list every lap.
 * The mechanical filter is skipped when the fastener lookup table is not loaded (a data gap,
 * not a rule) so the raw list still shows.
 */
export function legacyLapOptions(
  s: BidSectionInput,
  p: {
    bidDefaults: Pick<BidInput, "roofSystem" | "attachment" | "membraneAdhesiveName">;
    fastenerLookup: MechFastenerRow[] | undefined;
    admin: Pick<EngineAdminData, "rollGoodWidthMulti" | "labor" | "sheetTabSpacings">;
  },
): { raw: number[]; options: number[]; checkPull: boolean; isRollWidth: boolean } {
  const sys = resolveSectionSystem(p.bidDefaults, s);
  const tabs = TAB_OPTIONS_BY_SYSTEM[sys.roofSystem];
  const rolls = Object.keys(p.admin.rollGoodWidthMulti?.[sys.rsId] ?? {})
    .map(Number)
    .filter((w) => w > 0)
    .sort((a, b) => a - b);
  // SheetSize.Layout: the combo lists RollGoodWidths on a roll-goods sheet size ("Field Roll
  // Width") and SheetTabSpacings on a sheet layout ("Field Tab Spacing") — the same test the
  // builder uses to pick the membrane calc (isRollGoodSheet, docs §21).
  const lt = p.admin.labor[sys.comboKey];
  const sheetLabel = resolveSectionSheetLabel(s, Object.keys(lt?.sheetSizeMultiByLabel ?? {}));
  const hasTabTable = p.admin.sheetTabSpacings?.[sys.rsId] !== undefined;
  const isRollGoodSheet =
    sys.rsId === 4
      ? !hasTabTable
      : sys.rsId !== 1 ||
        !hasTabTable ||
        !lt?.rollGoodsSheetLabel ||
        sheetLabel === lt.rollGoodsSheetLabel;
  const isRollWidth = isRollGoodSheet ? rolls.length > 0 || !tabs : !tabs;
  const raw = isRollWidth ? rolls : (tabs ?? []);
  const rsId = LEGACY_ROOF_SYSTEM_IDS[sys.roofSystem];
  const lookup = p.fastenerLookup;
  const options =
    sys.attachment === "mechanical" && rsId && lookup?.length
      ? raw.filter(
          (lap) =>
            universalFastenerSpacing(lookup, {
              roofSystemId: rsId,
              thickness: s.thickness,
              designTable: s.designTable ?? 60,
              tabSpacings: [lap],
              pullTest: s.pullTest ?? 0,
              columnOffset: 0,
            }).ok,
        )
      : raw;
  return { raw, options, checkPull: raw.length > 0 && options.length === 0, isRollWidth };
}
