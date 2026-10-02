/**
 * What happens when a ticket changes stage — SERVER ONLY (load inside handlers). Owner, Sep 27:
 * maximise automation. Reaching Done tells the office ("invoice ready to review") and starts an
 * "Invoice ticket #…" follow-up for the person who opened the ticket (or the first office user),
 * which closes when the invoice goes out. Leaving Done (undo, void) closes it again.
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

export async function afterTicketStage(
  row: JobRow,
  prevStage: string | null,
  actor: { id: string; name: string | null },
  sb: Client,
): Promise<void> {
  const admin = await serverClient(sb);
  const office = await officeUsers(admin);
  const becameDone = row.stage === "done" && prevStage !== "done" && !row.deleted_at;
  if (row.stage === "done" && !row.deleted_at && !office.length)
    console.error(
      `afterTicketStage: ticket #${row.number} is done but technician_options returned no office users, so no "invoice ready" notice was sent and no "Invoice ticket" follow-up was opened (is 20261002090000_service_role_helpers.sql applied?)`,
    );
  if (becameDone) {
    const others = office.map((u) => u.id).filter((id) => id !== actor.id);
    if (others.length)
      await notify(
        others,
        {
          kind: "ticket_done",
          title: `${ticketTitle(row)} is done — invoice ready to review`,
          body: `${actor.name ?? "The technician"} marked it done. Open the ticket to review and send the invoice.`,
          url: `/service?id=${row.id}`,
        },
        admin,
      );
  }
  // The office's "invoice it" timer: open while the ticket sits at Done, closed otherwise.
  const assignee =
    (row.created_by && office.some((u) => u.id === row.created_by) ? row.created_by : null) ??
    office[0]?.id ??
    null;
  await syncFollowup(
    {
      kind: "invoice",
      itemId: row.id,
      accountId: row.account_id,
      assigneeId: row.stage === "done" && !row.deleted_at ? assignee : null,
      title: `Invoice ${ticketTitle(row)}`,
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
