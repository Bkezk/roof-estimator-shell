/**
 * A ticket moved its opportunity: say it out loud (owner, Nov 13) — "Opportunity “Leak at the
 * dock” is now Won", with Open for the people who can open it — and refresh what the pages hold
 * about that opportunity (its row, its status log, the lists, the chain line, the reminders). When
 * the ticket was saved but the opportunity could not be moved, that is said too, as an error.
 */
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { OpportunityMoved } from "@/lib/opportunities.functions";
import { opportunityMoveText } from "@/lib/ticket-moves";

export function refreshOpportunity(qc: QueryClient, id: string) {
  void qc.invalidateQueries({ queryKey: ["opportunities"] });
  void qc.invalidateQueries({ queryKey: ["opportunity", id] });
  void qc.invalidateQueries({ queryKey: ["opportunity-events", id] });
  void qc.invalidateQueries({ queryKey: ["work-chain"] });
  void qc.invalidateQueries({ queryKey: ["followups"] });
}

export function sayOpportunityMove(
  res: OpportunityMoved,
  o: {
    qc: QueryClient;
    /** Opens the opportunity; left out for someone who cannot read opportunities. */
    open?: ((id: string) => void) | undefined;
    /** What was saved, for the error: "Ticket #6071 was created". */
    saved: string;
  },
) {
  const move = res.opportunity_move;
  if (move) {
    refreshOpportunity(o.qc, move.opportunity_id);
    const open = o.open;
    toast.success(opportunityMoveText(move), {
      duration: 10_000,
      ...(open ? { action: { label: "Open", onClick: () => open(move.opportunity_id) } } : {}),
    });
  }
  if (res.opportunity_move_error)
    toast.error(
      `${o.saved}, but its opportunity's status did not change: ${res.opportunity_move_error}`,
      { duration: 15_000 },
    );
}
