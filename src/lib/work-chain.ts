/**
 * The chain line (owner, Nov 13: "show the whole chain"): one line on the opportunity, on its
 * inspection ticket, on the repair ticket and on the bid that says where the work came from and
 * what came of it —
 *
 *   Opportunity: Leak at the dock (Quoted) › Inspection #6041 (Done) › Bid: Dock re-roof (Submitted)
 *
 * Each part links to its record; the one being looked at is bold and not a link. The words in
 * brackets are the ones the pages already use (an opportunity's status, a ticket's stage, a bid's
 * status). Records at the same step stand side by side.
 *
 * The steps: the opportunity; then what was started straight from it (tickets with
 * from_opportunity_id, bids with opportunity_id); then what was made from one of those tickets
 * (from_job_id: a repair ticket or a bid made from an inspection). A record made from a ticket
 * stands after that ticket even though it carries the opportunity too.
 *
 * What the caller may not read is simply not in the input (the server reads under the caller's own
 * rights, work-chain.functions.ts): a technician gets the tickets and neither the opportunity nor
 * the bid; whatever hung under a part that is missing moves up a step. A deleted record with
 * something live after it stays, marked "deleted" and without a link, so the line does not break in
 * the middle; a deleted record at the end is left out. A chain of one part is no chain: nothing is
 * shown. No amount is ever part of it.
 *
 * Pure: no database, no React (unit tested in work-chain-nov13.test.ts).
 */
import { STATUS_LABELS as BID_STATUS_LABELS, type BidStatus } from "@/lib/bid-status";
import { OPP_STATUS_LABELS, type OppStatus } from "@/lib/opportunities.functions";
import { STAGE_LABELS, type ServiceStage } from "@/lib/service.functions";

export type ChainKind = "opportunity" | "ticket" | "bid";

export interface ChainOpportunity {
  id: string;
  title: string;
  status: string;
  deleted: boolean;
}
export interface ChainTicket {
  id: string;
  number: number;
  service_type: string;
  stage: string;
  deleted: boolean;
  from_opportunity_id: string | null;
  from_job_id: string | null;
}
export interface ChainBid {
  id: string;
  name: string;
  status: string;
  deleted: boolean;
  opportunity_id: string | null;
  from_job_id: string | null;
}
/** Everything the caller could read around one record. */
export interface ChainInput {
  opportunity: ChainOpportunity | null;
  tickets: readonly ChainTicket[];
  bids: readonly ChainBid[];
}

export interface ChainPart {
  kind: ChainKind;
  id: string;
  /** "Opportunity: Leak at the dock", "Inspection #6041", "Bid: Dock re-roof". */
  label: string;
  /** "Quoted", "Done", "Submitted"; "deleted" for a deleted record kept in the middle. */
  status: string;
  /** The record being looked at: bold, no link. */
  current: boolean;
  /** Deleted: no link. */
  deleted: boolean;
}
/** The records at one step, side by side. */
export type ChainStep = ChainPart[];

export const CHAIN_DELETED = "deleted";

/** "Inspection #6041", "Repair ticket #6042", "Warranty ticket #6043", "Ticket #6044". */
export function chainTicketLabel(t: Pick<ChainTicket, "number" | "service_type">): string {
  if (t.service_type === "inspection") return `Inspection #${t.number}`;
  if (t.service_type === "repair") return `Repair ticket #${t.number}`;
  if (t.service_type === "warranty") return `Warranty ticket #${t.number}`;
  return `Ticket #${t.number}`;
}

const oppPart = (o: ChainOpportunity): Omit<ChainPart, "current"> => ({
  kind: "opportunity",
  id: o.id,
  label: `Opportunity: ${o.title.trim() || "Untitled"}`,
  status: o.deleted ? CHAIN_DELETED : (OPP_STATUS_LABELS[o.status as OppStatus] ?? o.status),
  deleted: o.deleted,
});
const ticketPart = (t: ChainTicket): Omit<ChainPart, "current"> => ({
  kind: "ticket",
  id: t.id,
  label: chainTicketLabel(t),
  status: t.deleted ? CHAIN_DELETED : (STAGE_LABELS[t.stage as ServiceStage] ?? t.stage),
  deleted: t.deleted,
});
const bidPart = (b: ChainBid): Omit<ChainPart, "current"> => ({
  kind: "bid",
  id: b.id,
  label: `Bid: ${b.name.trim() || "Untitled"}`,
  status: b.deleted ? CHAIN_DELETED : (BID_STATUS_LABELS[b.status as BidStatus] ?? b.status),
  deleted: b.deleted,
});

