/**
 * "Link an existing ticket" on an opportunity (owner, Nov 25, 2026; lib/job-steps.ts has the
 * rule, lib/job-link.functions.ts the read and the write).
 *
 * One small line under the chain, and only when there is something to do with it: the customer
 * has an open ticket that belongs to no opportunity, or this opportunity has a ticket linked.
 * It opens one short window: each ticket on a row, with Link or Unlink at its right.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-store";
import { linkOpportunityTicket, listLinkTickets } from "@/lib/job-link.functions";
import { LINK_NONE_TO_LINK, LINK_TICKET_BUTTON, LINK_TICKET_LEAD } from "@/lib/job-steps";

export function LinkTicket({ opportunityId }: { opportunityId: string }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const listFn = useServerFn(listLinkTickets);
  const linkFn = useServerFn(linkOpportunityTicket);
  const key = ["opportunity-link-tickets", opportunityId] as const;
  const rows = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { id: opportunityId } }),
    enabled: !!session,
    staleTime: 30_000,
    retry: false,
  });
  const press = useMutation({
    mutationFn: (v: { ticketId: string; link: boolean }) =>
      linkFn({ data: { opportunityId, ticketId: v.ticketId, link: v.link } }),
    onSuccess: (out) => {
      toast.success(out.message);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["opportunity-tickets", opportunityId] });
      void qc.invalidateQueries({ queryKey: ["work-chain"] });
      void qc.invalidateQueries({ queryKey: ["opportunities"] });
      void qc.invalidateQueries({ queryKey: ["opportunity", opportunityId] });
      void qc.invalidateQueries({ queryKey: ["opportunity-events", opportunityId] });
      void qc.invalidateQueries({ queryKey: ["followups"] });
      void qc.invalidateQueries({ queryKey: ["my-work"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e), { duration: 12_000 }),
  });
  const list = rows.data ?? [];
  // Nothing to link and nothing linked: no line at all.
  if (!list.length) return null;
  const free = list.filter((r) => !r.linked);
  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        data-action="link-ticket"
        onClick={() => setOpen(true)}
      >
        <Link2 className="h-4 w-4" aria-hidden /> {LINK_TICKET_BUTTON}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-dialog="link-ticket">
          <DialogHeader>
            <DialogTitle>{LINK_TICKET_BUTTON}</DialogTitle>
            <DialogDescription>{LINK_TICKET_LEAD}</DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-md border">
            {list.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                data-link-row={r.linked ? "linked" : "free"}
              >
                <span className="min-w-0 flex-1 break-words">
                  <span className="font-medium">{r.label}</span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {r.day}
                    {r.place ? ` · ${r.place}` : ""}
                    {r.linked ? " · Linked" : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant={r.linked ? "outline" : "default"}
                  disabled={press.isPending}
                  onClick={() => press.mutate({ ticketId: r.id, link: !r.linked })}
                >
                  {r.linked ? "Unlink" : "Link"}
                </Button>
              </li>
            ))}
          </ul>
          {!free.length && <p className="text-sm text-muted-foreground">{LINK_NONE_TO_LINK}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
