/**
 * Announcing the inspection tickets the site makes for Roof Care plans — SERVER ONLY (load it
 * with `await import("@/lib/roof-care-ticket-announce.server")` inside a handler). The words and
 * who hears which tickets: roof-care-ticket-announce.ts. Break test Nov 20, number 16.
 *
 * `dispatchCareTicketAnnouncements` is a pass of the 8:00 reminder run (api.cron.reminders.ts).
 * For every plan inspection ticket that has not been announced it does what opening a ticket
 * through the app does (service.functions.ts syncTicketFollowup): the people on the tickets'
 * "Each step" line (every admin and manager until someone changes it) hear "Opened", and a
 * ticket with a technician starts that technician's reminder timer and tells them "Assigned to
 * you". One notice per person for the morning's tickets together.
 *
 * Safe to run twice, and after a failed send (20261120700000_roof_care_ticket_notices.sql):
 *   1. The database hands each ticket to ONE run (roof_care_ticket_announce_claim): a second
 *      run in the same minute gets nothing.
 *   2. A ticket is marked announced only after its notices were written
 *      (roof_care_ticket_announce_finish … true). When a send fails, the tickets in it are given
 *      back (… false) and the next run tells them. A run that dies holds its tickets for 15
 *      minutes, then they are free again.
 *   3. Who was told which ticket is written right after each notice (roof_care_ticket_told_mark,
 *      20261120840000). The next run leaves out, for each person, what they have already heard
 *      (owner, Nov 20: "go with 4"). Before, one group's failed notice made every group hear
 *      the same tickets again.
 * Nothing goes out before 8:00 on the office's clock, nor on a Saturday or Sunday (owner, Nov
 * 13 and 18): tickets made on a weekend are told on Monday.
 *
 * A ticket the app made while a person was at the screen (a plan starting, a storm inspection
 * added) is announced there and then, by that person's name (service.functions.ts
 * announceCarePlanTickets), and marked the same way, so this pass leaves it alone. If that
 * announcement could not be made, the ticket is still unmarked and this pass tells it.
 */
import { databaseRpc } from "@/lib/database-rpc";
import { loadAlertContext, personName, recipientsFor } from "@/lib/alert-who.server";
import { startNotice, startTicketTimerBySite } from "@/lib/followups.server";
import { notify, serverClient, type Client } from "@/lib/notify.server";
import {
  CARE_TICKET_MAKER,
  careAssignedNotice,
  careNoticeGroups,
  careOpenedNotice,
  careTicketTitle,
  toldSet,
  type CareTicketToAnnounce,
} from "@/lib/roof-care-ticket-announce";
import { localYmd, TASK_TZ } from "@/lib/tasks";
import { TICKET_WATCH_KIND } from "@/lib/ticket-watch";
import { isWeekend, morningReached } from "@/lib/working-days";

