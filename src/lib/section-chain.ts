/**
 * The pull-test chain (owner, Oct 26: "when the pull test, design table, field roll width, etc
 * are updated they update each other … if you cant have a combination of two value it wont let
 * you keep them in there simply because you changed one and didnt change the other").
 *
 * Bid Advantage never blocks an edit. A change to the pull test, the design table, the mil or
 * the lap rebuilds the dependent list from MechFastenerLookup and moves the selection
 * (frmRoofSection.LoadLapSpacings → cbLapWidth_SelectedIndexChanged, then
 * cMechanicalSystem.UniversalFastenerSpacing for the field / perimeter / corner o.c.): the saved
 * value stays when still listed, else the first valid one, and "Check Pull" (FieldLap 0) when
 * none qualifies. The Sections screen already did that for the ONE section on screen
 * (`lapSync` / `updWithSpacing`). This module is the same rule as pure functions, in the voice of
 * lib/bid-mils.ts and lib/bid-sheets.ts (`snapBidX(state, …) → { state, changes }`):
 *
 *  - `offeredDesignTables`: the design tables the lookup has rows for (system + mil), so the
 *    Design Table pick never lists a psf the lookup cannot price;
 *  - `snapBidChain`: for EVERY section, design table → lap → derived spacing, and the Setup
 *    default design table — run by the estimate route on the system / attachment pickers, the
 *    Setup default, "Apply to existing sections", bid load and "Update pricing & labor";
 *  - the "Custom spacing" switch (`clearCustomOnUpstreamChange`): the field / perimeter / corner
 *    o.c. are derived unless the estimator says otherwise per section, and an upstream change
 *    drops the override so a typed spacing never survives the pull test it was typed for;
 *  - `pullTestAdvice`: why a lap reads "Check Pull" and what fixes it (the lb the lookup
 *    needs, or a lap that works at the entered pull test).
 *
 * No engine edits: the per-section custom flag lives beside the sections in SavedBidState
 * (`customSpacing`, keyed by section id), not inside BidSectionInput.
 */
import type { EngineAdminData } from "@/lib/engine/adapters";
import { resolveSectionSystem, type BidSectionInput } from "@/lib/engine/bid-builder";
import {
  DESIGN_TABLE_OPTIONS,
  LEGACY_ROOF_SYSTEM_IDS,
  universalFastenerSpacing,
  type MechFastenerRow,
} from "@/lib/engine/fastener-spacing";
import { legacyLapOptions } from "@/lib/engine/lap-options";
import type { SheetAdmin } from "@/lib/bid-sheets";
import type { SavedBidState } from "@/lib/proposal-bid";

// ── Design table ────────────────────────────────────────────────────────────────────────────

/**
 * The design tables (psf) with at least one lookup row for the system and mil, ascending; a row
 * with membraneThickness −1 counts for every mil. Without a lookup, or without any row for the
 * system, the full DESIGN_TABLE_OPTIONS list — a data gap, not a rule (lap-options takes the
 * same stance). A system with rows but none for this mil lists nothing: the −5 "no lookup rows
 * for this system/thickness" case the Sections screen already reports.
 */
export function offeredDesignTables(
  lookup: MechFastenerRow[] | null | undefined,
  roofSystemId: number,
  thickness: number,
): number[] {
  if (!lookup?.length) return [...DESIGN_TABLE_OPTIONS];
  const sys = lookup.filter((r) => r.roofSystemId === roofSystemId);
  if (!sys.length) return [...DESIGN_TABLE_OPTIONS];
  const tables = new Set<number>();
  for (const r of sys)
    if (r.membraneThickness === thickness || r.membraneThickness === -1) tables.add(r.designTable);
  return [...tables].sort((a, b) => a - b);
}

/** The offered table closest to `wanted` by value (a tie goes up); `wanted` when none is offered. */
export function nearestDesignTable(offered: readonly number[], wanted: number): number {
  if (!offered.length) return wanted;
  let best = offered[0]!;
  for (const t of offered) {
    const d = Math.abs(t - wanted);
    const bd = Math.abs(best - wanted);
    if (d < bd || (d === bd && t > best)) best = t;
  }
  return best;
}

