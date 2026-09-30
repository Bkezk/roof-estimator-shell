/**
 * Membrane thickness (mil) guard. A bid must never carry a mil its roof system does not offer:
 * the engine's price-matrix lookup returns nothing for a missing thickness and the membrane then
 * prices at $0 without a warning (bid-builder `priceMatrixLookup … ?? 0`). The owner (Sep 30):
 * "ensure when Update pricing & labor is clicked as well as Apply to Existing (parapets/sections)
 * is clicked it adjusts the mil as well, so that we can't have material with a mil that doesn't
 * exist."
 *
 * The offered mils of a system + attachment are the keys of the labor combo's thickness table
 * (`admin.labor["<system>|mechanical" | "<system>|adhesive"].thicknessLaborByMil` — Duro-Last
 * 40/50/60, Duro-Tuff 50/60, Duro-Tech TPO 45/60/80 …); a combo without a table falls back to the
 * legacy 40/50/60 trio, exactly like the estimator's "Type" pickers.
 *
 * Pure: no React, no I/O. The estimate route runs `snapBidMils` after "Update Pricing & Labor",
 * after "Apply to Existing Parapets" (`applyParapetDefaultsToWalls`) and on bid load; the Sections
 * and Parapets pickers build their lists with `sectionMilChoices` / `parapetMilChoices`.
 */

import type { EngineAdminData } from "@/lib/engine/adapters";
import type { Attachment } from "@/lib/engine/estimate";
import {
  resolveParapetSystem,
  resolveSectionSystem,
  type BidSectionInput,
  type ParapetInput,
} from "@/lib/engine/bid-builder";
import type { SavedBidState } from "@/lib/proposal-bid";

/** The part of the admin data the guard reads. */
export type MilAdmin = {
  labor: Record<string, Pick<EngineAdminData["labor"][string], "thicknessLaborByMil">>;
};

/** The legacy thickness trio, used when a combo carries no thickness table. */
export const LEGACY_MILS: readonly number[] = [40, 50, 60];

/** The mils a roof system + attachment offers (ascending); the legacy trio when it has no table. */
export function offeredMils(
  admin: MilAdmin | null | undefined,
  roofSystem: string,
  attachment: Attachment,
): number[] {
  const combo =
    admin?.labor[`${roofSystem}|${attachment === "adhered" ? "adhesive" : "mechanical"}`];
  const mils = Object.keys(combo?.thicknessLaborByMil ?? {})
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  return mils.length ? [...new Set(mils)] : [...LEGACY_MILS];
}

/**
 * The offered mil closest to `wanted` (a tie goes to the thicker one). With no `wanted` (absent,
 * zero, not a number): 60 when offered, else the first — the default the system pickers use.
 */
export function nearestMil(offered: readonly number[], wanted?: number | null): number {
  const list = offered.length ? offered : LEGACY_MILS;
  if (wanted === undefined || wanted === null || !Number.isFinite(wanted) || wanted <= 0)
    return list.includes(60) ? 60 : list[0]!;
  let best = list[0]!;
  for (const m of list) {
    const d = Math.abs(m - wanted);
    const bd = Math.abs(best - wanted);
    if (d < bd || (d === bd && m > best)) best = m;
  }
  return best;
}

const milList = (offered: readonly number[]) => offered.join(", ");

const notOffered = (
  who: string,
  what: string,
  system: string,
  offered: readonly number[],
  to: number,
) => `${who}: ${what} is not offered for ${system} (${milList(offered)}) — set to ${to} mil.`;

const sectionLabel = (s: Pick<BidSectionInput, "name">, i: number) => {
  const n = (s.name ?? "").trim();
  if (!n) return `Section ${i + 1}`;
  return /^section\s+\S/i.test(n) ? n : `Section ${i + 1} "${n}"`;
};

const parapetLabel = (p: Pick<ParapetInput, "name">, i: number) => {
  const n = (p.name ?? "").trim();
  if (!n) return `Parapet ${i + 1}`;
  return /^parapet\s+\S/i.test(n) ? n : `Parapet ${i + 1} "${n}"`;
};

