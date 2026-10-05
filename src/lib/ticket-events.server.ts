/**
 * What happens when a ticket changes stage — SERVER ONLY (load inside handlers). Owner, Sep 27:
 * maximise automation. Since Oct 5 (M9, the Authorized stage): reaching Done tells the authorizer
 * (Setup › Service rates, else every admin) "ready for your review" and opens an "Authorize
 * ticket #…" follow-up for them (Work Overview's Needs authorization tab), which closes when the
 * ticket leaves Done. Reaching Authorized tells the office "ready to invoice".
 */
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

/** Who reviews Done tickets (20261005150000_ticket_authorizer.sql); [] until it is applied. */
export async function authorizerIds(sb: Client): Promise<string[]> {
  const { data, error } = await sb.rpc("ticket_authorizers");
  if (error) return [];
  return (data ?? []).filter((x): x is string => typeof x === "string" && !!x);
}

export async function afterTicketStage(
  row: JobRow,
  prevStage: string | null,
  actor: { id: string; name: string | null },
  sb: Client,
): Promise<void> {
  const admin = await serverClient(sb);
  const office = await officeUsers(admin);
  const live = !row.deleted_at;
  const becameDone = row.stage === "done" && prevStage !== "done" && live;
  const becameAuthorized = row.stage === "authorized" && prevStage !== "authorized" && live;
  // M9 (owner, Oct 5): the owner reviews a Done ticket ("Brandon … will be the go to person to
  // authorize"): the set authorizer, else every admin (ticket_authorizers). Until that migration
  // is applied, or if it names nobody, the office as before.
  const authorizers = row.stage === "done" && live ? await authorizerIds(admin) : [];
  const reviewers = authorizers.length ? authorizers : office.map((u) => u.id);
  if (row.stage === "done" && live && !reviewers.length)
    console.error(
      `afterTicketStage: ticket #${row.number} is done but nobody authorizes it (no authorizer, no admin, no office user), so no "ready for your review" notice was sent and no "Authorize ticket" follow-up was opened`,
    );
  if (becameDone) {
    const others = reviewers.filter((id) => id !== actor.id);
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
    if (others.length)
      await notify(
        others,
        {
          kind: "ticket_authorized",
          title: `${ticketTitle(row)} authorized — ready to invoice`,
          body: `${actor.name ?? "The office"} authorized it. Make the invoice from the ticket.`,
          url: `/service?id=${row.id}`,
        },
        admin,
      );
  }
  // The review timer (follow-up kind "invoice"): open while the ticket sits at Done, closed
  // otherwise; on the authorizer's Work Overview under "Needs authorization".
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
    },
    admin,
  );
}