// ── Custom spacing ──────────────────────────────────────────────────────────────────────────

/** The section keys the derived spacing depends on; a change to any of them clears "Custom spacing". */
export const SPACING_UPSTREAM_KEYS: readonly (keyof BidSectionInput)[] = [
  "roofSystem",
  "attachment",
  "thickness",
  "designTable",
  "fieldLap",
  "pullTest",
];

/** The per-section "Custom spacing" flags (SavedBidState.customSpacing): present = typed by hand. */
export type CustomSpacing = Record<string, true>;

/**
 * The rule behind the switch: a section on custom spacing loses it when an upstream key changes
 * (the o.c. typed for a 350 lb pull test is not the o.c. for 280). Same object back when nothing
 * is cleared.
 */
export function clearCustomOnUpstreamChange(
  customSpacing: CustomSpacing,
  sectionId: string,
  changedKeys: readonly string[],
): { customSpacing: CustomSpacing; cleared: boolean } {
  if (!customSpacing[sectionId]) return { customSpacing, cleared: false };
  if (!changedKeys.some((k) => (SPACING_UPSTREAM_KEYS as readonly string[]).includes(k)))
    return { customSpacing, cleared: false };
  const next = { ...customSpacing };
  delete next[sectionId];
  return { customSpacing: next, cleared: true };
}

// ── Derived spacing ─────────────────────────────────────────────────────────────────────────

/**
 * The field / perimeter / corner o.c. UniversalFastenerSpacing derives for the section's keys
 * (the Sections screen's `updWithSpacing`): only the columns the lookup finds; a failed lookup
 * leaves the box as it is. Empty when the section is not mechanical, has no pull test, or the
 * system is unknown to the lookup.
 */
export function derivedSpacing(
  lookup: MechFastenerRow[] | null | undefined,
  s: BidSectionInput,
  sys: { roofSystem: string; attachment: string },
): Partial<Pick<BidSectionInput, "fastenerOc" | "perimFastenerOc" | "cornerFastenerOc">> {
  const rsId = LEGACY_ROOF_SYSTEM_IDS[sys.roofSystem];
  if (!lookup?.length || !rsId || sys.attachment !== "mechanical" || !s.pullTest || s.pullTest <= 0)
    return {};
  const base = {
    roofSystemId: rsId,
    thickness: s.thickness,
    designTable: s.designTable ?? 60,
    tabSpacings: [s.fieldLap],
    pullTest: s.pullTest,
  };
  const field = universalFastenerSpacing(lookup, { ...base, columnOffset: 0 });
  const perim = universalFastenerSpacing(lookup, { ...base, columnOffset: 1 });
  const corner = universalFastenerSpacing(lookup, { ...base, columnOffset: 2 });
  return {
    ...(field.ok ? { fastenerOc: field.inches } : {}),
    ...(perim.ok ? { perimFastenerOc: perim.inches } : {}),
    ...(corner.ok ? { cornerFastenerOc: corner.inches } : {}),
  };
}

// ── The whole chain, every section ──────────────────────────────────────────────────────────

/** The bid state the chain checks (a `SavedBidState` or the estimator's live equivalent). */
export type ChainBidState = Pick<SavedBidState, "roofSystem" | "attachment" | "sections"> &
  Partial<Pick<SavedBidState, "membraneAdhesiveName" | "sectionDefaults" | "customSpacing">>;

const sectionLabel = (s: Pick<BidSectionInput, "name">, i: number) => {
  const n = (s.name ?? "").trim();
  if (!n) return `Section ${i + 1}`;
  return /^section\s+\S/i.test(n) ? n : `Section ${i + 1} "${n}"`;
};
const tableNotOffered = (
  who: string,
  table: number,
  system: string,
  mil: number,
  offered: readonly number[],
  to: number,
) =>
  `${who}: a ${table} psf design table has no fastener rows for ${system} ${mil} mil (${offered.join(", ")}) — set to ${to} psf.`;

