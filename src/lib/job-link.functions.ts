/**
 * Link an existing ticket to an opportunity (owner, Nov 25, 2026; job-steps.ts has the rule).
 *
 * "Start a ticket" on an opportunity links the ticket by itself. A ticket made on its own, for
 * the same customer, is not part of the opportunity's job until somebody links it here: once it
 * is, the opportunity waits on it and is not overdue while somebody has it.
 *
 * Everything is read and written with the caller's own client, so each table's own rule decides:
 * the caller must be able to read the opportunity and to change the ticket. Only the people who
 * create tickets may link one (access.ts dispatchesTickets), the same people who see Start a
 * ticket. A linked ticket moves its opportunity by the rule a started one follows (an inspection
 * makes an Open one Contacted, a repair makes it Won): the answer says so out loud.
 *
 * Nov 26, 2026 (the audit's 21):
 *   - a link that would mark the opportunity Won is asked first (`confirmed`): the window
 *     asks, and the server refuses to do it unasked, whatever the screen sent;
 *   - an opportunity that came from a public Roof Care request is never marked Won by a link
 *     (it turns Won when its plan is paid). The link is still made;
 *   - Unlink puts the opportunity's status back when that link was what moved it and nothing
 *     has moved it since, reopens its follow-up, and says what happened either way.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import { dispatchesTickets } from "@/lib/access";
import {
  LINK_CARE_NOT_WON,
  LINK_CLOSED,
  LINK_NOT_ALLOWED,
  LINK_NOT_HERE,
  LINK_WON_NOT_CHECKED,
  linkProblem,
  linkRows,
  linkWinsAsk,
  linkWouldWin,
  linkedWords,
  ticketStepLabel,
  unlinkNotChecked,
  unlinkedWords,
  type LinkTicketIn,
  type LinkTicketRow,
} from "@/lib/job-steps";

const COLS =
  "id, number, service_type, stage, scheduled_date, account_id, from_opportunity_id, from_job_id, deleted_at, site_name";
const CLOSED = ["won", "lost", "no_response"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the link window shows: the rows, and whether a link can ever mark this one Won. */
export interface LinkTicketList {
  rows: LinkTicketRow[];
  /** The opportunity came from a Roof Care request: a link never marks it Won. */
  care: boolean;
}

/** The tickets this opportunity can link, and the ones it already has. */
export const listLinkTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<LinkTicketList> => {
    const sb = context.supabase;
    const { data: opp, error: oErr } = await sb
      .from("crm_opportunities")
      .select("id, account_id, status, deleted_at")
      .eq("id", data.id)
      .maybeSingle();
    if (oErr) throw new Error(oErr.message);
    if (!opp || opp.deleted_at) return { rows: [], care: false };
    const [mine, open] = await Promise.all([
      sb
        .from("service_jobs")
        .select(COLS)
        .eq("from_opportunity_id", opp.id)
        .is("deleted_at", null)
        .limit(50),
      opp.account_id
        ? sb
            .from("service_jobs")
            .select(COLS)
            .eq("account_id", opp.account_id)
            .is("deleted_at", null)
            .in("stage", ["open", "scheduled"])
            .order("number", { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [] as LinkTicketIn[], error: null }),
    ]);
    if (mine.error) throw new Error(mine.error.message);
    if (open.error) throw new Error(open.error.message);
    const all = new Map<string, LinkTicketIn>();
    for (const t of [...(mine.data ?? []), ...(open.data ?? [])]) all.set(t.id, t as LinkTicketIn);
    // Asked only when a row could mark it Won. When it cannot be asked (null) the rows ask
    // nothing: the press itself asks again, moves nothing, and says so.
    const mayWin = [...all.values()].some(
      (t) => t.from_opportunity_id !== opp.id && linkWouldWin(t.service_type, opp),
    );
    const { opportunityFromCareRequest } = await import("@/lib/opportunities.functions");
    const care = mayWin ? await opportunityFromCareRequest(context, opp.id) : false;
    return { rows: linkRows({ ...opp, care: care !== false }, [...all.values()]), care: !!care };
  });