/** The bid-level material a section / wall without its own override follows. */
export interface BidMaterial {
  roofSystem: string;
  attachment: Attachment;
  membraneAdhesiveName?: string;
}

/**
 * Snap every wall's membrane mil to what the wall's own system + attachment (wall override, else
 * the bid's — the engine's `resolveParapetSystem`) offers. A wall with no mil of its own prices
 * at `inheritedMil` (the engine: the first roof section's thickness); when THAT is not offered
 * for the wall's system the wall is pinned to the nearest offered mil.
 */
export function snapParapetMils(
  parapets: readonly ParapetInput[],
  bid: BidMaterial,
  inheritedMil: number | undefined,
  admin: MilAdmin | null | undefined,
): { parapets: ParapetInput[]; changes: string[] } {
  const changes: string[] = [];
  let touched = false;
  const out = parapets.map((p, i) => {
    const ps = resolveParapetSystem(bid, p);
    const offered = offeredMils(admin, ps.roofSystem, ps.attachment);
    if (p.thicknessMil !== undefined) {
      if (offered.includes(p.thicknessMil)) return p;
      const to = nearestMil(offered, p.thicknessMil);
      changes.push(
        notOffered(parapetLabel(p, i), `${p.thicknessMil} mil`, ps.roofSystem, offered, to),
      );
      touched = true;
      return { ...p, thicknessMil: to };
    }
    if (inheritedMil === undefined || !(inheritedMil > 0) || offered.includes(inheritedMil))
      return p;
    const to = nearestMil(offered, inheritedMil);
    changes.push(
      notOffered(
        parapetLabel(p, i),
        `the bid default ${inheritedMil} mil`,
        ps.roofSystem,
        offered,
        to,
      ),
    );
    touched = true;
    return { ...p, thicknessMil: to };
  });
  return { parapets: touched ? out : [...parapets], changes };
}

type ParapetDefaults = NonNullable<SavedBidState["parapetDefaults"]>;

/**
 * Snap the Setup "5. Parapets Material" Type to the parapet system's mils. Unset, the default
 * follows the roof-section default mil (`sectionDefaultMil`); when that is not offered for the
 * parapet system the default is pinned to the nearest offered mil.
 */
export function snapParapetDefaults(
  pd: ParapetDefaults,
  bid: BidMaterial,
  sectionDefaultMil: number | undefined,
  admin: MilAdmin | null | undefined,
): { parapetDefaults: ParapetDefaults; change: string | null } {
  const system = pd.roofSystem || bid.roofSystem;
  const offered = offeredMils(admin, system, pd.attachment ?? bid.attachment);
  const own = pd.thicknessMil;
  const mil = own ?? sectionDefaultMil;
  if (mil === undefined || !(mil > 0) || offered.includes(mil))
    return { parapetDefaults: pd, change: null };
  const to = nearestMil(offered, mil);
  return {
    parapetDefaults: { ...pd, thicknessMil: to },
    change: notOffered(
      "Parapet default",
      own !== undefined ? `${own} mil` : `the roof-section default ${mil} mil`,
      system,
      offered,
      to,
    ),
  };
}

/** The bid state the guard checks (a `SavedBidState` or the estimator's live equivalent). */
export type MilBidState = Pick<SavedBidState, "roofSystem" | "attachment" | "sections"> &
  Partial<
    Pick<SavedBidState, "membraneAdhesiveName" | "parapets" | "sectionDefaults" | "parapetDefaults">
  >;

/**
 * Check every membrane mil of a bid against the admin data in force and correct the ones the
 * system does not offer (nearest offered mil; a tie goes to the thicker). Checked:
 *  - every roof section's `thickness`, against the section's own system + attachment;
 *  - the Setup roof-section default (`sectionDefaults.thickness`), against the bid system;
 *  - every parapet's `thicknessMil` (and, unset, the first section's mil it inherits), against the
 *    wall's system + attachment;
 *  - the Setup parapet default (`parapetDefaults.thicknessMil`), against the parapet system.
 * Each correction is one sentence in `changes`. Nothing to correct → the same `state` object.
 */