export interface CareTicketAnnounceResult {
  /** Tickets this run took. */
  tickets_checked: number;
  /** Marked announced: their notices are written. */
  tickets_announced: number;
  /** Given back for the next run: a notice of theirs could not be written. */
  tickets_held: number;
  /** Notices written (one per person and group of tickets). */
  notices_sent: number;
  /** Reminder timers started for the tickets that have a technician. */
  timers_started: number;
  tickets_errors: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Timer = NonNullable<Awaited<ReturnType<typeof startTicketTimerBySite>>>;

export async function dispatchCareTicketAnnouncements(
  sb: Client,
  now: Date = new Date(),
): Promise<CareTicketAnnounceResult> {
  const out: CareTicketAnnounceResult = {
    tickets_checked: 0,
    tickets_announced: 0,
    tickets_held: 0,
    notices_sent: 0,
    timers_started: 0,
    tickets_errors: 0,
  };
  if (!morningReached(now) || isWeekend(localYmd(now, TASK_TZ))) return out;
  const admin = await serverClient(sb);
  const rpc = databaseRpc(admin);
  const claimed = await rpc("roof_care_ticket_announce_claim", {});
  if (claimed.error) throw new Error(claimed.error.message);
  const tickets: CareTicketToAnnounce[] = claimed.data ?? [];
  out.tickets_checked = tickets.length;
  if (!tickets.length) return out;

  // Tickets whose notice could not be written: given back at the end.
  const failed = new Set<string>();
  const fail = (list: readonly CareTicketToAnnounce[], what: string, e: unknown) => {
    out.tickets_errors++;
    for (const t of list) failed.add(t.id);
    console.error(
      `Roof Care ticket announcement: ${what} (ticket${list.length === 1 ? "" : "s"} ${list.map((t) => `#${t.number}`).join(", ")}) —`,
      errText(e),
    );
  };

  try {
    const ctx = await loadAlertContext(admin);
    // Nobody could be read (loadAlertContext never throws): not "nobody is to be told".
    if (!ctx.people.length) throw new Error("the people could not be read");
    const watchers = recipientsFor(ctx, "ticket.steps", null);
    // Who has already heard which of these tickets, from a run that got part of the way. If
    // that cannot be read the run goes on as if nobody had: a second notice beats none.
    const heard = await rpc("roof_care_ticket_told_list", { p_ids: tickets.map((t) => t.id) });
    if (heard.error)
      console.error(
        "Roof Care ticket announcement: could not read who was told already —",
        heard.error.message,
      );
    const told = toldSet(heard.error ? [] : heard.data);

    // 1. The admins and the managers: one notice each for their tickets together.
    for (const g of careNoticeGroups(tickets, watchers, told)) {
      const [only] = g.tickets;
      const notice = careOpenedNotice(
        g.tickets,
        g.tickets.length === 1 && only ? personName(ctx, only.technician_id) : null,
      );
      if (!notice) continue;
      try {
        await notify(g.ids, { kind: TICKET_WATCH_KIND, ...notice }, admin);
        out.notices_sent++;
      } catch (e) {
        fail(g.tickets, "the Opened notice was not written", e);
        continue;
      }
      // Written: remember who heard, so a retry for another group's sake leaves them out.
      const marked = await rpc("roof_care_ticket_told_mark", {
        p_jobs: g.tickets.map((t) => t.id),
        p_people: g.ids,
      });
      if (marked.error)
        console.error(
          "Roof Care ticket announcement: could not remember who was told —",
          marked.error.message,
        );
    }

    // 2. The technicians: the reminder timer of each ticket that has one, as for any new ticket,
    //    and "Assigned to you" — once for several tickets given to the same person.
    const byTech = new Map<string, CareTicketToAnnounce[]>();
    for (const t of tickets) {
      if (!t.technician_id || failed.has(t.id)) continue;
      byTech.set(t.technician_id, [...(byTech.get(t.technician_id) ?? []), t]);
    }
    for (const [techId, list] of byTech) {
      const started: { ticket: CareTicketToAnnounce; timer: Timer }[] = [];
      for (const t of list) {
        try {
          const timer = await startTicketTimerBySite(
            {
              itemId: t.id,
              assigneeId: techId,
              accountId: t.account_id,
              title: careTicketTitle(t),
              url: `/service?id=${t.id}`,
              dueDate: t.scheduled_date,
            },
            admin,
          );
          // null: the timer is already running (a run that died after starting it). The
          // technician was told then; never twice.
          if (timer) {
            out.timers_started++;
            started.push({ ticket: t, timer });
          }
        } catch (e) {
          fail([t], "its reminder timer was not started", e);
        }
      }
      if (!started.length) continue;
      const [one] = started;
      const several = careAssignedNotice(started.map((s) => s.ticket));
      try {
        if (several) {
          await notify([techId], { kind: "assigned", ...several }, admin);
        } else if (one) {
          const n = startNotice({
            kind: "ticket",
            title: careTicketTitle(one.ticket),
            reopened: false,
            actorName: CARE_TICKET_MAKER,
            due: one.timer.due,
            every: one.timer.every,
            firstReminder: one.timer.firstReminder,
            now,
          });
          await notify(
            [techId],
            {
              kind: "assigned",
              title: n.title,
              body: n.body,
              url: `/service?id=${one.ticket.id}`,
              followup_id: one.timer.id,
            },
            admin,
          );
        }
        out.notices_sent++;
      } catch (e) {
        // The timer runs and will remind them; the ticket is not held back for this.
        out.tickets_errors++;
        console.error(
          `Roof Care ticket announcement: the technician's notice was not written —`,
          errText(e),
        );
      }
    }
  } catch (e) {
    fail(tickets, "the run stopped", e);
  }

  // 3. Mark what was told; give back what was not.
  const done = tickets.filter((t) => !failed.has(t.id)).map((t) => t.id);
  const back = tickets.filter((t) => failed.has(t.id)).map((t) => t.id);
  if (back.length) {
    out.tickets_held = back.length;
    const r = await rpc("roof_care_ticket_announce_finish", { p_ids: back, p_written: false });
    if (r.error)
      console.error(
        "Roof Care ticket announcement: could not give tickets back —",
        r.error.message,
      );
  }
  if (done.length) {
    const r = await rpc("roof_care_ticket_announce_finish", { p_ids: done, p_written: true });
    if (r.error) throw new Error(r.error.message);
    out.tickets_announced = done.length;
  }
  return out;
}

/**
 * The app's side (service.functions.ts announceCarePlanTickets): take these tickets before they
 * are announced there, and mark them after. `null`: the database could not be asked (the
 * preview has no server key) — the caller announces as before, unmarked.
 */
export async function claimCareTickets(
  sb: Client,
  ids: readonly string[],
): Promise<string[] | null> {
  if (!ids.length) return [];
  try {
    const admin = await serverClient(sb);
    const r = await databaseRpc(admin)("roof_care_ticket_announce_claim", { p_ids: [...ids] });
    if (r.error) return null;
    return (r.data ?? []).map((t) => t.id);
  } catch {
    return null;
  }
}

export async function finishCareTickets(
  sb: Client,
  ids: readonly string[],
  written: boolean,
): Promise<void> {
  if (!ids.length) return;
  try {
    const admin = await serverClient(sb);
    const r = await databaseRpc(admin)("roof_care_ticket_announce_finish", {
      p_ids: [...ids],
      p_written: written,
    });
    if (r.error) console.error("Could not mark care plan tickets announced —", r.error.message);
  } catch (e) {
    console.error("Could not mark care plan tickets announced —", errText(e));
  }
}
