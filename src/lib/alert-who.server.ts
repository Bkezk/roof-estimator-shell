/**
 * Who an alert line tells, and the numbers it runs on — SERVER ONLY (rules: alert-rules.ts).
 *
 * One read per pass or per step: the settings row (its day boxes and its lists of people) and
 * the people themselves (their role, to open "Every admin" / "Every manager" out, and their
 * name, for "Assigned to <name>." on a reminder that goes to someone other than the assignee).
 *
 * Read with whatever client the caller has. The published app and the scheduled job hold the
 * server key and read everything. The preview runs as the signed-in person, who may not read the
 * settings row (it is an admin's and a manager's): the defaults then stand, which are who was
 * told before this page existed.
 *
 * `notToldToday`: nobody is told twice in one day about the same item by the reminder lines
 * (someone listed on both Past due and Not started would otherwise get two).
 */
import {
  WHO_ASSIGNEE,
  alertNumbers,
  parseAlertWho,
  resolveWho,
  type AlertKey,
  type AlertNumbers,
  type AlertWho,
} from "@/lib/alert-rules";
import type { Client } from "@/lib/notify.server";
import { TASK_TZ, zonedTime } from "@/lib/tasks";
import { ticketReminderSettings, type TicketReminderSettings } from "@/lib/ticket-reminders";
import { officeDay } from "@/lib/working-days";

export interface AlertPersonRow {
  id: string;
  role: string | null;
  name: string;
}

export interface AlertContext {
  who: AlertWho;
  numbers: AlertNumbers;
  people: AlertPersonRow[];
  /** A ticket's two "before the date" numbers. */
  ticket: TicketReminderSettings;
  /** An opportunity's two, in the same shape (one rule runs both). */
  opportunity: TicketReminderSettings;
  /** Past due: every N working days. */
  every: { ticket: number; opportunity: number };
  /** Not started: after N working days. */
  untouched: { ticket: number; opportunity: number };
  /** Nobody on it: first after N working days. */
  nobodyAfter: { ticket: number; opportunity: number };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const whole = (v: unknown, min: number, fallback: number): number =>
  Number.isInteger(v) && (v as number) >= min ? (v as number) : fallback;

/** The context from a settings row and the people (pure, so the tests can build one). */
export function alertContext(
  row: Record<string, unknown> | null | undefined,
  people: AlertPersonRow[],
): AlertContext {
  const numbers = alertNumbers(row);
  return {
    who: parseAlertWho(row?.["alert_who"], {
      escalate_to_admins: row?.["escalate_to_admins"] as boolean | null | undefined,
      escalate_user_ids: row?.["escalate_user_ids"] as string[] | null | undefined,
    }),
    numbers,
    people,
    ticket: ticketReminderSettings(row),
    opportunity: {
      ticket_before_every_days: numbers.opportunity_before_every_days,
      ticket_due_notice_days: numbers.opportunity_due_notice_days,
    },
    every: {
      ticket: whole(row?.["ticket_every_days"], 1, 3),
      opportunity: whole(row?.["opportunity_every_days"], 1, 7),
    },
    untouched: {
      ticket: whole(row?.["ticket_untouched_days"], 0, 2),
      opportunity: whole(row?.["opportunity_untouched_days"], 0, 3),
    },
    nobodyAfter: {
      ticket: whole(row?.["unassigned_overdue_days"], 0, 1),
      opportunity: numbers.opportunity_unassigned_days,
    },
  };
}

/** Read the settings and the people. Never throws: what cannot be read falls to the defaults. */
export async function loadAlertContext(admin: Client): Promise<AlertContext> {
  let row: Record<string, unknown> | null = null;
  let people: AlertPersonRow[] = [];
  try {
    const { data, error } = await admin.from("crm_settings").select("*").eq("id", 1).limit(1);
    if (error) throw new Error(error.message);
    row = (data?.[0] as Record<string, unknown> | undefined) ?? null;
  } catch (e) {
    console.error("Alerts: could not read the settings; using the defaults —", errText(e));
  }
  try {
    const { data, error } = await admin.from("profiles").select("id, role, full_name, email");
    if (error) throw new Error(error.message);
    people = (data ?? []).map((p) => ({
      id: p.id,
      role: p.role ?? null,
      name: (p.full_name ?? "").trim() || p.email || "someone",
    }));
  } catch (e) {
    console.error(
      "Alerts: could not read the people; nobody but the assignee is told —",
      errText(e),
    );
  }
  return alertContext(row, people);
}

/** The people a line tells for an item assigned to `assigneeId` (null: nobody on it). */
export const recipientsFor = (
  ctx: AlertContext,
  key: AlertKey,
  assigneeId: string | null | undefined,
): string[] => resolveWho(ctx.who[key], ctx.people, assigneeId);

/**
 * The same, for the lines about someone else's work (Not started): the person on it is told
 * only when the line names "the person assigned", not merely because they are also an admin or
 * a manager. They have their own reminders for it.
 */
export function watchersFor(
  ctx: AlertContext,
  key: AlertKey,
  assigneeId: string | null | undefined,
): string[] {
  const ids = recipientsFor(ctx, key, assigneeId);
  return ctx.who[key].includes(WHO_ASSIGNEE) ? ids : ids.filter((id) => id !== assigneeId);
}

export const personName = (ctx: AlertContext, id: string | null | undefined): string | null =>
  (id && ctx.people.find((p) => p.id === id)?.name) || null;

/** The reminder lines' kinds: what "already told today" looks for. */
export const DAILY_KINDS = [
  "followup",
  "untouched",
  "ticket_unassigned",
  "opportunity_unassigned",
] as const;

/**
 * Of `userIds`, those not yet told about this item today by a reminder line. Never throws: when
 * the inbox cannot be read everyone stays in (better told twice than not at all).
 */
export async function notToldToday(
  admin: Client,
  userIds: string[],
  url: string | null | undefined,
  now: Date,
): Promise<string[]> {
  if (!userIds.length || !url) return userIds;
  try {
    const since = zonedTime(officeDay(now), "00:00", TASK_TZ).getTime();
    // This item's notices to these people (a handful of rows), sorted here: which kind, and
    // whether it was today in the office.
    const { data, error } = await admin
      .from("notifications")
      .select("user_id, kind, created_at")
      .in("user_id", userIds)
      .eq("url", url);
    if (error) throw new Error(error.message);
    const told = new Set(
      (data ?? [])
        .filter(
          (r) =>
            (DAILY_KINDS as readonly string[]).includes(r.kind) &&
            !!r.created_at &&
            Date.parse(r.created_at) >= since,
        )
        .map((r) => r.user_id),
    );
    return userIds.filter((id) => !told.has(id));
  } catch (e) {
    console.error("Alerts: could not check who was told today —", errText(e));
    return userIds;
  }
}
