/**
 * Work Overview (owner, Sep 30): one list and calendar of a person's own assignable work — service
 * tickets they lead (open / scheduled / done), open tasks assigned to them, their open
 * follow-ups and, since Oct 12, the draft bids they started, by due date (`bidItem`) — merged
 * and sorted by date. Since Oct 12 (owner item 3) whoever invoices
 * (`seesInvoices`) also gets the Authorized tickets, under "Authorized — to invoice"
 * (`toInvoiceItems`; the server sends them only to those viewers). Pure helpers only (no I/O): the server function in
 * my-work.functions.ts reads the rows, the page in components/my-work-page.tsx renders them.
 *
 * "Users should only see their own stuff except for managers who see everything":
 * `visibleUserIds` is the one scoping rule — only admins and managers may ask for someone
 * else's work or everyone's; anyone else always gets their own, whatever they ask for.
 */
import { seesEveryone } from "@/lib/access";
import { asBidStatus, STATUS_LABELS as BID_STATUS_LABELS } from "@/lib/bid-status";

export type WorkKind = "ticket" | "inspection" | "task" | "followup" | "opportunity" | "bid";

export const KIND_LABELS: Record<WorkKind, string> = {
  ticket: "Ticket",
  inspection: "Inspection",
  task: "Task",
  followup: "Follow-up",
  opportunity: "Opportunity",
  // Owner, Oct 12: draft bids by their due date ("so we can also have those show on this week,
  // overdue, etc").
  bid: "Bid",
};

/** Same-day order: tickets, inspections, tasks, follow-ups, opportunities, bids. */
const KIND_ORDER: Record<WorkKind, number> = {
  ticket: 0,
  inspection: 1,
  task: 2,
  followup: 3,
  opportunity: 4,
  bid: 5,
};

/** An open opportunity's status as the row shows it (the Opportunities page's labels). */
const OPP_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  contacted: "Contacted",
  quoted: "Quoted",
};

/**
 * The ticket stages Work Overview lists: Open and Scheduled — the work still to be done. A Done
 * ticket is finished work (owner, Oct 12: the "Done — waiting on the office" group is gone, for
 * everyone): it is not listed at all here; it waits under Needs authorization for every admin and
 * manager (`toAuthorizeItems`), the named authorizer's row being its "Authorize ticket #…"
 * follow-up. Authorized / Invoiced / Closed are the office's, not anyone's to-do (the Authorized
 * ones wait under "Authorized — to invoice" for whoever invoices).
 */
export const WORK_TICKET_STAGES = ["open", "scheduled"] as const;
/**
 * The stages a ticket without a technician is "Unassigned" in (owner, Oct 12): Open or
 * Scheduled — work still to be done, so it needs a person. A Done ticket nobody is on (closed
 * out by the office, or its technician removed) is finished work waiting on the office: never
 * under Unassigned and never flagged overdue there (#6013, #6012, #6002 did) — the same two
 * stages as WORK_TICKET_STAGES.
 */
export const UNASSIGNED_TICKET_STAGES = ["open", "scheduled"] as const;
/**
 * The stage whose tickets wait to be invoiced (owner, Oct 12): listed for whoever sees invoices
 * (`seesInvoices`), under "Authorized — to invoice". Not a reminder timer (accounting is in
 * Sage): the row shows how long it has waited, as the Invoices queue does.
 */
export const TO_INVOICE_STAGE = "authorized";
/**
 * The stage whose tickets wait to be authorized (owner, Oct 12: "make managers able to
 * authorize, apparently they do that sometimes"): listed for every admin and manager
 * (`managesTickets`) under "Needs authorization", whatever `who` asks for — the queue is the
 * office's. The named authorizer (ticket_authorizers()[0]) owns the "Authorize ticket #…"
 * follow-up and its reminders; everyone else sees the ticket row, with how long it has waited.
 */
export const TO_AUTHORIZE_STAGE = "done";

const STAGE_LABELS: Record<string, string> = {
  open: "Open",
  scheduled: "Scheduled",
  done: "Done",
  authorized: "Authorized",
  invoiced: "Invoiced",
  closed: "Closed",
};

// ---- scoping -------------------------------------------------------------------------------

