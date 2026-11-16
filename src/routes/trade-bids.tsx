import { createFileRoute } from "@tanstack/react-router";

import { TradeBidScreen } from "@/components/trade/trade-bid-screen";
import { TradeBidsList } from "@/components/trade/trade-bids-list";
import { TradeSetupScreen } from "@/components/trade/trade-setup-screen";
import { parseTradeBidsSearch, tradeBidsView } from "@/lib/trade-bids-search";

export const Route = createFileRoute("/trade-bids")({
  head: () => ({ meta: [{ title: "Trade Bids — JBK Portal" }] }),
  // Trade Bids (owner, Nov 16: bids for work that is not roofing — painting, siding — each from
  // a job type set up once). One address, four screens (lib/trade-bids-search.ts): the list, a
  // bid, a new bid of a trade, a trade's setup. Access is the central gate's (pageForPath:
  // /trade-bids → Estimate, the rule on the bids themselves); the setup screen turns away
  // anyone who is not an admin or a manager, as the server does.
  validateSearch: parseTradeBidsSearch,
  component: TradeBidsRoute,
});

function TradeBidsRoute() {
  const view = tradeBidsView(Route.useSearch());
  // A key per bid / trade: opening another one starts the screen afresh, with nothing typed
  // carried over from the one before.
  if (view.view === "bid") return <TradeBidScreen key={view.bidId} bidId={view.bidId} />;
  if (view.view === "new-bid")
    return <TradeBidScreen key={`new-${view.tradeTypeId}`} tradeTypeId={view.tradeTypeId} />;
  if (view.view === "trade")
    return (
      <TradeSetupScreen
        key={view.tradeTypeId ?? "new"}
        {...(view.tradeTypeId ? { tradeTypeId: view.tradeTypeId } : {})}
      />
    );
  return <TradeBidsList />;
}
