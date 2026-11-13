/**
 * The chain line's read (owner, Nov 13; lib/work-chain.ts draws it): from an opportunity, a
 * ticket or a bid, everything around it — the opportunity, the tickets started from it, the
 * tickets and bids made from those tickets. Every row is read with the caller's own client, so
 * each table's own rule decides what comes back: a technician gets their tickets and neither the
 * opportunity nor the bid; an estimator without Service access gets the opportunity and the bid
 * and not the tickets. Nothing is read with the server's rights, and no amount is selected.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import {
  buildChain,
  type ChainBid,
  type ChainInput,
  type ChainOpportunity,
  type ChainStep,
  type ChainTicket,
} from "@/lib/work-chain";

const TICKET_COLS = "id, number, service_type, stage, deleted_at, from_opportunity_id, from_job_id";
const BID_COLS = "id, name, status, deleted_at, opportunity_id, from_job_id";
type TicketRow = {
  id: string;
  number: number;
  service_type: string;
  stage: string;
  deleted_at: string | null;
  from_opportunity_id: string | null;
  from_job_id: string | null;
};
type BidRow = {
  id: string;
  name: string;
  status: string;
  deleted_at: string | null;
  opportunity_id: string | null;
  from_job_id: string | null;
};
const asTicket = (r: TicketRow): ChainTicket => ({
  id: r.id,
  number: r.number,
  service_type: r.service_type,
  stage: r.stage,
  deleted: !!r.deleted_at,
  from_opportunity_id: r.from_opportunity_id,
  from_job_id: r.from_job_id,
});
const asBid = (r: BidRow): ChainBid => ({
  id: r.id,
  name: r.name,
  status: r.status,
  deleted: !!r.deleted_at,
  opportunity_id: r.opportunity_id,
  from_job_id: r.from_job_id,
});

/** How many "made from" steps are followed up and down (inspection → repair is one). */
const STEPS = 3;
const ROWS = 50;

/**
 * Read what the caller may read around one record. Exported for the tests (a fake client); the
 * pages call getWorkChain.
 */
export async function readChain(
  sb: SupabaseClient<Database>,
  start: { kind: "opportunity" | "ticket" | "bid"; id: string },
): Promise<ChainInput> {
  const tickets = new Map<string, ChainTicket>();
  const bids = new Map<string, ChainBid>();
  // Found on the way up (an object: the helpers below write to it).
  const found: { oppId: string | null; topTicketId: string | null } = {
    oppId: start.kind === "opportunity" ? start.id : null,
    topTicketId: null,
  };

  const ticketById = async (id: string): Promise<ChainTicket | null> => {
    const { data, error } = await sb
      .from("service_jobs")
      .select(TICKET_COLS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const t = asTicket(data);
    tickets.set(t.id, t);
    return t;
  };
  // Up from a ticket to the first one of its chain; the opportunity is whichever of them names one.
  const climb = async (id: string) => {
    let at: string | null = id;
    for (let i = 0; at && i <= STEPS; i++) {
      const t = await ticketById(at);
      if (!t) break;
      found.topTicketId = t.id;
      found.oppId = found.oppId ?? t.from_opportunity_id;
      at = t.from_job_id;
    }
  };

  if (start.kind === "ticket") await climb(start.id);
  if (start.kind === "bid") {
    const { data, error } = await sb.from("bids").select(BID_COLS).eq("id", start.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { opportunity: null, tickets: [], bids: [] };
    const b = asBid(data);
    bids.set(b.id, b);
    found.oppId = b.opportunity_id;
    if (b.from_job_id) await climb(b.from_job_id);
    if (!found.oppId) {
      // A link written on the opportunity's side only (crm_opportunities.bid_id).
      const { data: o } = await sb
        .from("crm_opportunities")
        .select("id")
        .eq("bid_id", b.id)
        .limit(1)
        .maybeSingle();
      found.oppId = o?.id ?? null;
    }
  }
  const { oppId, topTicketId } = found;

  let opportunity: ChainOpportunity | null = null;
  let oppBidId: string | null = null;
  if (oppId) {
    const { data, error } = await sb
      .from("crm_opportunities")
      .select("id, title, status, deleted_at, bid_id")
      .eq("id", oppId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      opportunity = {
        id: data.id,
        title: data.title,
        status: data.status,
        deleted: !!data.deleted_at,
      };
      oppBidId = data.bid_id;
    }
    // The tickets started from it (and, since Nov 13, the repair tickets made from those).
    const { data: rows, error: tErr } = await sb
      .from("service_jobs")
      .select(TICKET_COLS)
      .eq("from_opportunity_id", oppId)
      .order("number", { ascending: true })
      .limit(ROWS);
    if (tErr) throw new Error(tErr.message);
    for (const r of rows ?? []) tickets.set(r.id, asTicket(r));
  }

  // Down: the tickets made from the ones in hand, step by step.
  let frontier = [...tickets.keys()];
  if (topTicketId && !frontier.includes(topTicketId)) frontier.push(topTicketId);
  for (let i = 0; frontier.length && i < STEPS; i++) {
    const { data: rows, error } = await sb
      .from("service_jobs")
      .select(TICKET_COLS)
      .in("from_job_id", frontier)
      .order("number", { ascending: true })
      .limit(ROWS);
    if (error) throw new Error(error.message);
    frontier = [];
    for (const r of rows ?? []) {
      if (tickets.has(r.id)) continue;
      tickets.set(r.id, asTicket(r));
      frontier.push(r.id);
    }
  }

  // The bids: started from the opportunity, named by it, or made from one of the tickets.
  const bidReads: PromiseLike<{ data: BidRow[] | null; error: { message: string } | null }>[] = [];
  if (oppId)
    bidReads.push(sb.from("bids").select(BID_COLS).eq("opportunity_id", oppId).limit(ROWS));
  if (oppBidId && !bids.has(oppBidId))
    bidReads.push(sb.from("bids").select(BID_COLS).eq("id", oppBidId).limit(1));
  if (tickets.size)
    bidReads.push(
      sb
        .from("bids")
        .select(BID_COLS)
        .in("from_job_id", [...tickets.keys()])
        .limit(ROWS),
    );
  for (const r of await Promise.all(bidReads)) {
    if (r.error) throw new Error(r.error.message);
    for (const b of r.data ?? []) bids.set(b.id, asBid(b));
  }
  return { opportunity, tickets: [...tickets.values()], bids: [...bids.values()] };
}

export const getWorkChain = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ kind: z.enum(["opportunity", "ticket", "bid"]), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ChainStep[]> => {
    const input = await readChain(context.supabase, data);
    return buildChain(input, data);
  });
