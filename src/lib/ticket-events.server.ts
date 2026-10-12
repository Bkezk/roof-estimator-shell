/**
 * What happens when a ticket changes stage — SERVER ONLY (load inside handlers). Owner, Sep 27:
 * maximise automation. Since Oct 5 (M9, the Authorized stage): reaching Done tells the authorizers
 * (Setup › Service rates, else every admin) "ready for your review" ONCE (owner, Oct 12, item 2:
 * the follow-up opened in the same step used to send a second "ready for your review") and opens
 * an "Authorize ticket #…" follow-up for them (Work Overview's Needs authorization tab), which
 * closes when the ticket leaves Done. Reaching Authorized tells the office "ready to invoice".
 *
 * Also here (owner, Oct 12, item 9; `afterTicketDispatch`): the technician's own notices when
 * a ticket is taken from them ("Ticket #N was reassigned") or its day moves ("Ticket #N moved to
 * <day>"), from every path that changes the technician or the date (saveServiceJob,
 * assignServiceJob — the Tech Board's drops — and claimServiceJob through syncTicketFollowup).
 * No notice to the person who made the change, none for a PO or for Closed (owner).
 */
import { longDay } from "@/lib/followup-rules";
import { notify, serverClient, type Client } from "@/lib/notify.server";
import { syncFollowup } from "@/lib/followups.server";

type JobRow = {
  id: string;
  number: number;
  customer_name: string;
  description: string;
  stage: string;
  account_id: string | null;
  technician_id: string | null;
  created_by: string | null;
  deleted_at: string | null;
};

const ticketTitle = (j: JobRow) =>
  `Ticket #${j.number} ${j.customer_name}${j.description ? ` — ${j.description}` : ""}`;

/**
 * Office users (Service without the technician tick, and admins), from the roster RPC. Under
 * the service role the RPC returned nothing until 20261002090000_service_role_helpers.sql; an
 * empty or failed roster is logged rather than passed over in silence.
 */
async function officeUsers(sb: Client): Promise<{ id: string; technician: boolean }[]> {
  const { data, error } = await sb.rpc("technician_options");
  if (error) console.error(`afterTicketStage: technician_options failed — ${error.message}`);
  return (data ?? []).filter((u) => !u.technician).map((u) => ({ id: u.id, technician: false }));
}

/** A roster user's display name (technician_options), or null when not on it. */
async function rosterName(sb: Client, id: string): Promise<string | null> {
  const { data, error } = await sb.rpc("technician_options");
  if (error) {
    console.error(`afterTicketDispatch: technician_options failed — ${error.message}`);
    return null;
  }
  const u = (data ?? []).find((r) => r.id === id);
  return u ? (u.full_name ?? "").trim() || u.email : null;
}

/**
 * Who reviews Done tickets (20261005150000_ticket_authorizer.sql); [] until it is applied. The
 * first owns the Authorize follow-up; since 20261012170000_managers_authorize.sql the rest are
 * every other admin and manager (owner, Oct 12: "make managers able to authorize"). Every id is
 * kept — the Done notice goes to all of them.
 */
export async function authorizerIds(sb: Client): Promise<string[]> {
  const { data, error } = await sb.rpc("ticket_authorizers");
  if (error) return [];
  return (data ?? []).filter((x): x is string => typeof x === "string" && !!x);
}

/**
 * Why the stage changed, when the stage alone does not say (owner, Oct 6). "void": the last
 * live invoice was voided and the ticket went back to Authorized (invoices.functions.ts
 * voidInvoice), so the office hears that, not "authorized — ready to invoice … <voider>
 * authorized it". Left out for every other stage change.
 */
export interface StageEventOptions {
  reason?: "void";
}

