import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlusCircle } from "lucide-react";

import { listBids } from "@/lib/bids.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/bids")({
  head: () => ({
    meta: [
      { title: "Saved Bids — Duro-Last Estimator" },
      {
        name: "description",
        content: "View and manage saved Duro-Last roofing estimates.",
      },
      {
        property: "og:title",
        content: "Saved Bids — Duro-Last Estimator",
      },
      {
        property: "og:description",
        content: "View and manage saved Duro-Last roofing estimates.",
      },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ["bids"],
      queryFn: listBids,
    });
  },
  component: BidsPage,
});

function BidsPage() {
  const listBidsFn = useServerFn(listBids);
  const { data: bids } = useSuspenseQuery({
    queryKey: ["bids"],
    queryFn: listBidsFn,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Saved Bids</h1>
        <Button asChild>
          <Link to="/new-bid">
            <PlusCircle className="mr-2 h-4 w-4" />
            New Bid
          </Link>
        </Button>
      </div>

      {bids.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">No bids yet.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/new-bid">Create your first bid</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {bids.map((bid) => (
            <div
              key={bid.id}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div>
                <p className="font-medium">{bid.name}</p>
                <p className="text-sm text-muted-foreground capitalize">
                  {bid.status} •{" "}
                  {new Date(bid.updated_at).toLocaleDateString()}
                </p>
              </div>
              <Button variant="ghost" size="sm" disabled>
                Open
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
