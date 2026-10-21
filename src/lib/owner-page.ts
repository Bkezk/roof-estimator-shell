/**
 * The Owner section (owner, Oct 21: "owner should be its own tab"): a page of its own at /owner,
 * admins only (both admins are the owners; no new setting), with two tabs — Team, the Owner view
 * that lived on Work Overview until today (components/owner-view.tsx, moved as it was), and
 * Margin, the margin report. The tab rides in the URL (?tab=) so a tab can be linked and Back
 * works; Team is the default and is not written. Work Overview keeps the List and the Calendar;
 * routes/my-work.tsx sends an old /my-work?view=owner link here.
 */
export const OWNER_TABS = ["team", "margin"] as const;
export type OwnerTab = (typeof OWNER_TABS)[number];

/** ?tab= from the URL: one of the two tabs; anything else, or nothing, is Team. */
export const parseOwnerTab = (v: unknown): OwnerTab =>
  v === "margin" || v === "team" ? v : "team";