export async function afterTicketStage(
  row: JobRow,
  prevStage: string | null,
  actor: { id: string; name: string | null },
  sb: Client,
  opts: StageEventOptions = {},
): Promise<void> {
  const admin = await serverClient(sb);
  const office = await officeUsers(admin);
  const live = !row.deleted_at;
  const becameDone = row.stage === "done" && prevStage !== "done" && live;
  const becameAuthorized = row.stage === "authorized" && prevStage !== "authorized" && live;
  // M9 (owner, Oct 5): the owner reviews a Done ticket ("Brandon … will be the go to person to
  // authorize"): the set authorizer, else Brandon, then (Oct 12: "make managers able to
  // authorize") every other admin and manager (ticket_authorizers). Until that migration is
  // applied, or if it names nobody, the office as before.
  const authorizers = row.stage === "done" && live ? await authorizerIds(admin) : [];
  const reviewers = authorizers.length ? authorizers : office.map((u) => u.id);
  if (row.stage === "done" && live && !reviewers.length)
    console.error(
      `afterTicketStage: ticket #${row.number} is done but nobody authorizes it (no authorizer, no admin, no office user), so no "ready for your review" notice was sent and no "Authorize ticket" follow-up was opened`,
    );
  if (becameDone) {
    // Every authorizer the database names but the actor — the whole list, never truncated (a
    // manager who is not the named authorizer is told too; owner, Oct 12).
    const others = reviewers.filter((id) => id !== actor.id);
    // The one Done notice (owner, Oct 12, item 2): the follow-up opened below is `quiet`, so the
    // first authorizer is not told a second time by its "assigned" notice.
    if (others.length)
      await notify(
        others,
        {
          kind: "ticket_done",
          title: `${ticketTitle(row)} is done — ready for your review`,
          body: `${actor.name ?? "The technician"} marked it done. Review it and mark it Authorized; the invoice is made after that.`,
          url: `/service?id=${row.id}`,
        },
        admin,
      );
  }
  if (becameAuthorized) {
    // The manager invoices it next (the Invoices tab's To invoice queue).
    const others = office.map((u) => u.id).filter((id) => id !== actor.id);
    // A void sent it back here (owner, Oct 6): say so, not "authorized — ready to invoice".
    const voided = opts.reason === "void";
    if (others.length)
      await notify(
        others,
        {
          kind: "ticket_authorized",
          title: voided
            ? `${ticketTitle(row)} back to Authorized — its invoice was voided by ${actor.name ?? "the office"}.`
            : `${ticketTitle(row)} authorized — ready to invoice`,
          body: voided
            ? `${actor.name ?? "The office"} voided its invoice. The ticket is Authorized again; make a new invoice from the ticket when it is ready.`
            : `${actor.name ?? "The office"} authorized it. Make the invoice from the ticket.`,
          url: `/service?id=${row.id}`,
        },
        admin,
      );
  }
  // The review timer (follow-up kind "invoice"): open while the ticket sits at Done, closed
  // otherwise; on the authorizer's Work Overview under "Needs authorization". One follow-up per
  // ticket (syncFollowup keys on it), so one assignee: the first authorizer. The order is the
  // database's (settings → Brandon → then every other admin and manager by created_at, id;
  // 20261006210000_default_authorizer.sql, 20261012170000_managers_authorize.sql) — QA audit bug
  // 6 (owner, Oct 6): it was unordered, so with two admins and nothing set the item flipped
  // between them on any save. The other admins and managers see the same ticket on Work Overview
  // under Needs authorization without a follow-up of their own (my-work.functions.ts toAuthorize).
  // The rpc missing or empty: the office, as before.
  const assignee =
    authorizers[0] ??
    (row.created_by && office.some((u) => u.id === row.created_by) ? row.created_by : null) ??
    office[0]?.id ??
    null;
  await syncFollowup(
    {
      kind: "invoice",
      itemId: row.id,
      accountId: row.account_id,
      assigneeId: row.stage === "done" && live ? assignee : null,
      title: `Authorize ${ticketTitle(row)}`,
      url: `/service?id=${row.id}`,
      closing: row.stage !== "done" || !!row.deleted_at,
      closeReason: row.deleted_at ? "deleted" : `stage ${row.stage}`,
      dueDate: null,
      actorId: actor.id,
      actorName: actor.name,
      // The assignee is among the reviewers told above (authorizers[0], or an office user when
      // there is no authorizer): no second "ready for your review" in the step the ticket became
      // Done. A later hand-over (another authorizer set while it sits at Done) still announces.
      quiet: becameDone,
    },
    admin,
  );
}

/** What a dispatch path knew of the ticket before its write (technician and day). */
export interface DispatchBefore {
  technician_id: string | null;
  scheduled_date: string | null;
}

/**
 * The technician's notices after a dispatch or a date move (owner, Oct 12, item 9). Exactly one
 * per change, from the one place every path reaches (service.functions.ts syncTicketFollowup):
 *   - the technician changed from A to B: A hears "Ticket #N was reassigned" (kind `reassigned`,
 *     naming B and the ticket; B hears "Ticket assigned to you" from the follow-up as before);
 *     taken off to nobody: nothing beyond that (owner: "reassigned" wording, not "taken off you");
 *   - the technician stayed and the day moved: they hear "Ticket #N moved to <long day>" (kind
 *     `date_moved`) — unless they moved it themselves.
 * Never to the person who made the change; nothing for a deleted ticket. Best effort: a failed
 * notice is logged, the dispatch itself is already saved.
 */
export async function afterTicketDispatch(
  row: JobRow & { scheduled_date: string | null },
  before: DispatchBefore,
  actor: { id: string; name: string | null },
  sb: Client,
): Promise<void> {
  if (row.deleted_at) return;
  const who = actor.name ?? "The office";
  const url = `/service?id=${row.id}`;
  try {
    const admin = await serverClient(sb);
    const techChanged = (before.technician_id ?? null) !== (row.technician_id ?? null);
    if (techChanged) {
      // A → B: A is told; from nobody, or to nobody, there is no "reassigned" to tell.
      if (before.technician_id && row.technician_id && before.technician_id !== actor.id) {
        const newTech = (await rosterName(admin, row.technician_id)) ?? "another technician";
        await notify(
          [before.technician_id],
          {
            kind: "reassigned",
            title: `Ticket #${row.number} was reassigned`,
            body: `${who} reassigned ${ticketTitle(row)} to ${newTech}. It is off your list.`,
            url,
          },
          admin,
        );
      }
      return;
    }
    const dateChanged = (before.scheduled_date ?? null) !== (row.scheduled_date ?? null);
    if (!dateChanged || !row.scheduled_date || !row.technician_id) return;
    if (row.technician_id === actor.id) return;
    const from = before.scheduled_date ? ` from ${longDay(before.scheduled_date)}` : "";
    await notify(
      [row.technician_id],
      {
        kind: "date_moved",
        title: `Ticket #${row.number} moved to ${longDay(row.scheduled_date)}`,
        body: `${who} moved ${ticketTitle(row)}${from} to ${longDay(row.scheduled_date)}.`,
        url,
      },
      admin,
    );
  } catch (e) {
    console.error(
      `afterTicketDispatch: ticket #${row.number} — the technician's notice was not sent: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