export function snapBidMils<T extends MilBidState>(
  state: T,
  admin: MilAdmin | null | undefined,
): { state: T; changes: string[] } {
  const changes: string[] = [];
  const bid: BidMaterial = {
    roofSystem: state.roofSystem,
    attachment: state.attachment,
    ...(state.membraneAdhesiveName ? { membraneAdhesiveName: state.membraneAdhesiveName } : {}),
  };

  let sectionsTouched = false;
  const sections = state.sections.map((s, i) => {
    const sys = resolveSectionSystem(bid, s);
    const offered = offeredMils(admin, sys.roofSystem, sys.attachment);
    if (offered.includes(s.thickness)) return s;
    const to = nearestMil(offered, s.thickness);
    changes.push(notOffered(sectionLabel(s, i), `${s.thickness} mil`, sys.roofSystem, offered, to));
    sectionsTouched = true;
    return { ...s, thickness: to };
  });

  let sectionDefaults = state.sectionDefaults;
  if (sectionDefaults) {
    const offered = offeredMils(admin, bid.roofSystem, bid.attachment);
    if (!offered.includes(sectionDefaults.thickness)) {
      const to = nearestMil(offered, sectionDefaults.thickness);
      changes.push(
        notOffered(
          "Roof-section default",
          `${sectionDefaults.thickness} mil`,
          bid.roofSystem,
          offered,
          to,
        ),
      );
      sectionDefaults = { ...sectionDefaults, thickness: to };
    }
  }

  let parapets = state.parapets;
  if (parapets?.length) {
    const r = snapParapetMils(parapets, bid, sections[0]?.thickness, admin);
    if (r.changes.length) {
      changes.push(...r.changes);
      parapets = r.parapets;
    }
  }

  let parapetDefaults = state.parapetDefaults;
  if (parapetDefaults) {
    const r = snapParapetDefaults(parapetDefaults, bid, sectionDefaults?.thickness, admin);
    if (r.change) {
      changes.push(r.change);
      parapetDefaults = r.parapetDefaults;
    }
  }

  if (!changes.length) return { state, changes };
  return {
    state: {
      ...state,
      ...(sectionsTouched ? { sections } : {}),
      ...(sectionDefaults !== state.sectionDefaults ? { sectionDefaults } : {}),
      ...(parapets !== state.parapets ? { parapets } : {}),
      ...(parapetDefaults !== state.parapetDefaults ? { parapetDefaults } : {}),
    },
    changes,
  };
}

/**
 * Setup "Apply to Existing Parapets" (legacy Button1_Click_1 + the owner's additions): the Setup
 * deck type, wall type and "5. Parapets Material" (roof system, attached with, adhesive, mil,
 * colour) go onto every wall — a default that equals the bid material clears the wall's override.
 * The copied mil is then checked against each wall's system (`snapParapetMils`), so a wall never
 * ends up on a mil its system does not offer.
 */
export function applyParapetDefaultsToWalls(
  walls: readonly ParapetInput[],
  defaults: {
    parapetDefaults: ParapetDefaults;
    /** Setup "1. Deck Type" (sectionDefaults.deckType). */
    deckType: string;
    /** The bid's roof-section material (what a wall without an override follows). */
    bid: BidMaterial;
    /** The mil a wall without its own prices at (the first roof section's thickness). */
    inheritedMil?: number | undefined;
  },
  admin: MilAdmin | null | undefined,
): { parapets: ParapetInput[]; changes: string[] } {
  const pd = defaults.parapetDefaults;
  const copied = walls.map((pp) => {
    const nx: ParapetInput = {
      ...pp,
      deckType: defaults.deckType,
      wallType: pd.wallType ?? 4,
    };
    // Roof System / Attached With / adhesive: the defaults when they differ from the bid
    // material, else back to "bid default".
    if (pd.roofSystem) nx.roofSystem = pd.roofSystem;
    else delete nx.roofSystem;
    if (pd.attachment) nx.attachment = pd.attachment;
    else delete nx.attachment;
    if (pd.membraneAdhesiveName) nx.membraneAdhesiveName = pd.membraneAdhesiveName;
    else delete nx.membraneAdhesiveName;
    if (pd.thicknessMil !== undefined) nx.thicknessMil = pd.thicknessMil;
    else delete nx.thicknessMil;
    if (pd.color) nx.color = pd.color;
    else delete nx.color;
    return nx;
  });
  return snapParapetMils(copied, defaults.bid, defaults.inheritedMil, admin);
}

