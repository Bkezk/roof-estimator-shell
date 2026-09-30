/**
 * Seed → NEW bid state (pure). Moved verbatim from the NEW-bid branch of the estimate route's
 * `?takeoff=` handler so the PlanSwift import (src/lib/planswift) starts its bid the same way: the
 * seed's material answers over the bid's current defaults, one section / parapet / curb per seed
 * entry through the route's own factories, the seeded pipe stacks and drains.
 */

import type { BidSectionInput, CurbInput, ParapetInput } from "@/lib/engine/bid-builder";
import type { SavedBidState } from "@/lib/proposal-bid";
import type { TakeoffBidSeed } from "./create-bid";

/** The estimate route's `newSection` / `newParapet` / `newCurb` factories. */
export interface SeedFactories {
  newSection: (defaults: Partial<BidSectionInput>) => BidSectionInput;
  newParapet: (defaults: Partial<ParapetInput>) => ParapetInput;
  newCurb: (defaults: Partial<CurbInput>) => CurbInput;
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
  return {
    ...saved,
    ...(seed.roofSystem ? { roofSystem: seed.roofSystem } : {}),
    ...(seed.attachment ? { attachment: seed.attachment } : {}),
    ...(seed.membraneAdhesiveName ? { membraneAdhesiveName: seed.membraneAdhesiveName } : {}),
    sections: seed.sections.map((o) => make.newSection({ ...secDefaults, ...o })),
    parapets: seed.parapets.map((o) => make.newParapet(o)),
    curbs: seed.curbs.map((o) => make.newCurb(o)),
    accessoriesCalc: {
      ...saved.accessoriesCalc,
      pipeStacks: seed.pipeStacks,
      drains: seed.drains,
    },
    sectionDefaults: secDefaults,
    parapetDefaults: { ...saved.parapetDefaults, ...seed.parapetDefaults },
  };
}
