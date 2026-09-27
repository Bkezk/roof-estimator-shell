/**
 * "Link these bids to <customer>?" — offered right after a new customer is created (the
 * Customers page's New customer and the ticket form's quick add), when saved bids that are not
 * linked to anyone look like the new customer (suggestBidsForAccount; owner, Sep 27). All rows
 * start ticked; "Not now" links nothing. The Customers page keeps offering the same bids in its
 * "Bids that look like this customer" strip.
 *
 * The parent mounts <OfferBidLinks account={justCreated} onDone={...} />; its own state (a
 * half-filled ticket) is untouched, the dialog only links bids.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { linkBidToAccount, suggestBidsForAccount, type LinkedBidRow } from "@/lib/crm.functions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const EMPTY: LinkedBidRow[] = [];

/** Refresh everything a bid link changes: the account, the searches, the suggestions, Bids. */
function invalidateBidLinks(qc: ReturnType<typeof useQueryClient>, accountId: string) {
  void qc.invalidateQueries({ queryKey: ["account", accountId] });
  void qc.invalidateQueries({ queryKey: ["unlinked-bids"] });
  void qc.invalidateQueries({ queryKey: ["bid-suggestions"] });
  void qc.invalidateQueries({ queryKey: ["bids"] });
}

export interface OfferAccount {
  id: string;
  name: string;
}

/**
 * Mount once; set `account` to a customer just created. The dialog opens only when that
 * customer has suggestions; `onDone` is called when it closes (linked or "Not now").
 */
export function OfferBidLinks(props: { account: OfferAccount | null; onDone: () => void }) {
  const { session, can } = useAuth();
  const suggestFn = useServerFn(suggestBidsForAccount);
  const account = props.account;
  // Linking a bid needs Estimate access; the server returns nothing without it anyway.
  const enabled = !!session && !!account && can("estimate");
  const suggested = useQuery({
    // Same key as the Customers page's "Bids that look like this customer" strip.
    queryKey: ["bid-suggestions", account?.id ?? ""],
    queryFn: () => suggestFn({ data: { account_id: account!.id } }),
    enabled,
    staleTime: 0,
    // The list must not change under the user while the dialog is open.
    refetchOnWindowFocus: false,
  });
  return (
    <LinkBidsDialog
      account={enabled && suggested.data?.length ? account : null}
      bids={suggested.data ?? EMPTY}
      onClose={props.onDone}
    />
  );
}

export function LinkBidsDialog(props: {
  account: OfferAccount | null;
  bids: LinkedBidRow[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const linkFn = useServerFn(linkBidToAccount);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    setPicked(new Set(props.bids.map((b) => b.id)));
  }, [props.bids]);

  const account = props.account;
  const link = useMutation({
    mutationFn: async () => {
      if (!account) return { ok: 0, failed: [] as string[] };
      let ok = 0;
      const failed: string[] = [];
      for (const b of props.bids) {
        if (!picked.has(b.id)) continue;
        try {
          await linkFn({ data: { bid_id: b.id, account_id: account.id, site_id: null } });
          ok++;
        } catch (e) {
          failed.push(`${b.name}: ${errText(e)}`);
        }
      }
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }) => {
      props.onClose();
      if (account) invalidateBidLinks(qc, account.id);
      if (ok) toast.success(`Linked ${ok} bid${ok === 1 ? "" : "s"} to ${account?.name}`);
      if (failed.length) toast.error(`Could not link ${failed.join("; ")}`);
    },
    onError: (e) => toast.error(`Could not link the bids: ${errText(e)}`),
  });

  return (
    <Dialog
      open={!!account}
      onOpenChange={(o) => {
        if (!o && !link.isPending) props.onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        // Back to where the user was without re-opening a search dropdown under the dialog.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Link these bids to {account?.name}?</DialogTitle>
          <DialogDescription>
            Saved bids that are not linked to a customer and look like this one. Untick any that
            belong to someone else.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 divide-y overflow-auto rounded-md border">
          {props.bids.map((b) => {
            const id = `link-bid-${b.id}`;
            return (
              <label
                key={b.id}
                htmlFor={id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/60"
              >
                <Checkbox
                  id={id}
                  checked={picked.has(b.id)}
                  disabled={link.isPending}
                  onCheckedChange={(c) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (c === true) next.add(b.id);
                      else next.delete(b.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.name}</span>
                <span className="text-xs capitalize text-muted-foreground">{b.status}</span>
                <span className="text-sm tabular-nums">{money(Number(b.grand_total) || 0)}</span>
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={link.isPending}
            onClick={() => props.onClose()}
          >
            Not now
          </Button>
          <Button
            type="button"
            disabled={link.isPending || picked.size === 0}
            onClick={() => link.mutate()}
          >
            {link.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Link selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