/** A ticket can only be so many steps from the top; a loop in the data stops here. */
const MAX_TICKET_STEPS = 4;

/**
 * The chain's steps, first to last; [] when there are fewer than two parts to show. `current`
 * is the record the line is drawn on.
 */
export function buildChain(
  input: ChainInput,
  current: { kind: ChainKind; id: string },
): ChainStep[] {
  const isCurrent = (kind: ChainKind, id: string) => current.kind === kind && current.id === id;
  const tickets = [...new Map(input.tickets.map((t) => [t.id, t])).values()];
  const bids = [...new Map(input.bids.map((b) => [b.id, b])).values()];
  const ticketIds = new Set(tickets.map((t) => t.id));

  // Which step each ticket stands at: 0 = started from the opportunity (or the top of a chain
  // with no opportunity), then one more for each ticket it was made from. A ticket whose parent
  // is not in the input (unreadable) stands at the top.
  const depth = new Map<string, number>();
  const depthOf = (t: ChainTicket, seen: Set<string> = new Set()): number => {
    const known = depth.get(t.id);
    if (known !== undefined) return known;
    let d = 0;
    if (t.from_job_id && ticketIds.has(t.from_job_id) && !seen.has(t.id)) {
      const parent = tickets.find((x) => x.id === t.from_job_id)!;
      d = Math.min(depthOf(parent, new Set(seen).add(t.id)) + 1, MAX_TICKET_STEPS);
    }
    depth.set(t.id, d);
    return d;
  };
  for (const t of tickets) depthOf(t);
  const bidDepth = (b: ChainBid) =>
    b.from_job_id && ticketIds.has(b.from_job_id) ? depth.get(b.from_job_id)! + 1 : 0;

  // Does anything live stand after this ticket? (A deleted ticket is kept only then.)
  const hasLiveAfter = (id: string, seen: Set<string> = new Set()): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    return (
      bids.some((b) => b.from_job_id === id && !b.deleted) ||
      tickets.some((t) => t.from_job_id === id && (!t.deleted || hasLiveAfter(t.id, seen)))
    );
  };
  const keptTickets = tickets.filter(
    (t) => !t.deleted || isCurrent("ticket", t.id) || hasLiveAfter(t.id),
  );
  const keptBids = bids.filter((b) => !b.deleted || isCurrent("bid", b.id));

  const steps: ChainStep[] = [];
  const opp = input.opportunity;
  const anythingLiveAfterOpp =
    keptTickets.some((t) => !t.deleted) || keptBids.some((b) => !b.deleted);
  if (opp && (!opp.deleted || isCurrent("opportunity", opp.id) || anythingLiveAfterOpp))
    steps.push([{ ...oppPart(opp), current: isCurrent("opportunity", opp.id) }]);

  const last = Math.max(-1, ...keptTickets.map((t) => depth.get(t.id)!), ...keptBids.map(bidDepth));
  for (let d = 0; d <= last; d++) {
    const step: ChainStep = [
      ...keptTickets
        .filter((t) => depth.get(t.id) === d)
        .sort((a, b) => a.number - b.number)
        .map((t) => ({ ...ticketPart(t), current: isCurrent("ticket", t.id) })),
      ...keptBids
        .filter((b) => bidDepth(b) === d)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({ ...bidPart(b), current: isCurrent("bid", b.id) })),
    ];
    if (step.length) steps.push(step);
  }
  const parts = steps.reduce((n, s) => n + s.length, 0);
  return parts >= 2 ? steps : [];
}

/** The line as plain text (the tests, and the line's accessible label). */
export function chainText(steps: readonly ChainStep[]): string {
  return steps.map((s) => s.map((p) => `${p.label} (${p.status})`).join(" · ")).join(" › ");
}
