/**
 * Announcing the inspection tickets the site makes for Roof Care plans: the words, and who
 * hears which tickets (break test Nov 20, number 16). Pure; the sending is
 * roof-care-ticket-announce.server.ts.
 *
 * A ticket a person opens tells the admins and the managers "Opened: Ticket #…" and starts its
 * technician's reminder timer. The morning run (roof_care_make_tickets, 6:40 AM Eastern) made
 * its tickets in silence. The 8:00 run now says the same about them, once: ONE notice per
 * person for that morning's tickets together, naming each ticket and when it is due.
 */
import { longDay, monthDay } from "@/lib/followup-rules";
import { planName } from "@/lib/roof-care-plan";
import { assignedLine } from "@/lib/ticket-watch";

/** Who "opened" a ticket the site made (the name the morning run signs with). */
export const CARE_TICKET_MAKER = "Roof Care plans";
/** How many tickets one notice names; the rest are counted ("and 3 more"). */
export const CARE_NOTICE_NAMES = 10;

/** What roof_care_ticket_announce_claim answers for a ticket (20261120700000). */
export interface CareTicketToAnnounce {
  id: string;
  number: number;
  customer_name: string;
  site_name: string | null;
  description: string;
  stage: string;
  account_id: string | null;
  technician_id: string | null;
  scheduled_date: string | null;
  plan: string | null;
  visit_kind: string | null;
  due_from: string | null;
  due_by: string | null;
}

/** "Nov 25 to Dec 30, 2026"; null when the inspection's dates could not be read. */
export function dueWindow(t: Pick<CareTicketToAnnounce, "due_from" | "due_by">): string | null {
  if (!t.due_from || !t.due_by) return null;
  const sameYear = t.due_from.slice(0, 4) === t.due_by.slice(0, 4);
  return `${sameYear ? monthDay(t.due_from) : longDay(t.due_from)} to ${longDay(t.due_by)}`;
}

/** The ticket as every notice of it is titled (ticket-watch.ts, followups: the same words). */
export const careTicketTitle = (t: CareTicketToAnnounce): string =>
  `Ticket #${t.number} ${t.customer_name}${t.description ? ` — ${t.description}` : ""}`;

const place = (t: CareTicketToAnnounce): string => {
  const site = (t.site_name ?? "").trim();
  const customer = (t.customer_name ?? "").trim();
  if (site && customer && site !== customer) return `${site} (${customer})`;
  return site || customer || "a property";
};

/** One ticket inside a notice of several: "#6076 Main plant (Acme), due Nov 25 to Dec 30, 2026". */
export function careTicketLine(t: CareTicketToAnnounce): string {
  const due = dueWindow(t);
  return `#${t.number} ${place(t)}${due ? `, due ${due}` : ""}`;
}

const named = (list: readonly CareTicketToAnnounce[]): string => {
  const shown = list.slice(0, CARE_NOTICE_NAMES).map(careTicketLine);
  const more = list.length - shown.length;
  return `${shown.join(". ")}.${more > 0 ? ` And ${more} more.` : ""}`;
};

export interface CareNotice {
  title: string;
  body: string;
  url: string;
}

/**
 * What the admins and the managers hear: the usual "Opened" notice for one ticket, one notice
 * naming every ticket for several. `techName`: the one ticket's technician, when it has one.
 */
export function careOpenedNotice(
  list: readonly CareTicketToAnnounce[],
  techName: string | null = null,
): CareNotice | null {
  const [first] = list;
  if (!first) return null;
  if (list.length === 1) {
    const due = dueWindow(first);
    return {
      title: `Opened: ${careTicketTitle(first)}`,
      body: `The site made it for the ${planName(first.plan)} plan at ${place(first)}.${due ? ` Due between ${due.replace(" to ", " and ")}.` : ""} ${assignedLine(first, techName)}`,
      url: `/service?id=${first.id}`,
    };
  }
  return {
    title: `${list.length} Roof Care plan inspection tickets opened`,
    body: `The site made them for their plans. ${named(list)}`,
    url: "/service",
  };
}

/** What a technician hears who was given several of them at once (one: the usual notice). */
export function careAssignedNotice(list: readonly CareTicketToAnnounce[]): CareNotice | null {
  if (list.length < 2) return null;
  return {
    title: `${list.length} Roof Care plan inspections assigned to you`,
    body: `The site made them for their plans. ${named(list)}`,
    url: "/service/today",
  };
}

/** One "this person was told about this ticket" (roof_care_ticket_told, 20261120840000). */
export interface CareTicketTold {
  service_job_id: string;
  profile_id: string;
}

/** The key one telling is kept under: the ticket, then the person. */
export const toldKey = (ticketId: string, personId: string): string => `${ticketId}|${personId}`;

/** What roof_care_ticket_told_list answers, as a set to look a telling up in. */
export function toldSet(rows: readonly CareTicketTold[] | null | undefined): Set<string> {
  return new Set((rows ?? []).map((r) => toldKey(r.service_job_id, r.profile_id)));
}

/**
 * Who hears which tickets. `watchers`: the people on the tickets' "Each step" line. A ticket's
 * own technician is left out of its "Opened" notice: they hear "Assigned to you" for it instead,
 * as for a ticket a person opens. People with the same tickets share one group (one send).
 *
 * `told` (owner, Nov 20: "go with 4"): who has already heard which ticket, from a run whose
 * notice to them went out while another group's did not. Those tickets are left out for that
 * person, so a retry tells only who has not heard. A person who has heard them all gets nothing.
 */
export function careNoticeGroups(
  tickets: readonly CareTicketToAnnounce[],
  watchers: readonly string[],
  told: ReadonlySet<string> = new Set(),
): { ids: string[]; tickets: CareTicketToAnnounce[] }[] {
  const groups = new Map<string, { ids: string[]; tickets: CareTicketToAnnounce[] }>();
  for (const id of [...new Set(watchers)]) {
    const mine = tickets.filter((t) => t.technician_id !== id && !told.has(toldKey(t.id, id)));
    if (!mine.length) continue;
    const key = mine.map((t) => t.id).join(",");
    const g = groups.get(key);
    if (g) g.ids.push(id);
    else groups.set(key, { ids: [id], tickets: mine });
  }
  return [...groups.values()];
}
