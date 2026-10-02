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
 *
 * The writes go through two SECURITY DEFINER functions (audit, Oct 2 —
 * 20261002140000_followup_guard.sql): followup_sync_upsert (start / refresh / hand over) and
 * followup_sync_close. The database now refuses a signed-in rep who changes a follow-up's
 * reminder fields, its status or its sync marker directly; these two check the item first and
 * then write under the flag the trigger accepts (the preview runs this as the signed-in user).
 * Until that migration is applied the functions are missing (PostgREST PGRST202) and the same
 * rules run here with direct writes, as before.
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
/** PostgREST's "column not in the schema cache" (a migration not applied yet). */
const isMissingColumn = (e: { code?: string; message?: string }) =>
  e.code === "PGRST204" || /closed_by_sync/.test(e.message ?? "");
/**
 * PostgREST's "function not in the schema cache": 20261002140000_followup_guard.sql is not
 * applied yet, so the direct writes run instead.
 */
export const isMissingFunction = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "PGRST202" || /Could not find the function/i.test(e.message ?? ""));
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
  /**
   * The item was closed (Won / Lost / No response) and is open again: the assignee hears
   * "… reopened: <title>", not "… assigned to you" (audit, Oct 2).
   */
  reopened?: boolean;
}

const KIND_LABEL = { opportunity: "Opportunity", invoice: "To invoice", ticket: "Ticket" } as const;

/**
 * The assignee's notice when a follow-up starts: "<Kind> assigned to you: <title>", or for an
 * item opened again after Won / Lost / No response, "<Kind> reopened: <title>".
 */
export function startNotice(input: {
  kind: SyncArgs["kind"];
  title: string;
  reopened: boolean;
  actorName: string | null;
  due: Date;
  every: number;
}): { title: string; body: string } {
  const who = input.actorName ?? "The office";
  const tail = `Due ${input.due.toLocaleDateString("en-US")}; reminders every ${input.every} day${input.every === 1 ? "" : "s"} until it is closed.`;
  return input.reopened
    ? {
        title: `${KIND_LABEL[input.kind]} reopened: ${input.title}`,
        body: `${who} reopened this. ${tail}`,
      }
    : {
        title: `${KIND_LABEL[input.kind]} assigned to you: ${input.title}`,
        body: `${who} assigned this to you. ${tail}`,
      };
}

/**
 * What the sync did. "snooze_cleared": the same assignee keeps the timer, its date moved, and a
 * running snooze was cleared with it (audit, Oct 2: a move used to cancel the snooze silently,
 * My Work still saying "Snoozed until …").
 */
export type SyncResult = "started" | "reassigned" | "closed" | "unchanged" | "snooze_cleared";

/** followup_sync_upsert's answer (20261002140000_followup_guard.sql). */
interface UpsertOut {
  action: "started" | "reassigned" | "unchanged";
  id: string;
  due_at: string;
  every_days: number;
  snooze_cleared: boolean;
}

/**
 * Bring the item's follow-up in line with its assignee and status. Returns what happened so
 * the caller can toast it.
 */
export async function syncFollowup(a: SyncArgs, sb: Client): Promise<SyncResult> {
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
  // System behaviour, for every user (owner, Oct 1): the item was finished, unassigned or
  // reassigned. It never goes through canManageFollowup; the database function checks the item.
  const close = async (reason: string) => {
    if (!open) return;
    const viaRpc = await admin.rpc("followup_sync_close", { p_id: open.id, p_reason: reason });
    if (!viaRpc.error) return;
    if (!isMissingFunction(viaRpc.error)) throw new Error(viaRpc.error.message);
    // Before 20261002140000: the direct write, marked closed_by_sync so the older trigger
    // (crm_followups_manager_only, 20261001030000) lets it through.
    const closed = { status: "closed", closed_at: now.toISOString(), closed_reason: reason };
    const r = await admin
      .from("crm_followups")
      .update({ ...closed, closed_by_sync: true })
      .eq("id", open.id);
    // Before 20261001030000_followups_manager_only.sql is applied the column is not there yet.
    if (r.error && isMissingColumn(r.error))
      await admin.from("crm_followups").update(closed).eq("id", open.id);
  };
  if (a.closing || !a.assigneeId) {
    if (!open) return "unchanged";
    await close(a.closing ? a.closeReason : "unassigned");
    return "closed";
  }

  // Start / refresh / hand over through the database function.
  const up = await admin.rpc("followup_sync_upsert", {
    p_kind: a.kind,
    p_item_id: a.itemId,
    p_assignee_id: a.assigneeId,
    p_account_id: a.accountId,
    p_title: a.title,
    p_url: a.url,
    p_due_date: a.dueDate,
    p_created_by: a.actorId,
  });
  if (up.error && !isMissingFunction(up.error)) throw new Error(up.error.message);
  if (!up.error) {
    const out = up.data as unknown as UpsertOut;
    if (out.action === "unchanged") return out.snooze_cleared ? "snooze_cleared" : "unchanged";
    await announce(a, out.id, new Date(out.due_at), out.every_days, admin);
    return out.action;
  }

  // Before 20261002140000: the same rules, written directly.
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
    // Same person: keep the timer; refresh the title, customer and link, and the due date if it
    // moved (audit, Oct 2: the customer and link stayed the old ones).
    const patch: Database["public"]["Tables"]["crm_followups"]["Update"] = {};
    if (open.title !== a.title) patch.title = a.title;
    if ((open.account_id ?? null) !== a.accountId) patch.account_id = a.accountId;
    if (open.url !== a.url) patch.url = a.url;
    let snoozeCleared = false;
    if (a.dueDate && new Date(open.due_at).getTime() !== due.getTime()) {
      patch.due_at = due.toISOString();
      // A moved date clears a snooze: the reminder follows the new date.
      const snoozed = open.snoozed_until ? Date.parse(open.snoozed_until) : null;
      snoozeCleared = snoozed !== null && snoozed > now.getTime();
      if (open.snoozed_until) patch.snoozed_until = null;
      if (open.reminders_sent === 0 || snoozeCleared)
        patch.next_remind_at = firstRemind.toISOString();
    }
    if (Object.keys(patch).length)
      await admin.from("crm_followups").update(patch).eq("id", open.id);
    return snoozeCleared ? "snooze_cleared" : "unchanged";
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
  await announce(a, created.id, due, every, admin);
  return open ? "reassigned" : "started";
}

/** Tell the new assignee (never the person who made the change). */
async function announce(a: SyncArgs, followupId: string, due: Date, every: number, admin: Client) {
  if (!a.assigneeId || a.assigneeId === a.actorId) return;
  const n = startNotice({
    kind: a.kind,
    title: a.title,
    reopened: !!a.reopened,
    actorName: a.actorName,
    due,
    every,
  });
  await notify(
    [a.assigneeId],
    { kind: "assigned", title: n.title, body: n.body, url: a.url, followup_id: followupId },
    admin,
  );
}
