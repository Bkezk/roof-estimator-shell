/**
 * Which kind of bid a row of `bids` is, and where it opens (owner, Nov 16: trade bids, "I don't
 * want that list combined with project bids, but I do want the statuses, owners page, needs
 * attention, and margin report to accurately reflect the trade bids").
 *
 * A roofing bid opens in the estimator, a trade bid on Trade Bids. Everything that lists bids of
 * both kinds (the owner page, Needs attention, Work Overview, the search box, a customer's page,
 * the Margin report, the due and reminder notices) builds its link here, so a trade bid is
 * never opened in the roofing estimator, which cannot read it.
 *
 * `kind` comes from the row (bids.kind, 20261116200000). Anything that is not "trade", a row
 * read before the column existed included, is a roofing bid.
 */
export type BidKind = "roof" | "trade";

export const asBidKind = (v: unknown): BidKind => (v === "trade" ? "trade" : "roof");

export const isTradeBid = (b: { kind?: string | null | undefined }): boolean =>
  asBidKind(b.kind) === "trade";

/** The address of a bid as text, for notices and rows whose link is a plain string. */
export const bidHref = (b: { id: string; kind?: string | null | undefined }): string =>
  isTradeBid(b) ? `/trade-bids?bid=${b.id}` : `/estimate?bid=${b.id}`;

/** The same address for the router's <Link> and navigate(). */
export function bidLink(b: { id: string; kind?: string | null | undefined }) {
  return isTradeBid(b)
    ? ({ to: "/trade-bids", search: { bid: b.id } } as const)
    : ({ to: "/estimate", search: { bid: b.id } } as const);
}

/** What a list calls the bid: "Trade Bid" / "Project Bid". */
export const bidKindLabel = (kind: string | null | undefined): string =>
  asBidKind(kind) === "trade" ? "Trade Bid" : "Project Bid";

/** "Open the estimator" for a roofing bid; a trade bid has no estimator: "Open the bid". */
export const bidOpenWords = (kind: string | null | undefined): string =>
  asBidKind(kind) === "trade" ? "Open the bid" : "Open the estimator";
