/**
 * Sheet size and lap guard (owner, Oct 26: "go ahead and build the sheet size snap if that gives
 * it more parity to the legacy systems"). A section's average sheet size and its field lap are
 * lists the labor combo (roof system + attachment) decides: Duro-Last mechanical knows seven
 * sheets (Roll Good … 3000 sf) and three tab pitches (28 / 60 / 120"); Duro-Last adhered knows
 * Roll Good / 500 sf / 1000 sf and one roll width (64"). Legacy reloads those lists whenever the
 * attachment changes and reselects (frmHome.LoadAttachmentSystem → frmRoofSection.LoadLapSpacings);
 * the web kept whatever the section carried, so a 2000 sf / 60" mechanical set-up rode into an
 * adhered bid and the engine warned on every section and billed the install labor at ×1 (the
 * General Dynamics bid, Oct 22).
 *
 * Pure, like lib/bid-mils.ts: `snapBidSheets` checks every roof section's sheet against its own
 * system + attachment (the engine's resolveSectionSystem) and the Setup default against the
 * bid's, moving a sheet the combo does not offer to the nearest offered one (by square feet, a
 * tie to the larger; rolls stay rolls when the combo has them), then checks each section's lap
 * against the list the sheet implies (engine/lap-options.ts legacyLapOptions: roll widths on a
 * roll-goods sheet, tab pitches on a sheet layout) and takes the first offered lap when the
 * section's is not listed — the same selection the Sections screen makes for the section on
 * screen, here for every section at once. The estimate route runs it on the attachment and roof
 * system pickers and after "Update pricing & labor"; the Sections screen snaps the one section
 * whose own system / attachment changes.
 */
import type { EngineAdminData } from "@/lib/engine/adapters";
import type { Attachment } from "@/lib/engine/estimate";
import { resolveSectionSystem, type BidSectionInput } from "@/lib/engine/bid-builder";
import type { MechFastenerRow } from "@/lib/engine/fastener-spacing";
import { legacyLapOptions } from "@/lib/engine/lap-options";
import type { SavedBidState } from "@/lib/proposal-bid";

/** The part of the admin data the guard reads. */
export type SheetAdmin = {
  labor: Record<
    string,
    Pick<EngineAdminData["labor"][string], "sheetSizeMultiByLabel" | "rollGoodsSheetLabel">
  >;
  rollGoodWidthMulti?: EngineAdminData["rollGoodWidthMulti"];
  sheetTabSpacings?: EngineAdminData["sheetTabSpacings"];
};

const comboKey = (system: string, attachment: Attachment) =>
  `${system}|${attachment === "adhered" ? "adhesive" : "mechanical"}`;

/** The sheet labels a system + attachment offers, in the combo's order; none without a table. */
export function offeredSheetLabels(
  admin: SheetAdmin | null | undefined,
  roofSystem: string,
  attachment: Attachment,
): string[] {
  return Object.keys(admin?.labor[comboKey(roofSystem, attachment)]?.sheetSizeMultiByLabel ?? {});
}

/** "2000 sf" → 2000; a roll-goods label (no number) → null. */
export function sheetSqFt(label: string): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(label);
  return m ? Number(m[1]) : null;
}

/**
 * The offered label closest to `wanted` by square feet (a tie goes to the larger sheet). A
 * roll-goods label stays a roll when the combo offers one; otherwise, or when the combo has no
 * sheet with a number, the first offered label. Nothing offered → `wanted` as it is.
 */
export function nearestSheetLabel(offered: readonly string[], wanted: string): string {
  if (!offered.length) return wanted;
  if (offered.includes(wanted)) return wanted;
  const want = sheetSqFt(wanted);
  if (want === null) return offered.find((l) => sheetSqFt(l) === null) ?? offered[0]!;
  let best: string | null = null;
  let bestD = Infinity;
  for (const l of offered) {
    const n = sheetSqFt(l);
    if (n === null) continue;
    const d = Math.abs(n - want);
    if (d < bestD || (d === bestD && best !== null && n > sheetSqFt(best)!)) {
      best = l;
      bestD = d;
    }
  }
  return best ?? offered[0]!;
}

/** The bid state the guard checks (a `SavedBidState` or the estimator's live equivalent). */
export type SheetBidState = Pick<SavedBidState, "roofSystem" | "attachment" | "sections"> &
  Partial<Pick<SavedBidState, "membraneAdhesiveName" | "sectionDefaults">>;

