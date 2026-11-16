/**
 * "New trade bid", the popup on the Trade Bids list (owner, Nov 16: "have a new button trade
 * bids that pops up two options, a dropdown of the existing types of bids (painting etc) or
 * starting a new one.").
 *
 * So it is two choices, kept visibly apart, each with its own button:
 *
 *  1. Bid a trade you already have: pick it by name, then "Start the bid". Nothing is saved
 *     by picking; the bid screen opens blank and saves when the user saves.
 *  2. Set up a new trade: the screen where a kind of job gets its materials, labor and markup.
 *
 * Setting up a trade, or changing one, is an admin's and a manager's job (the server refuses
 * anyone else: trade-bids.functions.ts TRADE_SETUP_IS_MANAGERS). Everyone else still sees the
 * second choice, greyed out with the reason beside it, so an estimator who needs a trade that
 * is not in the list knows whom to ask instead of wondering where the button went.
 *
 * All three ways out go to the one address, /trade-bids, with a different search
 * (lib/trade-bids-search.ts): ?new=<trade> a new bid, ?trade=new a new trade, ?trade=<trade>
 * that trade's setup.
 */
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, PlusCircle } from "lucide-react";

import { seesEveryone } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { listTradeTypes } from "@/lib/trade-bids.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function NewTradeBidDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { session, profile } = useAuth();
  // Admins and managers only, the same rule the server applies when a trade is saved.
  const canSetUp = seesEveryone(profile);

  // Loaded as soon as the list is on screen (not when the popup opens), so the dropdown is
  // usually ready by the time "New trade bid" is clicked. Only with a live session, like the
  // list itself.
  const listFn = useServerFn(listTradeTypes);
  const {
    data: trades,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["trade-types"],
    queryFn: () => listFn(),
    enabled: !!session,
  });

  const [pickedId, setPickedId] = useState("");
  // Looked up in the list each time: a trade deleted since it was picked is no longer picked,
  // so "Start the bid" can never start a bid of a trade that is gone.
  const picked = trades?.find((t) => t.id === pickedId) ?? null;

  const change = (next: boolean) => {
    // Closing forgets the pick: the popup opens the same way every time.
    if (!next) setPickedId("");
    onOpenChange(next);
  };

  const startBid = (tradeId: string) => {
    change(false);
    void navigate({ to: "/trade-bids", search: { new: tradeId } });
  };
  const changeTrade = (tradeId: string) => {
    change(false);
    void navigate({ to: "/trade-bids", search: { trade: tradeId } });
  };
  const setUpNewTrade = () => {
    change(false);
    void navigate({ to: "/trade-bids", search: { trade: "new" } });
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      {/* Scrolls inside itself on a short phone screen instead of running off the bottom. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-new-dialog>
        <DialogHeader>
          <DialogTitle>New trade bid</DialogTitle>
          <DialogDescription>
            Bid a trade you already have, or set up a new trade first.
          </DialogDescription>
        </DialogHeader>

        <section
          className="space-y-3 rounded-lg border p-4"
          aria-labelledby="new-trade-bid-existing"
          data-choice="existing"
        >
          <h3 id="new-trade-bid-existing" className="font-semibold">
            Bid a trade you already have
          </h3>
          {!trades ? (
            error ? (
              <div className="space-y-2" role="alert">
                <p className="text-sm text-muted-foreground">
                  Your trades could not be loaded. Try again.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  {isFetching ? "Trying…" : "Try again"}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading your trades…</p>
            )
          ) : trades.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-no-trades>
              No trades are set up yet.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="new-trade-bid-trade">Trade</Label>
                <Select value={picked?.id ?? ""} onValueChange={setPickedId}>
                  <SelectTrigger id="new-trade-bid-trade" className="w-full" data-pick-trade>
                    <SelectValue placeholder="Pick a trade" />
                  </SelectTrigger>
                  <SelectContent>
                    {trades.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* A bid keeps its own copy of the setup, so changing the trade here changes
                    the bids started after it, never the ones already saved. */}
                {canSetUp && picked && (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto justify-start whitespace-normal p-0 text-left text-sm"
                    onClick={() => changeTrade(picked.id)}
                    data-change-trade
                  >
                    Change how {picked.name} is set up
                  </Button>
                )}
              </div>
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={!picked}
                onClick={() => {
                  if (picked) startBid(picked.id);
                }}
                data-start-bid
              >
                Start the bid
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </>
          )}
        </section>

        {/* A plain "or" between the two, so they read as two choices and not one form. */}
        <div
          className="flex items-center gap-3 text-xs uppercase text-muted-foreground"
          aria-hidden
        >
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <section
          className="space-y-3 rounded-lg border p-4"
          aria-labelledby="new-trade-bid-setup"
          data-choice="new-trade"
        >
          <h3 id="new-trade-bid-setup" className="font-semibold">
            Set up a new trade
          </h3>
          <p className="text-sm text-muted-foreground">
            A trade is a kind of job, such as Painting. You set its materials, labor and markup
            once, then bid it as often as you like.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={!canSetUp}
            onClick={setUpNewTrade}
            data-setup-new-trade
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            Set up a new trade
          </Button>
          {!canSetUp && (
            <p className="text-sm text-muted-foreground" data-setup-not-allowed>
              An admin or a manager sets up a new trade.
            </p>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