/** Link one ticket to the opportunity, or take it off again. */
export const linkOpportunityTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        opportunityId: z.string().uuid(),
        ticketId: z.string().uuid(),
        link: z.boolean(),
        /** The person was asked, and said yes, to a link that marks the opportunity Won. */
        confirmed: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<LinkAnswer> => {
    const sb = context.supabase;
    const { data: prof } = await sb
      .from("profiles")
      .select("role, access, technician, full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    if (!dispatchesTickets(prof ?? null)) throw new Error(LINK_NOT_ALLOWED);
    const who = (prof?.full_name ?? "").trim() || (prof?.email ?? "").trim() || null;

    const [{ data: opp, error: oErr }, { data: ticket, error: tErr }] = await Promise.all([
      sb
        .from("crm_opportunities")
        .select("id, title, status, account_id, deleted_at")
        .eq("id", data.opportunityId)
        .maybeSingle(),
      sb.from("service_jobs").select(COLS).eq("id", data.ticketId).maybeSingle(),
    ]);
    if (oErr) throw new Error(oErr.message);
    if (tErr) throw new Error(tErr.message);
    if (!opp) throw new Error("Opportunity not found");
    if (!ticket) throw new Error("Ticket not found");
    const t = ticket as LinkTicketIn;
    const label = cap(ticketStepLabel(t));

    if (!data.link) {
      if (t.from_opportunity_id !== opp.id) throw new Error(LINK_NOT_HERE);
      const { data: done, error } = await sb
        .from("service_jobs")
        .update({ from_opportunity_id: null, updated_by_name: who })
        .eq("id", t.id)
        .eq("from_opportunity_id", opp.id)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!done) throw new Error("That ticket is not yours to change. Nothing was changed.");
      await logLink(sb, t.id, `No longer linked to the opportunity "${opp.title}".`, {
        id: context.userId,
        name: who,
      });
      // The opportunity goes back to where it stood when this link was what moved it and
      // nothing has moved it since. Never thrown: the link is off either way.
      const { undoOpportunityFromTicket, OPP_STATUS_LABELS } =
        await import("@/lib/opportunities.functions");
      const undone = await undoOpportunityFromTicket(context, t.id, opp.id);
      const said = (status: string) =>
        (OPP_STATUS_LABELS as Record<string, string>)[status] ?? status;
      // "Still Won" is said when the ticket had moved it, or it is closed: the person would
      // otherwise think Unlink reopened it.
      const still =
        undone.left && (undone.left.byTicket || CLOSED.includes(undone.left.status))
          ? said(undone.left.status)
          : null;
      return {
        message:
          unlinkedWords(label, { back: undone.back ? said(undone.back.to) : null, still }) +
          (undone.error ? ` ${unlinkNotChecked(undone.error)}` : ""),
        moved: !!undone.back,
      };
    }

    if (opp.deleted_at || CLOSED.includes(opp.status)) throw new Error(LINK_CLOSED);
    let parentOpp: string | null = null;
    if (t.from_job_id) {
      const { data: parent } = await sb
        .from("service_jobs")
        .select("from_opportunity_id")
        .eq("id", t.from_job_id)
        .maybeSingle();
      parentOpp = parent?.from_opportunity_id ?? null;
    }
    const problem = linkProblem(opp, t, parentOpp);
    if (problem) throw new Error(problem);
    if (t.from_opportunity_id === opp.id) return { message: linkedWords(label), moved: false };
    const { movedByTicket, opportunityFromCareRequest, OPP_STATUS_LABELS } =
      await import("@/lib/opportunities.functions");
    // Would this link mark the opportunity Won? Then it is from a Roof Care request or not:
    // such a one is not moved (null, not known: not moved either), and any other is asked
    // first. Nothing is written until the answer is yes.
    const wouldWin = linkWouldWin(t.service_type, opp);
    const care = wouldWin ? await opportunityFromCareRequest(context, opp.id) : false;
    if (wouldWin && care === false && !data.confirmed)
      return { message: linkWinsAsk(t.service_type), moved: false, ask: true };
    // Only a ticket that still belongs to no opportunity is taken: two people pressing at once
    // cannot both link it.
    const { data: done, error } = await sb
      .from("service_jobs")
      .update({ from_opportunity_id: opp.id, updated_by_name: who })
      .eq("id", t.id)
      .is("from_opportunity_id", null)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!done) throw new Error("That ticket is not yours to change. Nothing was changed.");
    await logLink(sb, t.id, `Linked to the opportunity "${opp.title}".`, {
      id: context.userId,
      name: who,
    });
    if (care !== false)
      return {
        message: `${linkedWords(label)} ${care ? LINK_CARE_NOT_WON : LINK_WON_NOT_CHECKED}`,
        moved: false,
      };
    // The linked ticket moves its opportunity as a started one does. Never thrown: the link is
    // made either way, and what happened is said.
    const out = await movedByTicket(context, t.id);
    const to = out.opportunity_move?.to;
    const toLabel = to ? ((OPP_STATUS_LABELS as Record<string, string>)[to] ?? to) : null;
    return {
      message:
        linkedWords(label, toLabel ? { to: toLabel } : null) +
        (out.opportunity_move_error
          ? ` The opportunity's status was not moved: ${out.opportunity_move_error}`
          : ""),
      moved: !!to,
    };
  });

/** What a press answers. `ask`: nothing was changed, and `message` is the question to ask. */
export interface LinkAnswer {
  message: string;
  moved: boolean;
  ask?: boolean;
}

/** One line on the ticket's own history. Best effort: the link itself is already saved. */
async function logLink(
  sb: SupabaseClient<Database>,
  jobId: string,
  note: string,
  actor: { id: string; name: string | null },
): Promise<void> {
  const { error } = await sb.from("service_job_events").insert({
    service_job_id: jobId,
    kind: "note",
    note,
    by_user: actor.id,
    by_name: actor.name,
  });
  if (error) console.error("Could not log the ticket link", error.message);
}
