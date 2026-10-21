/**
 * The Owner section (owner, Oct 21: "owner should be its own tab"): a page of its own at /owner,
 * admins only (both admins are the owners; no new setting), with two tabs. People — who is doing
 * what they should be doing (components/owner-view.tsx, the Owner view that lived on Work
 * Overview until today). Business — the money: the tiles (authorized not invoiced, unpaid,
 * invoiced this month, pipeline, purchase orders waiting, won / lost, going stale) and, under
 * them, the margin report (owner, Oct 21: "merge them into business" — "now" above, "over time"
 * below). The tab rides in the URL (?tab=) so a tab can be linked and Back works; People is the
 * default and is not written. Old addresses still land: ?tab=team (the first cut's name for
 * People) and ?tab=margin (the report, now part of Business). Work Overview keeps the List and
 * the Calendar; routes/my-work.tsx sends an old /my-work?view=owner link here.
 */
export const OWNER_TABS = ["people", "business"] as const;
export type OwnerTab = (typeof OWNER_TABS)[number];

/** ?tab= from the URL: people or business; the old names map over; anything else is People. */
export const parseOwnerTab = (v: unknown): OwnerTab =>
  v === "business" || v === "margin" ? "business" : "people";