/**
 * Setup "Apply To Existing Roof Sections" (legacy Button1_Click / OverwriteWithDefault + the
 * owner's deck type): every section drops its Roof System / Attached With / adhesive override and
 * takes the Setup deck type, design table, mil and colour. The copied mil is then checked against
 * the bid system (a default saved before a system change, an imported bid) and snapped.
 */
export function applySectionDefaultsToSections(
  sections: readonly BidSectionInput[],
  sectionDefaults: NonNullable<SavedBidState["sectionDefaults"]>,
  bid: BidMaterial,
  admin: MilAdmin | null | undefined,
): { sections: BidSectionInput[]; changes: string[] } {
  const copied = sections.map((sec) => {
    const nx = { ...sec };
    delete nx.roofSystem;
    delete nx.attachment;
    delete nx.membraneAdhesiveName;
    return {
      ...nx,
      deckType: sectionDefaults.deckType,
      designTable: sectionDefaults.designTable ?? 60,
      thickness: sectionDefaults.thickness,
      color: sectionDefaults.color,
    };
  });
  const r = snapBidMils({ ...bid, sections: copied }, admin);
  return { sections: r.state.sections, changes: r.changes };
}

// ── Picker lists ────────────────────────────────────────────────────────────────────────────

/** Sections "Type (mil)": the offered mils; a saved mil that is not offered reads "50 (not offered)". */
export function sectionMilChoices(
  offered: readonly number[],
  thickness: number,
): { options: string[]; value: string; notOffered: boolean } {
  const opts = offered.map(String);
  if (offered.includes(thickness))
    return { options: opts, value: String(thickness), notOffered: false };
  const cur = `${thickness} (not offered)`;
  return { options: [cur, ...opts], value: cur, notOffered: true };
}

const BID_DEFAULT = "Bid default";

/**
 * Parapets "Mil": "Bid default (N mil)" (the wall follows the first roof section's mil) plus the
 * wall system's own mils — never a mil the system lacks. A bid default the wall's system does not
 * offer is only listed while the wall is on it (marked "not offered"); likewise a saved wall mil.
 */
export function parapetMilChoices(
  offered: readonly number[],
  wallMil: number | undefined,
  bidDefaultMil: number | undefined,
): { options: string[]; value: string; notOffered: boolean } {
  const hasDefault = bidDefaultMil !== undefined && bidDefaultMil > 0;
  const defaultOk = hasDefault && offered.includes(bidDefaultMil);
  const defaultLabel = !hasDefault
    ? BID_DEFAULT
    : defaultOk
      ? `${BID_DEFAULT} (${bidDefaultMil} mil)`
      : `${BID_DEFAULT} (${bidDefaultMil} mil — not offered)`;
  const own = offered.filter((m) => !(defaultOk && m === bidDefaultMil)).map((m) => `${m} mil`);
  if (wallMil === undefined)
    return {
      options: [defaultLabel, ...own],
      value: defaultLabel,
      notOffered: !defaultOk && hasDefault,
    };
  const head = defaultOk || !hasDefault ? [defaultLabel] : [];
  if (offered.includes(wallMil)) {
    // The wall's own mil equal to the bid default reads as the default (picking it follows the bid).
    const value = defaultOk && wallMil === bidDefaultMil ? defaultLabel : `${wallMil} mil`;
    return { options: [...head, ...own], value, notOffered: false };
  }
  const cur = `${wallMil} mil (not offered)`;
  return { options: [cur, ...head, ...own], value: cur, notOffered: true };
}

/** A `parapetMilChoices` pick → the wall's `thicknessMil` (undefined = follow the bid default). */
export function parseParapetMilChoice(v: string): number | undefined {
  if (v.startsWith(BID_DEFAULT)) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