/** What the page asks for: "mine" (default), "all", or one person's profile id. */
export type WorkWho = "mine" | "all" | (string & {});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whose items the caller may receive: their own id, unless they are an admin or a manager — then
 * "all" (everyone's) or the one person they picked. A plain user asking for anyone else still
 * gets only their own.
 */
export function visibleUserIds(
  caller: { id: string; role: string | null | undefined },
  requested?: WorkWho | null,
): string[] | "all" {
  if (!seesEveryone(caller)) return [caller.id];
  if (requested === "all") return "all";
  if (requested && requested !== "mine" && UUID.test(requested)) return [requested];
  return [caller.id];
}

type RoleLike = { role: string | null | undefined; id?: string | null } | null | undefined;

/**
 * Whose work the page shows when the URL names nobody (owner, Oct 1: "default to Everyone"):
 * everyone's for admins and managers (seesEveryone), the caller's own for anyone else — the
 * server ignores `who` for them anyway (visibleUserIds). An explicit ?who=mine still wins.
 */
export const defaultWho = (profile: RoleLike): "mine" | "all" =>
  seesEveryone(profile) ? "all" : "mine";

/**
 * The caller's own id, as a `who`, is "mine" (Oct 20): the Owner view's number on the admin's own
 * row linked ?who=<their id>, which the Show picker has no option for (it lists Mine, Everyone and
 * the other people) — a blank picker and "Someone else".
 */
const ownToMine = (who: string, profile: RoleLike): string =>
  profile?.id && who === profile.id ? "mine" : who;

/** The `who` the page uses: the URL's (the caller's own id reads as Mine), else their default. */
export const resolveWho = (who: string | null | undefined, profile: RoleLike): WorkWho =>
  who ? ownToMine(who, profile) : defaultWho(profile);

/**
 * The `who` to put in the URL: nothing when it is the caller's default, so Everyone is the bare
 * URL for an admin or manager and ?who=mine stays when they pick Mine. Oct 21: nextWorkSearch
 * keeps naming the default when the URL already named it (whoExplicit) — this rule alone is for
 * the remembered layout (rememberWho: nothing remembered means the default).
 */
export const whoParam = (who: string, profile: RoleLike): string | undefined =>
  !who || who === defaultWho(profile) ? undefined : who;

/**
 * The `who` the page can show (Oct 15): "mine", "all" or a person on the roster. A remembered or
 * linked person who is no longer there (deleted, or never one of the roster) rendered a blank
 * Select and "Someone else: …"; once the WHOLE roster is here (`rosterComplete`:
 * MyWorkResult.rosterComplete — work_people answered; Oct 20), such a `who` falls back to the
 * caller's default. Before that, `who` stands: an incomplete roster (work_people failed and
 * technician_options stood in, which lists only Service people) proves nothing about a person
 * who is not on it, and until Oct 20 it forgot a real, remembered person. The caller's own id is
 * "mine" (`ownToMine`).
 */
export function effectiveWho(
  who: string,
  people: readonly { id: string }[],
  profile: RoleLike,
  rosterComplete: boolean,
): WorkWho {
  if (who === "mine" || who === "all") return who;
  const w = ownToMine(who, profile);
  if (w === "mine" || !rosterComplete) return w;
  return people.some((p) => p.id === w) ? w : defaultWho(profile);
}

/** Work Overview's two views (Oct 21: the Owner view moved to its own page, /owner). */
export type WorkViewParam = "list" | "calendar";
/**
 * ?view= as the route reads it: the two views, plus the old "owner" — kept so routes/my-work.tsx
 * can send an old link (/my-work?view=owner, a bookmark) on to /owner (Oct 21). The page
 * never sees it.
 */
export type WorkViewUrl = WorkViewParam | "owner";

/**
 * The search the route writes on the page's own navigations (picking a person, a bucket preset,
 * a month, a view): no default keys — the caller's default `who` (whoParam) and no preset off
 * the List — so Everyone on the List is the bare URL. The view: "list" is dropped as the default
 * ONLY when the URL was silent on the view (`viewExplicit` false; the page then keeps applying
 * the remembered one, landingSearch). Oct 20: an Owner-view link lands with ?view=list explicit,
 * and the first in-page navigation used to drop it — the URL fell silent, landingSearch fell
 * back to the remembered "owner" (or "calendar"), and the admin was bounced off the List. An
 * explicit view stays explicit for the rest of the visit.
 *
 * Oct 21: the same for `who` (`whoExplicit`). The totals row's link lands with ?who=all explicit,
 * and the first in-page navigation dropped it as the default — the URL fell silent on the person,
 * landingSearch read the remembered one, and Everyone turned back into that person. A who the
 * URL named stays named, the caller's default included; the route also names a pick from the
 * Show menu whatever the URL had (Everyone picked while peeking is not remembered on the layout,
 * so the URL has to say it). The bare URL is as it was: silent, so the remembered person applies.
 */
export function nextWorkSearch(
  next: {
    view: WorkViewParam;
    who: string;
    bucket?: BucketPreset | null | undefined;
    month?: string | null | undefined;
  },
  profile: RoleLike,
  viewExplicit: boolean,
  whoExplicit = false,
): { view?: WorkViewParam; who?: string; bucket?: BucketPreset; month?: string } {
  const wp = whoParam(next.who, profile);
  return {
    ...(next.view !== "list" || viewExplicit ? { view: next.view } : {}),
    ...(wp ? { who: wp } : whoExplicit && next.who ? { who: next.who } : {}),
    ...(next.bucket && next.view === "list" ? { bucket: next.bucket } : {}),
    ...(next.month ? { month: next.month } : {}),
  };
}

/**
 * ?view= from the URL, "list" included (Oct 15): an explicit List — the Owner view's number links
 * — must beat the remembered view (work-layout.ts landingSearch), so the route keeps it rather
 * than dropping it as the default. Anything else is no view (the remembered one applies). "owner"
 * is still read (Oct 21) only so the route can redirect the old link.
 */
export const parseViewParam = (v: unknown): WorkViewUrl | undefined =>
  v === "list" || v === "calendar" || v === "owner" ? v : undefined;

// ---- rows in -------------------------------------------------------------------------------

export interface TicketIn {
  id: string;
  number: number;
  customer_name: string;
  site_name: string | null;
  site_address: string | null;
  description: string;
  service_type: string;
  stage: string;
  scheduled_date: string | null;
  technician_id: string | null;
  /** When it was entered (sent for unassigned tickets: the "needs assignment" timer). */
  created_at?: string | null;
  /** When it reached its stage (sent for Authorized tickets: "Waiting N days" to invoice). */
  stage_changed_at?: string | null;
  /** When its close-out was finished (sent for Done tickets: "Waiting N days" to authorize). */
  completed_at?: string | null;
}

export interface TaskIn {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  building_id: string | null;
  assignee: string | null;
  assignee_name: string | null;
  /** The building's name / address, when the caller may read buildings. */
  building_label?: string | null;
  /** The task's company and property (sent for unassigned tasks: their "where"). */
  account_name?: string | null;
  site_name?: string | null;
  /** When it was entered (sent for unassigned tasks: the "needs assignment" timer). */
  created_at?: string | null;
  /**
   * The content stamp (tasks.content_updated_at, 20261020121000) as listed, which a Calendar
   * drag hands back to moveTaskDate (Oct 21, the eighth audit: a task ticked Done in between
   * still had its day moved). Sent for assigned tasks — the ones a drop may move.
   */
  content_updated_at?: string | null;
}

export interface FollowupIn {
  id: string;
  title: string;
  url: string;
  due_at: string;
  status: string;
  kind: string;
  item_id: string;
  assignee_id: string;
  account_name?: string | null;
  /**
   * An opportunity follow-up's opportunity status (open / contacted / quoted; owner, Oct 12: the
   * assigned row read "Open" whatever the status, while an unassigned row showed the real one).
   * Null / absent when unknown: the row reads "Open" as before.
   */
  opportunity_status?: string | null;
  /** Reminder cadence and a running hold (Work Overview's follow-up state line). */
  every_days?: number | null;
  snoozed_until?: string | null;
  /** The hold's record (owner, Oct 9): why, who, how often. */
  hold_reason?: string | null;
  held_by_name?: string | null;
  hold_count?: number | null;
  /** When its last reminder went out (owner, Oct 15: "last reminded Oct 13" on the row). */
  last_reminded_at?: string | null;
}

/** The open follow-up behind a row: its state line, and Snooze / Close for managers. */
export interface WorkFollowup {
  id: string;
  title: string;
  due_at: string;
  status: string;
  every_days: number | null;
  snoozed_until: string | null;
  hold_reason: string | null;
  held_by_name: string | null;
  hold_count: number;
  /** When its last reminder went out (ISO), or null when none has (Oct 15). */
  last_reminded_at: string | null;
}

const workFollowup = (f: FollowupIn): WorkFollowup => ({
  id: f.id,
  title: f.title,
  due_at: f.due_at,
  status: f.status,
  every_days: f.every_days ?? null,
  snoozed_until: f.snoozed_until ?? null,
  hold_reason: f.hold_reason ?? null,
  held_by_name: f.held_by_name ?? null,
  hold_count: f.hold_count ?? 0,
  last_reminded_at: f.last_reminded_at ?? null,
});

/** An open opportunity nobody is assigned to (the Unassigned group; owner, Oct 7). */
export interface OppIn {
  id: string;
  title: string;
  status: string;
  expected_close: string | null;
  account_name?: string | null;
  /** When it was entered: the "needs assignment" timer runs from this day. */
  created_at?: string | null;
}

/**
 * Work nobody is assigned to (owner, Oct 7: "sometimes opportunities are made and are unassigned
 * so can we also have an unassigned group on the work overview list that includes services and
 * opportunities"): tickets without a technician and open opportunities without an assignee. The
 * server sends them to everyone but a technician-only user; they sit in their own group whatever
 * their date, so an unassigned ticket a week overdue is never out of sight (the owner counted
 * three overdue items and saw two: the third had no technician and the list skipped it).
 */
export interface UnassignedRows {
  tickets: TicketIn[];
  opportunities: OppIn[];
  /** Open tasks with no assignee (owner, Oct 9: tasks behave like services here too). */
  tasks?: TaskIn[];
}

/**
 * A draft bid (owner, Oct 12): listed by its due date for the person who made it (created_by);
 * the server sends them only to a caller with Estimate access, and only drafts — a submitted,
 * won or lost bid is not anyone's to-do.
 */
export interface BidIn {
  id: string;
  name: string;
  status: string;
  /** When it must go out (YYYY-MM-DD); null on a bid from before due dates existed → Later. */
  due_date: string | null;
  /** The linked customer (crm_accounts), when known. */
  account_name?: string | null;
  /** Who started it: the row's person. */
  created_by: string | null;
}

export interface WorkRows {
  tickets: TicketIn[];
  tasks: TaskIn[];
  followups: FollowupIn[];
  /** Draft bids with their due date (owner, Oct 12); absent for a caller without Estimate access. */
  bids?: BidIn[] | null;
  /** Display names by profile id (for "Everyone" / another person's view). */
  names?: Record<string, string>;
  unassigned?: UnassignedRows | null;
  /**
   * The Authorized tickets waiting for their invoice (owner, Oct 12): sent only to a viewer who
   * sees invoices, whatever `who` asks for (the queue is the office's, not one person's).
   */
  toInvoice?: TicketIn[] | null;
  /**
   * The Done tickets waiting to be authorized (owner, Oct 12): sent only to an admin or a
   * manager, whatever `who` asks for. A ticket whose Authorize follow-up is among `followups` is
   * listed once, as that follow-up row (`mergeWork`).
   */
  toAuthorize?: TicketIn[] | null;
}

// ---- items ---------------------------------------------------------------------------------

export interface WorkItem {
  /** Unique across sources: `<source>:<id>`. */
  key: string;
  kind: WorkKind;
  title: string;
  /** Customer / property. */
  where: string | null;
  /** The day it belongs to (YYYY-MM-DD, the viewer's local day); null = no date. */
  date: string | null;
  status: string;
  /**
   * Finished on the person's side (a Done ticket): never overdue, and not placed in any group —
   * `bucketOf` gives null and `groupWork` drops it (owner, Oct 12: no Done group).
   */
  done: boolean;
  href: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** The open follow-up timer on this item (a ticket's, or the follow-up row itself). */
  followup: WorkFollowup | null;
  /**
   * Waiting to be authorized, under "Needs authorization" (M9, owner Oct 5): a Done ticket's
   * review timer ("Authorize ticket #…", follow-up kind "invoice"), or — for an admin or a
   * manager who does not hold that timer (owner, Oct 12) — the Done ticket's own row.
   */
  needsAuth?: boolean;
  /** Nobody's yet (a ticket without a technician, an opportunity without an assignee). */
  unassigned?: boolean;
  /** The day an unassigned item was entered (YYYY-MM-DD), for the "needs assignment" timer. */
  since?: string | null;
  /** Flagged overdue: past its day, or unassigned longer than Setup allows (`unassignedOverdue`). */
  flag?: boolean;
  /** An Authorized ticket waiting for its invoice: under "Authorized — to invoice" (Oct 12). */
  toInvoice?: boolean;
  /**
   * When it reached Authorized, or was completed (ISO), for "Waiting N days" (`waitingDays`) on a
   * to-invoice or a Needs authorization row.
   */
  waitingSince?: string | null;
  /**
   * A task's content stamp as listed (TaskIn.content_updated_at; Oct 21, the eighth audit): a
   * drag onto another day sends it back (dropPlan `expectStamp` → moveTaskDate
   * `expect_content_updated_at`), so a task someone changed or ticked Done in between is refused
   * instead of moved. Absent when the row carried none (before 20261020121000 is applied).
   */
  stamp?: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" (or "YYYY-MM") as numbers; a missing part is 1. */
export function ymdParts(ymd: string): [number, number, number] {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return [y, m, d];
}

/** A Date (or a timestamp / YYYY-MM-DD string) as the local day YYYY-MM-DD. */
export function localYmd(d: Date | string): string {
  if (typeof d === "string") {
    if (YMD.test(d)) return d;
    d = new Date(d);
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD plus `n` days (calendar arithmetic, no time zone involved). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymdParts(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(ymd: string): number {
  const [y, m, d] = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** A ticket's type badge: Inspection for an inspection ticket, Ticket otherwise. */
export const ticketKind = (serviceType: string): WorkKind =>
  serviceType === "inspection" ? "inspection" : "ticket";

const joinWhere = (...parts: (string | null | undefined)[]) =>
  parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" · ") || null;

export function ticketItem(
  t: TicketIn,
  names: Record<string, string> = {},
  followup: FollowupIn | null = null,
  toYmd: (iso: string) => string = localYmd,
): WorkItem {
  const what = t.description.trim();
  return {
    key: `ticket:${t.id}`,
    kind: ticketKind(t.service_type),
    title: `#${t.number}${what ? ` ${what}` : ""}`,
    where: joinWhere(t.customer_name, t.site_name, t.site_address),
    // The ticket's day; an undated ticket (from before dates were required) takes its open
    // follow-up's due day, so a row whose state line reads "Overdue 3 days" sits under Overdue,
    // not under Later as undated (owner, Oct 1: "why does this show no date but overdue?").
    date:
      t.scheduled_date ?? (followup && followup.status === "open" ? toYmd(followup.due_at) : null),
    status: STAGE_LABELS[t.stage] ?? t.stage,
    done: t.stage === "done",
    href: `/service?id=${t.id}`,
    assigneeId: t.technician_id,
    assigneeName: t.technician_id ? (names[t.technician_id] ?? null) : null,
    followup: followup ? workFollowup(followup) : null,
    ...(t.stage === TO_INVOICE_STAGE
      ? { toInvoice: true, waitingSince: t.stage_changed_at ?? null }
      : {}),
  };
}

/**
 * Whole days an Authorized ticket has waited for its invoice: from the day it reached the stage
 * to `today` (the viewer's days) — the same number the Invoices queue's Waiting column shows
 * (service-schedule.ts daysSince). Null without a stamp (a row from before 20261006180000).
 */
export function waitingDays(
  since: string | null | undefined,
  today: string,
  toYmd: (iso: string) => string = localYmd,
): number | null {
  if (!since) return null;
  const from = toYmd(since);
  if (!YMD.test(from)) return null;
  const [fy, fm, fd] = ymdParts(from);
  const [ty, tm, td] = ymdParts(today);
  return Math.max(0, Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000));
}

/**
 * The "Authorized — to invoice" rows (owner, Oct 12): the Authorized tickets the server sent to
 * a viewer who sees invoices. Any other stage in the list is ignored (the server filters; this
 * keeps the rule in one place).
 */
export function toInvoiceItems(
  rows: TicketIn[] | null | undefined,
  names: Record<string, string> = {},
  toYmd: (iso: string) => string = localYmd,
): WorkItem[] {
  return (rows ?? [])
    .filter((t) => t.stage === TO_INVOICE_STAGE)
    .map((t) => ticketItem(t, names, null, toYmd))
    .sort(compareWork);
}

/**
 * A Done ticket as a Needs authorization row (owner, Oct 12: every admin and manager sees the
 * queue, not only the named authorizer). Not `done`: the ticket is finished on the technician's
 * side, but authorizing it is this viewer's to-do, so it is placed (under "Needs authorization",
 * whatever its date) rather than dropped. Waiting since its close-out (completed_at), else since
 * it entered the stage. Null for any other stage: the server filters, this keeps the rule here.
 */
export function toAuthorizeItem(
  t: TicketIn,
  names: Record<string, string> = {},
  toYmd: (iso: string) => string = localYmd,
): WorkItem | null {
  if (t.stage !== TO_AUTHORIZE_STAGE) return null;
  return {
    ...ticketItem(t, names, null, toYmd),
    done: false,
    needsAuth: true,
    waitingSince: authorizeWaitingSince(t),
  };
}

/** When a Done ticket started waiting for its authorization: its close-out, else its stage stamp. */
export const authorizeWaitingSince = (
  t: Pick<TicketIn, "completed_at" | "stage_changed_at">,
): string | null => t.completed_at ?? t.stage_changed_at ?? null;

/** The Done tickets the server sent as Needs authorization rows (`toAuthorizeItem`), sorted. */
export function toAuthorizeItems(
  rows: TicketIn[] | null | undefined,
  names: Record<string, string> = {},
  toYmd: (iso: string) => string = localYmd,
): WorkItem[] {
  return (rows ?? [])
    .map((t) => toAuthorizeItem(t, names, toYmd))
    .filter((x): x is WorkItem => x !== null)
    .sort(compareWork);
}

export function taskItem(t: TaskIn, names: Record<string, string> = {}): WorkItem {
  return {
    key: `task:${t.id}`,
    kind: "task",
    title: t.title,
    where: joinWhere(t.account_name, t.site_name, t.building_label),
    date: t.due_date,
    status: t.status === "open" ? "Open" : t.status,
    done: false,
    href: t.building_id ? `/prospect?building=${t.building_id}` : "/prospect",
    assigneeId: t.assignee,
    assigneeName: (t.assignee ? names[t.assignee] : null) ?? t.assignee_name ?? null,
    followup: null,
    // The stamp only when the row has one (Oct 21): a row without it (an older list, a database
    // without 20261020121000) sends no expectation and moves unguarded, as before.
    ...(t.content_updated_at ? { stamp: t.content_updated_at } : {}),
  };
}

/**
 * What an "Authorize ticket #…" follow-up row (kind "invoice") reads as its status (Oct 15): the
 * ticket is Done on the technician's side and waits for the office — "Open" was misleading.
 */
export const AUTHORIZE_FOLLOWUP_STATUS = "Done — to authorize";

export function followupItem(
  f: FollowupIn,
  names: Record<string, string> = {},
  toYmd: (iso: string) => string = localYmd,
): WorkItem {
  return {
    key: `followup:${f.id}`,
    // An opportunity's timer is the opportunity's row on the list (owner, Oct 8: "the
    // opportunity on the work overview doesn't appear as an opportunity it just has a
    // followup badge"); a ticket's timer and the office's "invoice it" timer stay follow-ups.
    kind: f.kind === "opportunity" ? "opportunity" : "followup",
    title: f.title,
    where: joinWhere(f.account_name),
    date: toYmd(f.due_at),
    // An opportunity's row reads its real status (Open / Contacted / Quoted — the Opportunities
    // page's labels, as the Unassigned rows do; owner, Oct 12); a follow-up itself is "Open" —
    // except the office's "Authorize ticket #…" timer (kind "invoice"), whose ticket is Done
    // and waits to be authorized: "Open" read as if the ticket were still open (Oct 15).
    status:
      f.kind === "opportunity"
        ? oppStatusLabel(f.opportunity_status)
        : f.kind === "invoice"
          ? AUTHORIZE_FOLLOWUP_STATUS
          : "Open",
    done: false,
    // Only an in-app path (the follow-up's own link); anything else stays on Work Overview.
    href: f.url.startsWith("/") && !f.url.startsWith("//") ? f.url : "/my-work",
    assigneeId: f.assignee_id,
    assigneeName: names[f.assignee_id] ?? null,
    followup: workFollowup(f),
    ...(f.kind === "invoice" ? { needsAuth: true } : {}),
  };
}

/**
 * A draft bid as a row (owner, Oct 12): its due date is its day (none → Later, like everything
 * else), it opens in the estimator, and its person is whoever started it. Never Unassigned,
 * never Needs authorization, never to-invoice: a plain dated item that is Overdue once its due
 * day has passed. Only a draft: anything else returns null and is not listed.
 */
export function bidItem(b: BidIn, names: Record<string, string> = {}): WorkItem | null {
  if (asBidStatus(b.status) !== "draft") return null;
  return {
    key: `bid:${b.id}`,
    kind: "bid",
    title: b.name,
    where: joinWhere(b.account_name),
    date: b.due_date,
    status: BID_STATUS_LABELS.draft,
    done: false,
    href: `/estimate?bid=${b.id}`,
    assigneeId: b.created_by,
    assigneeName: b.created_by ? (names[b.created_by] ?? null) : null,
    followup: null,
  };
}

/** Every draft among the server's bid rows as items (`bidItem`); the rest are dropped. */
export function bidItems(rows: BidIn[] | null | undefined, names: Record<string, string> = {}) {
  return (rows ?? []).map((b) => bidItem(b, names)).filter((x): x is WorkItem => x !== null);
}

/** An opportunity's status as its row shows it; unknown → "Open" (an open follow-up's default). */
const oppStatusLabel = (status: string | null | undefined): string =>
  status ? (OPP_STATUS_LABELS[status] ?? status) : "Open";

/** An unassigned open opportunity as a row: its expected close is its day. */
export function opportunityItem(o: OppIn, toYmd: (iso: string) => string = localYmd): WorkItem {
  return {
    key: `opportunity:${o.id}`,
    kind: "opportunity",
    title: o.title,
    where: joinWhere(o.account_name),
    date: o.expected_close,
    status: OPP_STATUS_LABELS[o.status] ?? o.status,
    done: false,
    href: `/opportunities?id=${o.id}`,
    assigneeId: null,
    assigneeName: null,
    followup: null,
    unassigned: true,
    since: o.created_at ? toYmd(o.created_at) : null,
  };
}

/** Setup's default for the "needs assignment" timer (crm_settings.unassigned_overdue_days). */
export const UNASSIGNED_OVERDUE_DAYS_DEFAULT = 1;

/**
 * Is nobody's work flagged overdue (owner, Oct 7: "a timer in setup for when needs assignment
 * should get the overdue flag just by nature of being unassigned")? Yes when it is past its own
 * day (a scheduled date or expected close before today), or when it has waited `days` or more
 * days for a person since it was entered: entered Oct 5 with 1 day allowed → flagged from Oct 6;
 * 0 days → the day it is entered.
 */
export function unassignedOverdue(
  item: Pick<WorkItem, "date" | "since" | "unassigned"> & { done?: boolean },
  today: string,
  days: number = UNASSIGNED_OVERDUE_DAYS_DEFAULT,
): boolean {
  // Finished work (a Done ticket) is never overdue, whoever is or is not on it (Oct 12).
  if (!item.unassigned || item.done) return false;
  if (item.date && item.date < today) return true;
  if (!item.since) return false;
  return addDays(item.since, Math.max(0, Math.floor(days))) <= today;
}

/** Every item with its `flag` set: nobody's work past the "needs assignment" timer. */
export function flagUnassigned(items: WorkItem[], today: string, days?: number): WorkItem[] {
  return items.map((i) => (i.unassigned ? { ...i, flag: unassignedOverdue(i, today, days) } : i));
}

/**
 * The Unassigned group's rows: tickets without a technician, open opportunities without an
 * assignee, and open tasks without one (owner, Oct 9: "add them to the work overview and lists
 * with the same behavior as services").
 */
export function unassignedItems(
  rows: UnassignedRows | null | undefined,
  toYmd: (iso: string) => string = localYmd,
): WorkItem[] {
  if (!rows) return [];
  // Open / Scheduled only (UNASSIGNED_TICKET_STAGES): a Done ticket nobody is on is not nobody's
  // to-do — it is finished, waiting on the office (owner, Oct 12).
  const tickets = rows.tickets
    .filter(
      (t) => (UNASSIGNED_TICKET_STAGES as readonly string[]).includes(t.stage) && !t.technician_id,
    )
    .map((t) => ({
      ...ticketItem(t, {}, null, toYmd),
      unassigned: true,
      since: t.created_at ? toYmd(t.created_at) : null,
    }));
  const opps = rows.opportunities.map((o) => opportunityItem(o, toYmd));
  const tasks = (rows.tasks ?? [])
    .filter((t) => t.status === "open" && !t.assignee)
    .map((t) => ({
      ...taskItem(t),
      unassigned: true,
      since: t.created_at ? toYmd(t.created_at) : null,
    }));
  return [...tickets, ...opps, ...tasks].sort(compareWork);
}

/** Date first (no date last), then tickets → inspections → tasks → follow-ups, then title. */
export function compareWork(a: WorkItem, b: WorkItem): number {
  if (a.date !== b.date) {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  }
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title);
}

/**
 * Every row as one sorted list. A ticket's follow-up timer is dropped when that ticket is already
 * on the list for the same person: the ticket row carries it (its state line, Snooze / Close).
 * Only Open / Scheduled tickets are listed (WORK_TICKET_STAGES): a Done ticket is finished work
 * (owner, Oct 12: no Done group), so a row the server still sends in that stage is dropped here;
 * under Needs authorization it shows once — as its open "Authorize ticket #…" follow-up (kind
 * "invoice") when that row is among the viewer's follow-ups (the named authorizer's row, with
 * Snooze / Close and the reminder line), else as the Done ticket row the server sent an admin or
 * manager in `toAuthorize` (owner, Oct 12: managers authorize too).
 */
export function mergeWork(rows: WorkRows, toYmd: (iso: string) => string = localYmd): WorkItem[] {
  const names = rows.names ?? {};
  const listedTickets = rows.tickets.filter((t) =>
    (WORK_TICKET_STAGES as readonly string[]).includes(t.stage),
  );
  const ticketTimers = new Map<string, FollowupIn>();
  for (const f of rows.followups)
    if (f.kind === "ticket" && f.status === "open")
      ticketTimers.set(`${f.item_id}|${f.assignee_id}`, f);
  const tickets = listedTickets.map((t) =>
    ticketItem(t, names, ticketTimers.get(`${t.id}|${t.technician_id ?? ""}`) ?? null, toYmd),
  );
  const listed = new Set(listedTickets.map((t) => `${t.id}|${t.technician_id ?? ""}`));
  const tasks = rows.tasks.filter((t) => t.status !== "done").map((t) => taskItem(t, names));
  const followups = rows.followups
    .filter((f) => f.status === "open")
    .filter((f) => !(f.kind === "ticket" && listed.has(`${f.item_id}|${f.assignee_id}`)))
    .map((f) => followupItem(f, names, toYmd));
  // Unassigned work comes separately and never doubles an assigned row (a ticket or a task is
  // either somebody's or nobody's).
  const assignedKeys = new Set([...tickets, ...tasks].map((t) => t.key));
  const unassigned = unassignedItems(rows.unassigned, toYmd).filter(
    (u) => !assignedKeys.has(u.key),
  );
  // The Authorized tickets waiting for their invoice (owner, Oct 12), for whoever invoices; a
  // ticket already on the list (a manager who is also its technician) is listed once.
  const seen = new Set([...assignedKeys, ...unassigned.map((u) => u.key)]);
  const toInvoice = toInvoiceItems(rows.toInvoice, names, toYmd).filter((t) => !seen.has(t.key));
  // The Done tickets waiting to be authorized (owner, Oct 12), for every admin and manager. One
  // row per ticket: its Authorize follow-up when that is listed (the named authorizer's row —
  // Snooze / Close, the reminder line — which then also says how long the ticket has waited),
  // else the ticket row itself.
  const authorizeTimer = new Map<string, string>();
  for (const f of rows.followups)
    if (f.kind === "invoice" && f.status === "open")
      authorizeTimer.set(f.item_id, `followup:${f.id}`);
  const waitingByTimer = new Map<string, string | null>();
  const toAuthorize: WorkItem[] = [];
  for (const t of rows.toAuthorize ?? []) {
    const item = toAuthorizeItem(t, names, toYmd);
    if (!item) continue;
    const timerKey = authorizeTimer.get(t.id);
    if (timerKey) waitingByTimer.set(timerKey, item.waitingSince ?? null);
    else if (!seen.has(item.key)) toAuthorize.push(item);
  }
  const followupsOut = followups.map((i) =>
    waitingByTimer.has(i.key) ? { ...i, waitingSince: waitingByTimer.get(i.key) ?? null } : i,
  );
  // Draft bids by due date (owner, Oct 12), for a caller with Estimate access; the server
  // already scoped them to the viewer's people (created_by).
  const bids = bidItems(rows.bids, names);
  return [
    ...tickets,
    ...tasks,
    ...followupsOut,
    ...unassigned,
    ...toInvoice,
    ...toAuthorize,
    ...bids,
  ].sort(compareWork);
}

// ---- grouping ------------------------------------------------------------------------------

export type WorkBucket =
  "unassigned" | "authorize" | "invoice" | "overdue" | "today" | "week" | "later" | "waiting";

export const BUCKET_LABELS: Record<WorkBucket, string> = {
  // Owner, Oct 7: nobody's work first — it needs a person before it needs a date.
  unassigned: "Unassigned",
  // M9 (owner, Oct 5): "a Needs authorization tab on the work overview page".
  authorize: "Needs authorization",
  // Owner, Oct 12 (item 3): the Authorized tickets, for whoever invoices; no reminder timer.
  invoice: "Authorized — to invoice",
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  // Owner, Oct 9: a held follow-up (snoozed_until ahead) waits here, out of Overdue / This week.
  waiting: "Waiting",
};

/**
 * What each column holds, in one or two plain sentences (owner, Oct 12): the ⓘ beside every
 * column title and every empty-column chip shows it (the page's BucketHelp tooltip).
 */
export const BUCKET_HELP: Record<WorkBucket, string> = {
  // Oct 15: tasks too (they have sat here since Oct 9). Oct 20: role-neutral — only people
  // ticked Technician can Claim (canClaim); everyone else puts someone on it with Assign to.
  unassigned:
    "Tickets, tasks and opportunities with nobody on them yet. Claim one if you are ticked Technician, or put someone on it with Assign to; they turn red after the number of days set on Admin › Reminders.",
  // Oct 20: every kind bucketOf puts here (tasks and follow-ups were missing), by its day.
  overdue:
    "Tickets, tasks, follow-ups, opportunities and draft bids past their day. The assignee is reminded on the Reminders schedule.",
  today: "Due today.",
  // Oct 20: today's items sit here too (Today is folded into This week), opportunities as well.
  week: "Due today or later this week: tickets, tasks, follow-ups, opportunities and draft bids.",
  // Owner, Oct 12: no "No date" group — an undated item (from before dates were required) sits here.
  later: "Due after this week, or with no date yet (a bid without a due date too).",
  waiting:
    "Follow-ups on hold until a date — a manager's Snooze, or a logged contact with “They asked to try again on”. Reminders pause until then, and the item comes back with a “Back from hold” badge.",
  // Owner, Oct 12: "make managers able to authorize" — every admin and manager sees the queue.
  authorize:
    "Tickets the technician has completed. Any admin or manager can review the close-out and mark them Authorized; the named authorizer gets the reminders.",
  invoice:
    "Authorized tickets waiting for an invoice, with how long they have waited. Shown to the people who invoice.",
};

// Owner, Oct 7: "Unassigned, overdue, this week, later, needs authorization, no date, and Done";
// Oct 9: Waiting after Later; Oct 12: "Authorized — to invoice" right after Needs authorization
// (the next step of the same flow); the "No date" group removed — tickets require a date,
// opportunities default an expected close and tasks get a date and time, so it was nearly always
// empty; an undated item sits under Later — and the "Done — waiting on the office" group removed
// for everyone: a Done ticket is finished work, not listed (its authorizer sees it under Needs
// authorization through its Authorize follow-up).
const BUCKET_ORDER: WorkBucket[] = [
  "unassigned",
  "overdue",
  "today",
  "week",
  "later",
  "waiting",
  "authorize",
  "invoice",
];
/**
 * The List's groups (owner, Oct 6: "get rid of the today section in the work overview list,
 * instead just keep the this week and sort it by due first"): no Today — what is due today sits
 * at the top of This week (`compareWork` sorts by date). `bucketOf` still tells today apart for
 * the Owner view's Due today column.
 */
export const LIST_BUCKETS: WorkBucket[] = BUCKET_ORDER.filter((b) => b !== "today");

/** What `bucketOf` reads of an item (the follow-up only for a running hold). */
export type BucketIn = Pick<
  WorkItem,
  "date" | "done" | "needsAuth" | "unassigned" | "toInvoice"
> & {
  followup?: Pick<WorkFollowup, "status" | "snoozed_until"> | null;
};

/**
 * The List's bucket for an item: `bucketOf`, with today folded into This week; null for a finished
 * (Done) item, which the List drops.
 */
export const listBucketOf = (
  item: BucketIn,
  today: string,
  toYmd: (iso: string) => string = localYmd,
): WorkBucket | null => {
  const b = bucketOf(item, today, toYmd);
  return b === "today" ? "week" : b;
};

/**
 * Is the item's follow-up on hold on `today` (its snoozed_until falls on a later day, the
 * viewer's days)? On the hold's own day it is back: the morning reminder fires that day.
 */
export const isHeldOn = (
  f: Pick<WorkFollowup, "status" | "snoozed_until"> | null | undefined,
  today: string,
  toYmd: (iso: string) => string = localYmd,
): boolean => !!f && f.status === "open" && !!f.snoozed_until && toYmd(f.snoozed_until) > today;

/** The Saturday that ends `today`'s week (weeks run Sunday to Saturday, like the calendar). */
export const endOfWeek = (today: string) => addDays(today, 6 - weekday(today));

/**
 * Where an item sits relative to `today` (YYYY-MM-DD): before today = Overdue; today; later this
 * week (through Saturday); Later (an item with no date too — owner, Oct 12: no "No date" group).
 * A Done ticket is finished work, never overdue and in no group at all — null (owner, Oct 12: no
 * "Done — waiting on the office" group; item 11: "overdue" means an Open / Scheduled ticket past
 * its day — the one rule, with work-counts.ts isOverdueTicket). An Authorized ticket waits under
 * "Authorized — to invoice", whatever its date. A follow-up on hold (owner, Oct 9: snoozed_until
 * ahead of today) waits under Waiting whatever its date, so a held item is never counted overdue
 * while it waits.
 */
export function bucketOf(
  item: BucketIn,
  today: string,
  toYmd: (iso: string) => string = localYmd,
): WorkBucket | null {
  // A Done ticket is finished work, whoever is or is not on it (owner, Oct 12: Done tickets with
  // no technician sat under Unassigned, flagged overdue): finished before Unassigned, and placed
  // nowhere.
  if (item.done) return null;
  // Nobody's work sits under Unassigned whatever its date (overdue or not): the fix is a person.
  if (item.unassigned) return "unassigned";
  if (item.needsAuth) return "authorize";
  if (item.toInvoice) return "invoice";
  if (isHeldOn(item.followup, today, toYmd)) return "waiting";
  if (!item.date) return "later";
  if (item.date < today) return "overdue";
  if (item.date === today) return "today";
  if (item.date <= endOfWeek(today)) return "week";
  return "later";
}

export interface WorkGroup {
  bucket: WorkBucket;
  label: string;
  items: WorkItem[];
}

/**
 * The List view: non-empty groups in order, each sorted by `compareWork` (due first). A finished
 * (Done) item has no group and is left out.
 */
export function groupWork(
  items: WorkItem[],
  today: string,
  toYmd: (iso: string) => string = localYmd,
): WorkGroup[] {
  const by = new Map<WorkBucket, WorkItem[]>();
  for (const it of items) {
    const b = listBucketOf(it, today, toYmd);
    if (!b) continue;
    const list = by.get(b) ?? [];
    list.push(it);
    by.set(b, list);
  }
  return LIST_BUCKETS.filter((b) => by.has(b)).map((b) => ({
    bucket: b,
    label: BUCKET_LABELS[b],
    items: [...(by.get(b) ?? [])].sort(compareWork),
  }));
}

/**
 * The List's headings (owner, Oct 1: "how many sub headings are there? I see Later and No date
 * only"): every List group, always, in the same order — an empty one shows "(0)" and this line.
 * (Five since Oct 6: Today is folded into This week; six since Oct 9: Waiting; four since Oct 12:
 * the No date group is gone, an undated item sits under Later, and so is the Done group — a Done
 * ticket is not listed.)
 */
export const BUCKET_EMPTY: Record<WorkBucket, string> = {
  unassigned: "Everything has someone on it.",
  authorize: "Nothing waiting for your review.",
  invoice: "Nothing waiting to be invoiced.",
  overdue: "Nothing overdue.",
  today: "Nothing due today.",
  week: "Nothing due this week.",
  later: "Nothing scheduled later.",
  waiting: "Nothing on hold.",
};

/**
 * The List groups in order, empty ones included, each sorted by `compareWork`. "Unassigned" comes
 * first, for everyone but a technician-only user (`opts.unassigned`; owner, Oct 7) or when
 * something is in it; "Needs authorization" next, only for whoever authorizes — every admin and
 * manager since Oct 12 (`opts.authorize`) — or when something is in it;
 * "Authorized — to invoice" only for whoever sees invoices (`opts.invoice`) or when something is
 * in it — everyone else never has the column, not even among the layout's hidden chips.
 */
export function listGroups(
  items: WorkItem[],
  today: string,
  opts: {
    authorize?: boolean;
    invoice?: boolean;
    unassigned?: boolean;
    toYmd?: (iso: string) => string;
  } = {},
): WorkGroup[] {
  const filled = new Map(groupWork(items, today, opts.toYmd).map((g) => [g.bucket, g]));
  return LIST_BUCKETS.filter((b) =>
    b === "authorize"
      ? opts.authorize || filled.has("authorize")
      : b === "invoice"
        ? opts.invoice || filled.has("invoice")
        : b === "unassigned"
          ? opts.unassigned || filled.has("unassigned")
          : true,
  ).map((b) => filled.get(b) ?? { bucket: b, label: BUCKET_LABELS[b], items: [] });
}

/**
 * The fold (owner, Oct 12: "9 columns, most empty"): a group with nothing in it is not a column
 * but a small "Label 0" chip in one row above the columns, in the groups' order; the groups with
 * items stay columns. `keep` (the ?bucket= preset's bucket) stays a column even when empty, so
 * the preset has a column to ring and a tab to open. Pure: the layout (order, hidden) is
 * untouched — a hidden column is out entirely and listed among the "Hidden" chips, never here.
 */
export function splitEmptyGroups<T extends { bucket: WorkBucket; items: unknown[] }>(
  groups: T[],
  keep: WorkBucket | null = null,
): { columns: T[]; empty: T[] } {
  const columns: T[] = [];
  const empty: T[] = [];
  for (const g of groups) (g.items.length > 0 || g.bucket === keep ? columns : empty).push(g);
  return { columns, empty };
}

/** A List preset from the URL (?bucket=today|overdue — the Owner view's links). */
export type BucketPreset = "today" | "overdue";

/**
 * ?month=YYYY-MM: the Calendar's month (owner, Oct 15: remembered while switching List and
 * Calendar and through the browser's back button — in the URL, not on the profile, where last
 * week's month would be wrong). Anything else is no month (the current one).
 */
export const parseMonthParam = (v: unknown): string | undefined =>
  typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : undefined;

export const parseBucketPreset = (v: unknown): BucketPreset | undefined =>
  v === "today" || v === "overdue" ? v : undefined;

/** The List bucket a preset opens: the Owner view's "Due today" link lands on This week. */
export const presetBucket = (preset: BucketPreset): WorkBucket =>
  preset === "today" ? "week" : preset;

/** The List's groups under a preset: only that bucket's group (none when it is empty). */
export function presetGroups(groups: WorkGroup[], preset?: BucketPreset | null): WorkGroup[] {
  return preset ? groups.filter((g) => g.bucket === presetBucket(preset)) : groups;
}

/**
 * The List's headings run across the top (owner, Oct 1: "the categories horizontally across the
 * top instead of vertically"); one is selected and its items show below. The tab to start on:
 * the preset (?bucket=, the Owner view's links) when there is one, else the first group in
 * order with anything in it (Overdue before This week…), else This week.
 */
export function defaultBucket(
  groups: ReadonlyArray<{ bucket: WorkBucket; items: unknown[] }>,
  preset?: BucketPreset | null,
): WorkBucket {
  if (preset) return presetBucket(preset);
  return groups.find((g) => g.items.length > 0)?.bucket ?? "week";
}

/**
 * The phone's selected tab (Oct 20): the one the person picked while it is still among the
 * columns, else the default (`defaultBucket`). A pick outlives its group — the last item of the
 * picked group gets done or claimed and the fold (`splitEmptyGroups`) drops the column — and
 * until now the stale pick left no tab selected and the panel labelled by a tab that was gone.
 */
export function activeTab(
  columns: ReadonlyArray<{ bucket: WorkBucket; items: unknown[] }>,
  picked: WorkBucket | null,
  preset?: BucketPreset | null,
): WorkBucket {
  if (picked && columns.some((c) => c.bucket === picked)) return picked;
  return defaultBucket(columns, preset);
}

/**
 * The phone's pick when the preset changes (Oct 20): a NEW preset — an Owner-view link while
 * already on the page — wins over an earlier pick, so the pick is dropped; the preset going away
 * is the person's own tap (`pick` clears it through the URL), so their pick stands. Until now any
 * change reset the pick, the tap included, and the tab fell to the first non-empty column.
 *
 * Oct 21 (the eighth audit): the preset also goes away on a Show tick (kindToggleClearsPreset),
 * with no tap and so no pick — and nothing picked, nothing preset, meant the first non-empty
 * column: ?bucket=today sat on This week, a kind was ticked off, and the tab jumped to Overdue.
 * With no pick of their own, the preset's own column (`presetBucket`: Today folds into This week)
 * becomes the pick, so the tab stays where it was; activeTab still falls back should that column
 * have folded away.
 */
export function nextPicked(
  prevPreset: BucketPreset | null,
  preset: BucketPreset | null,
  picked: WorkBucket | null,
): WorkBucket | null {
  if (preset !== null) return preset !== prevPreset ? null : picked;
  return picked ?? (prevPreset ? presetBucket(prevPreset) : null);
}

// ---- calendar ------------------------------------------------------------------------------

/**
 * The month grid for `month` ("YYYY-MM"): whole weeks, Sunday first, days of the neighbouring
 * months included so every row has seven days.
 */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const start = addDays(first, -weekday(first));
  const [y, m] = ymdParts(month);
  const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  const weeks: string[][] = [];
  for (let d = start; d < nextFirst; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  }
  return weeks;
}

/** "YYYY-MM" shifted by `n` months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = ymdParts(month);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

/** Items by day (dated items only). */
export function itemsByDay(items: WorkItem[]): Map<string, WorkItem[]> {
  const m = new Map<string, WorkItem[]>();
  for (const it of items) {
    if (!it.date) continue;
    const list = m.get(it.date) ?? [];
    list.push(it);
    m.set(it.date, list);
  }
  return m;
}

/**
 * Is a past calendar day red (Oct 15)? Only when something on it is truly overdue — in the Overdue
 * group (`listBucketOf`): an Open / Scheduled ticket, a task, a follow-up, an opportunity or a
 * draft bid past its day. The other dated work on a past day still APPEARS in the cell (it is
 * dated, and the day's list shows it) but never colours it: a Done ticket waiting to be
 * authorized (needsAuth; its day is the day it was done), an Authorized ticket waiting for its
 * invoice (toInvoice) and a follow-up on hold (Waiting). Nobody's work on a past day IS red
 * (owner, Oct 15: unowned and late is the worst case; its row carries the Overdue flag too).
 * Before this the cell read `d < today && some(!done)`, so a month of finished work was a month
 * of red days.
 */
export function dayIsOverdue(
  list: readonly BucketIn[],
  day: string,
  today: string,
  toYmd: (iso: string) => string = localYmd,
): boolean {
  if (!(day < today)) return false;
  return list.some((i) => {
    const b = listBucketOf(i, today, toYmd);
    return b === "overdue" || (b === "unassigned" && !i.done);
  });
}

/** A calendar day shows at most this many items, then "+N more" (owner, Oct 1). */
export const CALENDAR_CELL_MAX = 5;

/** A day's items for its calendar cell: the first `max`, and how many more there are. */
export function cellItems<T>(list: T[], max: number = CALENDAR_CELL_MAX) {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}

/** A person's initials chip: "Bob Smith" → "BS", "Cher" → "C", "Mary Jo van Dyke" → "MD". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.charAt(0) ?? "";
  const last = words.length > 1 ? (words.at(-1)?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
