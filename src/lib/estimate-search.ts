/**
 * /estimate's search params (src/routes/estimate.tsx validateSearch): a saved bid, a combine
 * list, a takeoff / PlanSwift seed, or a generic prefill for a NEW bid that another module hands
 * the estimator as plain values in the URL (the estimator imports nothing from that module).
 * Pure, so the parsing is tested without the route.
 */

export interface EstimateSearch {
  bid?: string;
  combine?: string;
  /** A takeoff id: a NEW bid seeded from that drawing (docs/planswift-research.md §4.6). */
  takeoff?: string;
  /** A PlanSwift import hand-off id: a NEW bid seeded from the export (src/lib/planswift). */
  planswift?: string;
  building?: string;
  pfName?: string;
  pfOwner?: string;
  pfAddr?: string;
  pfAddr2?: string;
  pfCity?: string;
  pfState?: string;
  pfZip?: string;
  pfW?: number;
  pfL?: number;
  /**
   * The customer profile (crm_accounts.id) and site (crm_sites.id) to link the new bid to, as
   * the takeoff hand-off links its customer (owner, Sep 30: "Create bid" from an inspection).
   */
  pfAccount?: string;
  pfSite?: string;
  /** The bid's Setup notes. */
  pfNotes?: string;
  /**
   * The opportunity "Start a bid" came from (crm_opportunities.id): once the new bid is saved,
   * its id is written on that opportunity (opportunities.functions.ts linkBid).
   */
  opportunity?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseEstimateSearch(s: Record<string, unknown>): EstimateSearch {
  const b = s["bid"];
  const c = s["combine"];
  const str = (k: keyof EstimateSearch) => {
    const v = s[k];
    return typeof v === "string" && v ? { [k]: v } : {};
  };
  const uuid = (k: "pfAccount" | "pfSite" | "opportunity"): string | null => {
    const v = s[k];
    return typeof v === "string" && UUID.test(v) ? v : null;
  };
  const num = (k: "pfW" | "pfL") => {
    const v = Number(s[k]);
    return Number.isFinite(v) && v > 0 ? { [k]: v } : {};
  };
  const account = uuid("pfAccount");
  // A site only means something with its customer.
  const site = account ? uuid("pfSite") : null;
  const opportunity = uuid("opportunity");
  return {
    ...(typeof b === "string" ? { bid: b } : {}),
    // Bid Combiner (docs §22.41): comma-separated ids of the bids to merge into a NEW bid.
    ...(typeof c === "string" && c ? { combine: c } : {}),
    ...str("takeoff"),
    ...str("planswift"),
    // Generic prefill for a NEW bid: the linked building id (bids.building_id), client /
    // job-site fields, one section's width × length, the customer profile and site to link,
    // and the Setup notes.
    ...str("building"),
    ...str("pfName"),
    ...str("pfOwner"),
    ...str("pfAddr"),
    ...str("pfAddr2"),
    ...str("pfCity"),
    ...str("pfState"),
    ...str("pfZip"),
    ...num("pfW"),
    ...num("pfL"),
    ...(account ? { pfAccount: account } : {}),
    ...(site ? { pfSite: site } : {}),
    ...str("pfNotes"),
    ...(opportunity ? { opportunity } : {}),
  };
}
