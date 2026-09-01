import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlusCircle } from "lucide-react";

import { listBids } from "@/lib/bids.functions";
import { BID_STATUSES, STATUS_LABELS, STATUS_BADGE_CLASSES, asBidStatus } from "@/lib/bid-status";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const Route = createFileRoute("/bids")({
  head: () => ({
    meta: [
      { title: "Saved Bids — Bid-O-Matic" },
      {
        name: "description",
        content: "View and manage saved Duro-Last roofing estimates.",
      },
      {
        property: "og:title",
        content: "Saved Bids — Bid-O-Matic",
      },
      {
        property: "og:description",
        content: "View and manage saved Duro-Last roofing estimates.",
      },
    ],
  }),
  // No route loader: it would run during SSR before the browser can attach the
  // auth token, and listBids requires a signed-in user. Fetch client-side only.
  component: BidsPage,
});

function BidsPage() {
  const listBidsFn = useServerFn(listBids);
  const { data: bids, isLoading } = useQuery({
    queryKey: ["bids"],
    queryFn: listBidsFn,
  });
  const [statusFilter, setStatusFilter] = useState("all");

  if (isLoading || !bids) {
    return <p className="text-sm text-muted-foreground">Loading bids…</p>;
  }

  const filtered =
    statusFilter === "all" ? bids : bids.filter((b) => asBidStatus(b.status) === statusFilter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Saved Bids</h1>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {BID_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild>
            <Link to="/estimate">
              <PlusCircle className="mr-2 h-4 w-4" />
              New Bid
            </Link>
          </Button>
        </div>
      </div>

      {bids.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">No bids yet.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/estimate">Create your first bid</Link>
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            No bids with status “{STATUS_LABELS[asBidStatus(statusFilter)]}”.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((bid) => {
            const st = asBidStatus(bid.status);
            return (
              <div
                key={bid.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{bid.name}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[st]}`}
                    >
                      {STATUS_LABELS[st]}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Updated {new Date(bid.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-semibold tabular-nums">
                    {money(Number(bid.grand_total ?? 0))}
                  </span>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/estimate" search={{ bid: bid.id }}>
                      Open
                    </Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