const sectionLabel = (s: Pick<BidSectionInput, "name">, i: number) => {
  const n = (s.name ?? "").trim();
  if (!n) return `Section ${i + 1}`;
  return /^section\s+\S/i.test(n) ? n : `Section ${i + 1} "${n}"`;
};
const attachmentWord = (a: Attachment) => (a === "adhered" ? "adhered" : "mechanically fastened");
const sheetNotOffered = (
  who: string,
  label: string,
  system: string,
  attachment: Attachment,
  offered: readonly string[],
  to: string,
) =>
  `${who}: the ${label} sheet is not offered for ${system} ${attachmentWord(attachment)} (${offered.join(", ")}) — set to ${to}.`;

/**
 * Snap every section's sheet and lap, and the Setup default sheet, to what the labor combos in
 * force offer. Each correction is one sentence in `changes`; nothing to correct → the same
 * `state` object. `fastenerLookup` narrows a mechanical section's tab list by its pull test, as
 * the Sections screen does (absent: the raw list).
 */
export function snapBidSheets<T extends SheetBidState>(
  state: T,
  admin: SheetAdmin | null | undefined,
  fastenerLookup?: MechFastenerRow[] | undefined,
): { state: T; changes: string[] } {
  const changes: string[] = [];
  const bid = {
    roofSystem: state.roofSystem,
    attachment: state.attachment,
    membraneAdhesiveName: state.membraneAdhesiveName ?? "",
  };
  // legacyLapOptions reads the full admin shape; the guard's slice is what it touches.
  const lapAdmin = {
    labor: (admin?.labor ?? {}) as EngineAdminData["labor"],
    rollGoodWidthMulti: admin?.rollGoodWidthMulti,
    sheetTabSpacings: admin?.sheetTabSpacings,
  } as Pick<EngineAdminData, "rollGoodWidthMulti" | "labor" | "sheetTabSpacings">;

  let touched = false;
  const sections = state.sections.map((s, i) => {
    const sys = resolveSectionSystem(bid, s);
    let next = s;
    // A non-quick-bid section's sheet is derived from its area; its stored label is not used.
    if (s.isQuickBid !== false) {
      const offered = offeredSheetLabels(admin, sys.roofSystem, sys.attachment);
      if (offered.length && !offered.includes(s.sheetSizeLabel)) {
        const to = nearestSheetLabel(offered, s.sheetSizeLabel);
        changes.push(
          sheetNotOffered(
            sectionLabel(s, i),
            s.sheetSizeLabel,
            sys.roofSystem,
            sys.attachment,
            offered,
            to,
          ),
        );
        next = { ...next, sheetSizeLabel: to };
      }
    }
    // The lap the (possibly new) sheet implies: the Sections screen's own selection rule.
    const lap = legacyLapOptions(next, { bidDefaults: bid, fastenerLookup, admin: lapAdmin });
    if (lap.raw.length > 0 && !lap.checkPull && !lap.options.includes(next.fieldLap)) {
      const to = lap.options[0]!;
      changes.push(
        `${sectionLabel(s, i)}: a ${next.fieldLap}" lap is not a ${lap.isRollWidth ? "roll width" : "tab spacing"} offered for ${sys.roofSystem} (${lap.options.join(", ")}) — set to ${to}".`,
      );
      next = { ...next, fieldLap: to };
    }
    if (next !== s) touched = true;
    return next;
  });

  let sectionDefaults = state.sectionDefaults;
  if (sectionDefaults) {
    const offered = offeredSheetLabels(admin, bid.roofSystem, bid.attachment);
    if (offered.length && !offered.includes(sectionDefaults.sheetSizeLabel)) {
      const to = nearestSheetLabel(offered, sectionDefaults.sheetSizeLabel);
      changes.push(
        sheetNotOffered(
          "Roof-section default",
          sectionDefaults.sheetSizeLabel,
          bid.roofSystem,
          bid.attachment,
          offered,
          to,
        ),
      );
      sectionDefaults = { ...sectionDefaults, sheetSizeLabel: to };
    }
  }

  if (!changes.length) return { state, changes };
  return {
    state: {
      ...state,
      ...(touched ? { sections } : {}),
      ...(sectionDefaults !== state.sectionDefaults ? { sectionDefaults } : {}),
    },
    changes,
  };
}
