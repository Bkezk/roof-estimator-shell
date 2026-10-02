/**
 * Test-only: followup_claim_reminder (20261002140000_followup_guard.sql) in memory, for the
 * reminder-pass fakes. Without the service key the pass claims a due reminder through this
 * function: it moves next_remind_at on by every_days and counts the reminder only where the
 * follow-up is open, due, and still holds the value the pass read; true when it did.
 */
type Row = Record<string, unknown>;

export function claimReminderInMemory(
  db: Record<string, Row[]>,
  args: Row | undefined,
): { data: boolean; error: null } {
  const f = (db["crm_followups"] ?? []).find((r) => r["id"] === args?.["p_id"]);
  const now = Date.now();
  if (
    !f ||
    f["status"] !== "open" ||
    f["next_remind_at"] !== args?.["p_expected"] ||
    Date.parse(String(f["next_remind_at"])) > now
  )
    return { data: false, error: null };
  f["next_remind_at"] = new Date(now + Number(f["every_days"]) * 86400000).toISOString();
  f["reminders_sent"] = Number(f["reminders_sent"]) + 1;
  f["last_reminded_at"] = new Date(now).toISOString();
  return { data: true, error: null };
}
