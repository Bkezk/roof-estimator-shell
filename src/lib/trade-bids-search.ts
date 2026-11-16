/**
 * /trade-bids' search params (src/routes/trade-bids.tsx validateSearch). Pure, so the parsing is
 * tested without the route. Owner, Nov 16: "have it similar to project bids, listing the info on
 * the bids then have a new button trade bids that pops up two options, a dropdown of the
 * existing types of bids (painting etc) or starting a new one."
 *
 *   (nothing)           the list of trade bids
 *   ?bid=<bid id>       open that trade bid
 *   ?new=<trade id>     a new bid of that trade (nothing is saved until Save)
 *   ?trade=new          set up a new trade
 *   ?trade=<trade id>   change that trade's setup
 *
 * One at a time: a bid wins over a new bid, which wins over a trade. Junk is the list, never
 * an error page.
 */
import { z } from "zod";

export interface TradeBidsSearch {
  bid?: string;
  new?: string;
  trade?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idParam = z.string().regex(UUID).optional().catch(undefined);
const SEARCH = z.object({
  bid: idParam,
  new: idParam,
  trade: z
    .string()
    .refine((v) => v === "new" || UUID.test(v))
    .optional()
    .catch(undefined),
});

export function parseTradeBidsSearch(s: Record<string, unknown>): TradeBidsSearch {
  const p = SEARCH.parse(s);
  if (p.bid) return { bid: p.bid };
  if (p.new) return { new: p.new };
  if (p.trade) return { trade: p.trade };
  return {};
}

/** Which screen a search opens. */
export type TradeBidsView =
  | { view: "list" }
  | { view: "bid"; bidId: string }
  | { view: "new-bid"; tradeTypeId: string }
  | { view: "trade"; tradeTypeId: string | null };

export function tradeBidsView(s: TradeBidsSearch): TradeBidsView {
  if (s.bid) return { view: "bid", bidId: s.bid };
  if (s.new) return { view: "new-bid", tradeTypeId: s.new };
  if (s.trade) return { view: "trade", tradeTypeId: s.trade === "new" ? null : s.trade };
  return { view: "list" };
}

/** The address of a trade bid, for links built outside the router (notices, the owner page). */
export const tradeBidHref = (bidId: string): string => `/trade-bids?bid=${bidId}`;
