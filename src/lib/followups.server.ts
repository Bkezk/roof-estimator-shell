/**
 * Follow-up timers — SERVER ONLY (uses the service-role client; load with a dynamic import
 * inside a handler). One open row per assigned item; assigning starts it, a closing status
 * ends it, and the dispatcher (notify.server.ts) reminds the assignee until then.
 *
 * Rules (owner, Sep 26–27): ticket = due on its scheduled day (or first_days from now when
 * unscheduled), reminders every ticket_every_days, closed at Done / Invoiced / Closed or when
 * unassigned. Opportunity = due at its expected close (default close_days from creation),
 * first reminder after opportunity_first_days, then every opportunity_every_days, closed at
 * Won / Lost / No response.
 */
import type { Database } from "@/integrations/supabase/types";
import { notify, serverClient, type Client } from "@/lib/notify.server";
type Settings = {
  opportunity_close_days: number;
  opportunity_first_days: number;
  opportunity_every_days: number;
  ticket_first_days: number;
  ticket_every_days: number;
};

export async function crmSettings(admin: Client): Promise<Settings> {
  const { data, error } = await admin.from("crm_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return (
    data ?? {
      opportunity_close_days: 30,
      opportunity_first_days: 3,
      opportunity_every_days: 7,
      ticket_first_days: 1,
      ticket_every_days: 3,
    }
  );
}

const days = (n: number) => n * 86400000;
/** A calendar date as 08:00 local-ish (12:00 UTC keeps it on the same day across US zones). */
const dateAtNoonUtc = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

interface SyncArgs {
  kind: "ticket" | "opportunity" | "invoice";
  itemId: string;
  accountId: string | null;
  assigneeId: string | null;
  title: string;
  url: string;
  /** Closing statuses end the timer. */
  closing: boolean;
  closeReason: string;
  /** Scheduled / expected date (YYYY-MM-DD) when there is one. */
  dueDate: string | null;
  /** Who made the change (not notified about their own assignment). */
  actorId: string;
  actorName: string | null;
}

/**
 * Bring the item's follow-up in line with its assignee and status. Returns what happened so
 * the caller can toast it.
 */
export async function syncFollowup(
  a: SyncArgs,
  sb: Client,
): Promise<"started" | "reassigned" | "closed" | "unchanged"> {
  const admin = await serverClient(sb);
  const { data: open, error } = await admin
    .from("crm_followups")
    .select("*")
    .eq("kind", a.kind)
    .eq("item_id", a.itemId)
    .eq("status", "open")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const now = new Date();
  const close = async (reason: string) => {
    if (!open) return;
    await admin
      .from("crm_followups")
      .update({ status: "closed", closed_at: now.toISOString(), closed_reason: reason })
      .eq("id", open.id);
  };
  if (a.closing || !a.assigneeId) {
    if (!open) return "unchanged";
    await close(a.closing ? a.closeReason : "unassigned");
    return "closed";
  }
  const s = await crmSettings(admin);
  const first = a.kind === "opportunity" ? s.opportunity_first_days : s.ticket_first_days;
  const every = a.kind === "opportunity" ? s.opportunity_every_days : s.ticket_every_days;
  const due = a.dueDate
    ? dateAtNoonUtc(a.dueDate)
    : new Date(now.getTime() + days(a.kind === "opportunity" ? s.opportunity_close_days : first));
  // Ticket: remind on the due day (the scheduled day) unless it is already past, then now.
  // Opportunity: first reminder after first_days, never later than the due date.
  const firstRemind =
    a.kind !== "opportunity"
      ? new Date(Math.max(due.getTime(), now.getTime()))
      : new Date(Math.min(now.getTime() + days(first), due.getTime()));
  if (open && open.assignee_id === a.assigneeId) {
    // Same person: keep the timer, refresh the title / due date if they changed.
    const patch: Database["public"]["Tables"]["crm_followups"]["Update"] = {};
    if (open.title !== a.title) patch.title = a.title;
    if (a.dueDate && new Date(open.due_at).getTime() !== due.getTime()) {
      patch.due_at = due.toISOString();
      if (open.reminders_sent === 0) patch.next_remind_at = firstRemind.toISOString();
    }
    if (Object.keys(patch).length)
      await admin.from("crm_followups").update(patch).eq("id", open.id);
    return "unchanged";
  }
  if (open) await close("reassigned");
  const { data: created, error: insErr } = await admin
    .from("crm_followups")
    .insert({
      kind: a.kind,
      item_id: a.itemId,
      account_id: a.accountId,
      assignee_id: a.assigneeId,
      title: a.title,
      url: a.url,
      due_at: due.toISOString(),
      next_remind_at: firstRemind.toISOString(),
      every_days: every,
      created_by: a.actorId,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(insErr.message);
  if (a.assigneeId !== a.actorId) {
    await notify(
      [a.assigneeId],
      {
        kind: "assigned",
        title: `${a.kind === "opportunity" ? "Opportunity" : a.kind === "invoice" ? "To invoice" : "Ticket"} assigned to you: ${a.title}`,
        body: `${a.actorName ?? "The office"} assigned this to you. Due ${due.toLocaleDateString("en-US")}; reminders every ${every} day${every === 1 ? "" : "s"} until it is closed.`,
        url: a.url,
        followup_id: created.id,
      },
      admin,
    );
  }
  return open ? "reassigned" : "started";
}
