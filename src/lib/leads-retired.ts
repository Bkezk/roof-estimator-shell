/**
 * Lead sources JBK no longer wants on the Bid Board (owner, Oct 6: "get rid of Louisville and
 * Nashville, they apparently don't do work there"). The four Louisville and Nashville sources
 * are retired: the board's Source picker leaves them out, the list and its counts exclude their
 * rows, the refresh no longer pulls the two permit feeds, and the nightly browser job neither
 * reads nor accepts the two city bid portals. Their rows stay in the table (nothing is deleted)
 * and their parsers stay in the code, so putting one back is a one-line change here.
 * Chattanooga stays. Pure: no I/O.
 */
export const RETIRED_LEAD_SOURCES = [
  "louisville_permits",
  "louisville_bids",
  "nashville_permits",
  "nashville_bids",
] as const;

export type RetiredLeadSource = (typeof RETIRED_LEAD_SOURCES)[number];

export const isRetiredLeadSource = (source: string): source is RetiredLeadSource =>
  (RETIRED_LEAD_SOURCES as readonly string[]).includes(source);

/** The PostgREST `in` list for `not("source", "in", …)`. */
export const RETIRED_LEAD_SOURCES_IN = `(${RETIRED_LEAD_SOURCES.join(",")})`;
