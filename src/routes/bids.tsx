import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlusCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteBid, listBids } from "@/lib/bids.functions";
import { useAuth } from "@/lib/auth-context";
import { BID_STATUSES, STATUS_LABELS, STATUS_BADGE_CLASSES, asBidStatus } from "@/lib/bid-status";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  const { session } = useAuth();
  // Only fetch with a live session — otherwise the server fn 401s (e.g. a mobile browser whose
  // token expired while backgrounded); AuthGate handles the redirect to /login.
  const {
    data: bids,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["bids"],
    queryFn: listBidsFn,
    enabled: !!session,
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const qc = useQueryClient();
  const deleteBidFn = useServerFn(deleteBid);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => deleteBidFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Bid deleted");
      void qc.invalidateQueries({ queryKey: ["bids"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
    onSettled: () => setConfirmDelete(null),
  });

  if (error) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn't load bids ({error instanceof Error ? error.message : "unknown error"}). Try
        refreshing, or sign in again.
      </p>
    );
  }
  if (isLoading || !bids) {
    return <p className="text-sm text-muted-foreground">Loading bids…</p>;
  }

  const filtered =
    statusFilter === "all" ? bids : bids.filter((b) => asBidStatus(b.status) === statusFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4"
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
                  {/* Stored at save time — the estimator recomputes live, so an engine change
                      (or an empty-data row) can differ from this until the bid is re-saved. */}
                  <span
                    className="text-sm font-semibold tabular-nums"
                    title="Total as of the last save — open the bid for the live figure"
                  >
                    {money(Number(bid.grand_total ?? 0))}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      (last saved)
                    </span>
                  </span>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/estimate" search={{ bid: bid.id }}>
                      Open
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    title="Delete this bid"
                    disabled={del.isPending}
                    onClick={() => setConfirmDelete({ id: bid.id, name: bid.name })}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open && !del.isPending) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this bid?</AlertDialogTitle>
            <AlertDialogDescription>
              “{confirmDelete?.name}” and everything saved in it will be permanently removed. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={del.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) del.mutate(confirmDelete.id);
              }}
            >
              {del.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