/**
 * Snap every section's design table, lap and derived spacing, and the Setup default design
 * table, to the fastener lookup in force. Per section, in order:
 *  (a) design table → the offered list for the section's system + mil (nearest by value, a tie
 *      up) when unlisted — mechanical only; an adhered section's table is not used by the lookup;
 *  (b) lap → legacyLapOptions: the first offered lap when unlisted, 0 ("Check Pull") when none
 *      qualifies, as the Sections screen's LoadLapSpacings effect does for the section on screen;
 *  (c) spacing → a section not in `customSpacing` takes the field / perimeter / corner o.c. the
 *      lookup derives (a failed lookup leaves the box as it is).
 * Each correction is one sentence in `changes`; nothing to correct → the same `state` object.
 * Without a lookup the chain has nothing to check (the lists fall back to their raw forms).
 */
export function snapBidChain<T extends ChainBidState>(
  state: T,
  admin: SheetAdmin | null | undefined,
  lookup: MechFastenerRow[] | null | undefined,
): { state: T; changes: string[] } {
  const changes: string[] = [];
  if (!lookup?.length) return { state, changes };
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
  const custom = state.customSpacing ?? {};

  let touched = false;
  const sections = state.sections.map((s, i) => {
    const sys = resolveSectionSystem(bid, s);
    const rsId = LEGACY_ROOF_SYSTEM_IDS[sys.roofSystem];
    if (sys.attachment !== "mechanical" || !rsId) return s;
    const who = sectionLabel(s, i);
    let next = s;
    // (a) The design table.
    const table = next.designTable ?? 60;
    const offered = offeredDesignTables(lookup, rsId, next.thickness);
    if (offered.length && !offered.includes(table)) {
      const to = nearestDesignTable(offered, table);
      changes.push(tableNotOffered(who, table, sys.roofSystem, next.thickness, offered, to));
      next = { ...next, designTable: to };
    }
    // (b) The lap, from the list the (possibly new) table and the pull test leave.
    const lap = legacyLapOptions(next, {
      bidDefaults: bid,
      fastenerLookup: lookup,
      admin: lapAdmin,
    });
    const kind = lap.isRollWidth ? "roll width" : "tab spacing";
    const at = `${sys.roofSystem} ${next.thickness} mil at ${next.designTable ?? 60} psf with a ${next.pullTest ?? 0} lb pull test`;
    if (lap.raw.length > 0) {
      if (lap.checkPull) {
        if (next.fieldLap !== 0) {
          changes.push(`${who}: no ${kind} has a fastener spacing for ${at} — set to Check Pull.`);
          next = { ...next, fieldLap: 0 };
        }
      } else if (!lap.options.includes(next.fieldLap)) {
        const to = lap.options[0]!;
        changes.push(
          `${who}: a ${next.fieldLap}" ${kind} has no fastener spacing for ${at} (${lap.options.join(", ")}) — set to ${to}".`,
        );
        next = { ...next, fieldLap: to };
      }
    }
    // (c) The derived spacing, unless the estimator typed this section's own.
    if (!custom[s.id]) {
      const d = derivedSpacing(lookup, next, sys);
      const unit = sys.rsId === 2 ? " per 4x8" : '"';
      const parts: string[] = [];
      if (d.fastenerOc !== undefined && d.fastenerOc !== next.fastenerOc)
        parts.push(
          `field spacing re-derived to ${d.fastenerOc}${unit} (was ${next.fastenerOc}${unit})`,
        );
      if (d.perimFastenerOc !== undefined && d.perimFastenerOc !== next.perimFastenerOc)
        parts.push(
          `${parts.length ? "perimeter spacing to" : "perimeter spacing re-derived to"} ${d.perimFastenerOc}${unit} (was ${next.perimFastenerOc}${unit})`,
        );
      if (d.cornerFastenerOc !== undefined && d.cornerFastenerOc !== next.cornerFastenerOc)
        parts.push(
          `${parts.length ? "corner spacing to" : "corner spacing re-derived to"} ${d.cornerFastenerOc}${unit} (was ${next.cornerFastenerOc}${unit})`,
        );
      if (parts.length) {
        changes.push(`${who}: ${parts.join(", ")}.`);
        next = { ...next, ...d };
      }
    }
    if (next !== s) touched = true;
    return next;
  });

  let sectionDefaults = state.sectionDefaults;
  const bidRsId = LEGACY_ROOF_SYSTEM_IDS[bid.roofSystem];
  if (sectionDefaults && bid.attachment === "mechanical" && bidRsId) {
    const table = sectionDefaults.designTable ?? 60;
    const offered = offeredDesignTables(lookup, bidRsId, sectionDefaults.thickness);
    if (offered.length && !offered.includes(table)) {
      const to = nearestDesignTable(offered, table);
      changes.push(
        tableNotOffered(
          "Roof-section default",
          table,
          bid.roofSystem,
          sectionDefaults.thickness,
          offered,
          to,
        ),
      );
      sectionDefaults = { ...sectionDefaults, designTable: to };
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

// ── "Check Pull": the reason and the fix ────────────────────────────────────────────────────

const systemName = (id: number) =>
  Object.keys(LEGACY_ROOF_SYSTEM_IDS).find((k) => LEGACY_ROOF_SYSTEM_IDS[k] === id) ??
  `system ${id}`;
const lapWords = (laps: readonly number[]) => laps.map((l) => `${l}"`).join(" or ");

/**
 * Why the lookup finds no field spacing for a lap, and what fixes it. `needed` is the lowest
 * pull-test threshold among the rows for the system / mil / table / lap (tabSpacing −1 counts)
 * that permit a field spacing — null when no such row exists; `lapsThatWork` are the system's
 * laps (`laps`: its tab list or roll widths) that find a field spacing at the entered pull test.
 * `lap` 0 is the "Check Pull" case: no lap qualifies, so the threshold is the lowest any lap
 * needs. The message is for the Sections screen, beside the lap pick and the Calc'd spacing line.
 */
export function pullTestAdvice(
  lookup: MechFastenerRow[] | null | undefined,
  a: {
    roofSystemId: number;
    thickness: number;
    designTable: number;
    lap: number;
    pullTest: number;
    laps: readonly number[];
  },
): { needed: number | null; lapsThatWork: number[]; message: string } {
  const name = systemName(a.roofSystemId);
  const rows = (lookup ?? []).filter(
    (r) =>
      r.roofSystemId === a.roofSystemId &&
      (r.membraneThickness === a.thickness || r.membraneThickness === -1) &&
      r.designTable === a.designTable,
  );
  if (!rows.length)
    return {
      needed: null,
      lapsThatWork: [],
      message: `The fastener lookup has no rows for ${name} ${a.thickness} mil at ${a.designTable} psf.`,
    };
  const forLap =
    a.lap > 0
      ? rows.filter((r) => r.tabSpacing === a.lap || r.tabSpacing === -1)
      : rows.filter((r) => r.tabSpacing === -1 || a.laps.includes(r.tabSpacing));
  const thresholds = forLap
    .filter((r) => r.fieldSpacing !== -1 && r.pullTest >= 0)
    .map((r) => r.pullTest);
  const needed = thresholds.length ? Math.min(...thresholds) : null;
  const lapsThatWork = a.laps.filter(
    (lap) =>
      universalFastenerSpacing(lookup ?? [], {
        roofSystemId: a.roofSystemId,
        thickness: a.thickness,
        designTable: a.designTable,
        tabSpacings: [lap],
        pullTest: a.pullTest,
        columnOffset: 0,
      }).ok,
  );
  const lb = `${a.pullTest} lb`;
  if (a.lap <= 0) {
    const fix =
      needed !== null && needed > a.pullTest
        ? `Needs ${needed} lb.`
        : "Raise the pull test or the design table.";
    return {
      needed,
      lapsThatWork,
      message: `No lap qualifies at ${a.designTable} psf with a ${lb} pull test. ${fix}`,
    };
  }
  const others = lapsThatWork.filter((l) => l !== a.lap);
  const fix =
    needed !== null && needed > a.pullTest
      ? others.length
        ? `Needs ${needed} lb, or a ${lapWords(others)} lap.`
        : `Needs ${needed} lb.`
      : others.length
        ? `A ${lapWords(others)} lap works at ${lb}.`
        : `No lap qualifies at ${lb}; raise the pull test or the design table.`;
  return {
    needed,
    lapsThatWork,
    message: `No spacing for a ${a.lap}" lap at ${a.designTable} psf with a ${lb} pull test. ${fix}`,
  };
}
