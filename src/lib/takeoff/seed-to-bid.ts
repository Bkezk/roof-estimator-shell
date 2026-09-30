/**
 * Seed → NEW bid state (pure). Moved verbatim from the NEW-bid branch of the estimate route's
 * `?takeoff=` handler so the PlanSwift import (src/lib/planswift) starts its bid the same way: the
 * seed's material answers over the bid's current defaults, one section / parapet / curb per seed
 * entry through the route's own factories (a wall with the bid's parapet defaults, exactly as the
 * Parapets screen's "Add parapet" builds one), the seeded pipe stacks and drains, and the
 * takeoff Setup's notes in the bid's notes.
 */

import type { BidSectionInput, CurbInput, ParapetInput } from "@/lib/engine/bid-builder";
import type { SavedBidState } from "@/lib/proposal-bid";
import { withTakeoffNotes, type TakeoffBidSeed } from "./create-bid";

/** The estimate route's `newSection` / `newParapet` / `newCurb` factories. */
export interface SeedFactories {
  newSection: (defaults: Partial<BidSectionInput>) => BidSectionInput;
  newParapet: (defaults: Partial<ParapetInput>) => ParapetInput;
  newCurb: (defaults: Partial<CurbInput>) => CurbInput;
}

/**
 * What the Parapets screen's "Add parapet" puts on a new wall from the bid's defaults (Setup
 * "1. Deck Type", "2. Wall Type" and "5. Parapets Material": roof system, attachment, adhesive,
 * mil, colour). A wall seeded from a drawing starts from the same, so it prices like one added
 * by hand.
 */
export function parapetFromDefaults(
  pd: SavedBidState["parapetDefaults"] | undefined,
  deckType?: string,
): Partial<ParapetInput> {
  const o: Partial<ParapetInput> = {};
  if (deckType) o.deckType = deckType;
  o.wallType = pd?.wallType ?? 4;
  if (pd?.roofSystem) o.roofSystem = pd.roofSystem;
  if (pd?.attachment) o.attachment = pd.attachment;
  if (pd?.membraneAdhesiveName) o.membraneAdhesiveName = pd.membraneAdhesiveName;
  if (pd?.thicknessMil !== undefined) o.thicknessMil = pd.thicknessMil;
  if (pd?.color) o.color = pd.color;
  return o;
}

/**
 * `saved` is the fresh bid as the estimator holds it (its Home defaults already applied); the
 * result replaces its sections, parapets, curbs, pipe stacks and drains with the seed's.
 */
export function newBidFromSeed(
  saved: SavedBidState & { sectionDefaults: NonNullable<SavedBidState["sectionDefaults"]> },
  seed: TakeoffBidSeed,
  make: SeedFactories,
): SavedBidState {
  const secDefaults = { ...saved.sectionDefaults, ...seed.sectionDefaults };
  const parapetDefaults = { ...saved.parapetDefaults, ...seed.parapetDefaults };
  const wallDefaults = parapetFromDefaults(parapetDefaults, secDefaults.deckType);
  const notes = withTakeoffNotes(saved.customer.notes, seed.setupNotes);
  return {
    ...saved,
    ...(seed.roofSystem ? { roofSystem: seed.roofSystem } : {}),
    ...(seed.attachment ? { attachment: seed.attachment } : {}),
    ...(seed.membraneAdhesiveName ? { membraneAdhesiveName: seed.membraneAdhesiveName } : {}),
    sections: seed.sections.map((o) => make.newSection({ ...secDefaults, ...o })),
    parapets: seed.parapets.map((o) => make.newParapet({ ...wallDefaults, ...o })),
    curbs: seed.curbs.map((o) => make.newCurb(o)),
    accessoriesCalc: {
      ...saved.accessoriesCalc,
      pipeStacks: seed.pipeStacks,
      drains: seed.drains,
    },
    ...(notes !== saved.customer.notes ? { customer: { ...saved.customer, notes } } : {}),
    sectionDefaults: secDefaults,
    parapetDefaults,
  };
}
