/**
 * Work Overview's row actions (owner, Oct 15) — the pure rules; the page wires them to the
 * server functions in components/my-work-actions.tsx.
 *
 *   - A task row opens the task in place, in the TaskDialog (`taskOpensInPlace`): its old link
 *     led to the Prospecting map (a bare map for a task without a building — a dead link), so the
 *     map is a small "Open on map" link instead, only for a task that has a building
 *     (`taskMapHref`). Every other kind keeps its link. An unassigned task opens only for an
 *     admin or a manager (getTask refuses everyone else, a ticked office person included): for
 *     anyone else it is plain text with a hint, and Claim when they may (`unassignedTaskHint`).
 *   - A Done tick on a task row (`canEditWorkTask`): for whoever may change the task — the
 *     server's rule (setTaskStatus / saveTask: canSeeTask — the creator, the assignee, an
 *     attendee, or an admin / manager). The page knows a row's assignee, not its creator or
 *     attendees; on this page a plain user's tasks are the ones assigned to them, so the two
 *     rules agree for every row the page lists.
 *   - Drag an assigned ticket or task onto another calendar day to reschedule it (`dropPlan`):
 *     tickets for whoever dispatches (`dispatchesTickets`, the server's rule in
 *     assignServiceJob), tasks for whoever may change the task. Follow-ups, opportunities and
 *     bids are not moved this way; nobody's work is claimed by a drop instead (the aside).
 *   - "Assign to…" on an Unassigned row (`assignPlan`): a ticket to a technician for whoever
 *     dispatches; a task or an opportunity to a user for an admin or a manager (`seesEveryone`,
 *     the server's rule in assignTask / assignOpportunity).
 *   - The Calendar's Unassigned pane (owner, Oct 20) for whoever may act on nobody's work, not
 *     only claimers (`showUnassignedPane`, `paneHint`): a viewer who cannot Claim but may assign
 *     a row drags it onto a day and a small dialog assigns it for that day (`dropAssigns`;
 *     `assignPlan` with the day). Until then the pane showed only for `canClaim` viewers, so an
 *     admin, a manager or an unticked office dispatcher could dispatch from the List alone.
 *   - The toolbar's New ticket / New opportunity links (`newTicketHref`, NEW_OPPORTUNITY_HREF):
 *     from the Calendar the ticket carries the selected day.
 */
import { canClaim, dispatchesTickets, seesEveryone, type AccessLike } from "@/lib/access";
import { dateMoveProblem } from "@/lib/followup-rules";
import { ymdParts, type WorkItem, type WorkKind } from "@/lib/my-work";

/** The signed-in person as the rules read them: role, access, technician, and their id. */
export type Viewer = (AccessLike & { id?: string | null }) | null | undefined;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The row's database id: the part of `key` after "<source>:". */
export const workId = (item: Pick<WorkItem, "key">): string =>
  item.key.slice(item.key.indexOf(":") + 1);

const isTicketKind = (k: WorkKind) => k === "ticket" || k === "inspection";

/**
 * Does the row open in place (the TaskDialog) rather than follow its link? Every task (owner,
 * Oct 15: "every task row opens the task in place"); the map is `taskMapHref`. One exception
 * (Oct 15, later): a task nobody is on opens only for a viewer who sees everyone's tasks — an
 * admin or a manager (`seesEveryone`), the server's rule in getTask (tasks.ts canSeeTask: the
 * creator, the assignee, an attendee, or an admin / manager). Oct 20: until then a viewer who
 * could Claim it (`canClaim`, a ticked office person) got the button too, and getTask refused
 * them ("Claim it first") — a dead button. Now they get the inert row with the hint and Claim,
 * like the office without the tick; an assigned task opens for its assignee as before.
 */
export function taskOpensInPlace(
  item: Pick<WorkItem, "kind" | "unassigned">,
  viewer?: Viewer,
): boolean {
  if (item.kind !== "task") return false;
  if (!item.unassigned) return true;
  return seesEveryone(viewer);
}

/**
 * The muted line under an unassigned task row that does not open (`taskOpensInPlace`): for a
 * viewer who may Claim it (the row shows Claim), and for one who may not (Oct 20: the ticked
 * office person used to get a button that failed; the wording now fits both).
 */
export const UNASSIGNED_TASK_HINT_CLAIM = "Claim it to open it, or ask a manager to assign it";
export const UNASSIGNED_TASK_HINT =
  "Claim it if you are ticked Technician, or ask a manager to assign it";
export const unassignedTaskHint = (canClaimIt: boolean): string =>
  canClaimIt ? UNASSIGNED_TASK_HINT_CLAIM : UNASSIGNED_TASK_HINT;

/** A task's "Open on map" link: its building on the Prospecting map; null without a building. */
export const taskMapHref = (item: Pick<WorkItem, "kind" | "href">): string | null =>
  item.kind === "task" && /[?&]building=/.test(item.href) ? item.href : null;

/**
 * May the viewer change this task (tick it Done, move its day)? An admin or a manager, or its
 * assignee — the page's reading of the server's canSeeTask (see the file comment). A row of any
 * other kind: no.
 */
export function canEditWorkTask(
  item: Pick<WorkItem, "kind" | "assigneeId">,
  viewer: Viewer,
): boolean {
  if (!viewer || item.kind !== "task") return false;
  if (seesEveryone(viewer)) return true;
  return !!viewer.id && !!item.assigneeId && item.assigneeId === viewer.id;
}

/** What `dropPlan` and `assignPlan` read of a row. */
export type ActionIn = Pick<
  WorkItem,
  "key" | "kind" | "date" | "assigneeId" | "unassigned" | "done" | "needsAuth" | "toInvoice"
>;

/**
 * May the viewer drag this row onto another calendar day? Assigned work still to be done only:
 * an Open / Scheduled ticket for whoever dispatches, a task for whoever may change it. Not
 * nobody's work (a drop claims that), not a finished ticket, not one waiting to be authorized or
 * invoiced (the office's queues, not a schedule), and never a follow-up, an opportunity or a bid.
 */
export function canMoveWork(item: ActionIn, viewer: Viewer): boolean {
  if (!viewer || item.unassigned || item.done || item.needsAuth || item.toInvoice) return false;
  if (isTicketKind(item.kind)) return dispatchesTickets(viewer);
  if (item.kind === "task") return canEditWorkTask(item, viewer);
  return false;
}

/**
 * What a drop on a calendar day does: a ticket keeps its technician and takes the day.
 * `expectTechnicianId` (Oct 21, the seventh audit): the technician the row showed — up to five
 * minutes old — which the server must still find on the ticket, or it refuses (TICKET_CHANGED)
 * instead of writing that old technician back over a reassignment made in between.
 */
export type DropPlan =
  | { kind: "ticket"; id: string; technicianId: string; expectTechnicianId: string; date: string }
  | { kind: "task"; id: string; date: string };

/**
 * The move a drop on `day` makes, or null when there is nothing to do (the same day) or the
 * viewer may not (`canMoveWork`). A ticket: assignServiceJob with its technician unchanged and
 * the new day (a date-only move keeps Scheduled and is logged on the ticket), guarded by the
 * technician the row showed (`expectTechnicianId`); a task: moveTaskDate (its time of day kept).
 */
export function dropPlan(item: ActionIn, day: string, viewer: Viewer): DropPlan | null {
  if (!YMD.test(day) || item.date === day || !canMoveWork(item, viewer)) return null;
  const id = workId(item);
  if (isTicketKind(item.kind))
    return item.assigneeId
      ? {
          kind: "ticket",
          id,
          technicianId: item.assigneeId,
          expectTechnicianId: item.assigneeId,
          date: day,
        }
      : null;
  return { kind: "task", id, date: day };
}

export type AssignKind = "ticket" | "task" | "opportunity";

/**
 * Which roster an Unassigned row's "Assign to…" needs, or null when the viewer may not assign
 * it: a ticket's technicians for whoever dispatches (`dispatchesTickets`), a task's or an
 * opportunity's users for an admin or a manager (`seesEveryone`). Only nobody's work: an
 * assigned row has its person.
 */
export function assignKind(item: ActionIn, viewer: Viewer): AssignKind | null {
  if (!viewer || !item.unassigned || item.done) return null;
  if (isTicketKind(item.kind)) return dispatchesTickets(viewer) ? "ticket" : null;
  if (item.kind === "task" || item.kind === "opportunity")
    return seesEveryone(viewer) ? item.kind : null;
  return null;
}

/**
 * What "Assign to…" sends: a ticket keeps its day (assignServiceJob needs one) unless a day is
 * given; a task or an opportunity carries `date` only when a day is given (Oct 20: a drop on a
 * calendar day). An opportunity's `dateKept`: the day was NOT sent because the viewer may not
 * move a stored expected close (followup-rules dateMoveProblem, the rule claimOpportunity
 * applies) — the toast says the date stayed.
 */
export type AssignPlan =
  | { kind: "ticket"; id: string; technicianId: string; date: string | null }
  | { kind: "task"; id: string; assignee: string; date?: string }
  | { kind: "opportunity"; id: string; assignee: string; date?: string; dateKept?: true };

/**
 * The assignment picking `userId` on an Unassigned row makes; null when not allowed. `day`
 * (Oct 20: the row dropped on a calendar day) overrides the item's own date: a ticket is
 * scheduled for it, a task is due on it, an opportunity's expected close becomes it where the
 * viewer may move that date (else `dateKept`).
 */
export function assignPlan(
  item: ActionIn,
  userId: string,
  viewer: Viewer,
  day?: string | null,
): AssignPlan | null {
  const kind = assignKind(item, viewer);
  if (!kind || !userId) return null;
  const onDay = day && YMD.test(day) ? day : null;
  const id = workId(item);
  if (kind === "ticket") return { kind, id, technicianId: userId, date: onDay ?? item.date };
  if (!onDay) return { kind, id, assignee: userId };
  if (kind === "task") return { kind, id, assignee: userId, date: onDay };
  const kept = !!dateMoveProblem({
    profile: viewer,
    oldYmd: item.date,
    newYmd: onDay,
    kind: "opportunity",
  });
  return kept
    ? { kind, id, assignee: userId, dateKept: true }
    : { kind, id, assignee: userId, date: onDay };
}

/**
 * The "Assigned to …" toast (Oct 20): with the day it was dropped on, or — an opportunity whose
 * expected close the viewer may not move — the date that stayed.
 */
export function assignedToast(name: string, day: string | null, kept: string | null): string {
  if (kept) return `Assigned to ${name} — its expected close stays ${monthDay(kept)}`;
  return day ? `Assigned to ${name} for ${monthDay(day)}` : `Assigned to ${name}`;
}

/** The toast's second line when the assigned ticket leaves the viewer's own Work Overview. */
export const ASSIGNED_TICKET_NOTE = "It now shows on the Service board";

/**
 * What the "Assigned to …" toast adds (Oct 20): a dispatcher without the Technician tick sees
 * only their own tickets on Work Overview, so a ticket they just handed out leaves their list at
 * once — the toast says where it went and an "Open" action opens it on the Service board. For
 * whoever sees everyone's work (an admin, a manager) the ticket stays listed under its new
 * person, and a task or an opportunity is listed for them either way: nothing to add.
 */
export function assignedToastExtra(
  viewer: Viewer,
  plan: Pick<AssignPlan, "kind" | "id">,
): { description: string; action: { label: string; href: string } } | null {
  if (plan.kind !== "ticket" || seesEveryone(viewer)) return null;
  return {
    description: ASSIGNED_TICKET_NOTE,
    action: { label: "Open", href: `/service?id=${encodeURIComponent(plan.id)}` },
  };
}

/**
 * Does the Calendar show the Unassigned pane (owner, Oct 20)? For whoever may act on nobody's
 * work: a claimer (`canClaim`) always — their Oct 8 pane, "Nothing waiting." included — and
 * otherwise whoever may assign at least one of the unassigned rows listed (`assignKind`: an
 * admin or a manager any of them, an unticked office dispatcher a ticket). A viewer who can do
 * neither (sales, a technician-only user, the office with only nobody's tasks in the list) has
 * no pane: the List's Unassigned column is where they read it.
 */
export function showUnassignedPane(items: readonly ActionIn[], viewer: Viewer): boolean {
  if (!viewer) return false;
  if (canClaim(viewer)) return true;
  return items.some((i) => !!i.unassigned && assignKind(i, viewer) !== null);
}

export const PANE_HINT_CLAIM =
  "Drag one onto a day to take it and put it there, or Claim to take it as is.";
export const PANE_HINT_ASSIGN = "Drag one onto a day to assign it for that day, or use Assign to.";

/** The pane's helper line: a claimer's drop claims, anyone else's drop assigns (`dropAssigns`). */
export const paneHint = (viewer: Viewer): string =>
  canClaim(viewer) ? PANE_HINT_CLAIM : PANE_HINT_ASSIGN;

/**
 * Does dropping this Unassigned row on a day open the assign dialog (Oct 20)? For a viewer who
 * cannot Claim (a claimer's drop claims it for that day, as since Oct 8) but may assign that
 * kind. A viewer who can do neither does not drag the row at all.
 */
export const dropAssigns = (item: ActionIn, viewer: Viewer): boolean =>
  !canClaim(viewer) && assignKind(item, viewer) !== null;

/** May the viewer drag this Unassigned row from the pane: a claimer, or an assigner of its kind. */
export const dragsFromPane = (item: ActionIn, viewer: Viewer): boolean =>
  canClaim(viewer) || assignKind(item, viewer) !== null;

/** The toolbar's New ticket: a blank ticket, dated on the Calendar's selected day when given. */
export const newTicketHref = (day?: string | null): string =>
  day && YMD.test(day) ? `/service?new=1&date=${day}` : "/service?new=1";

/** The toolbar's New opportunity: a blank one. */
export const NEW_OPPORTUNITY_HREF = "/opportunities?new=1";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 21" for a YYYY-MM-DD day (the "Moved to …" toast). */
export function monthDay(ymd: string): string {
  const [, m, d] = ymdParts(ymd);
  return `${MONTHS[m - 1] ?? "?"} ${d}`;
}

/** The suffix of the move toast when the ticket's follow-up hold ended with the move. */
export const HOLD_ENDED_SUFFIX = " — its hold was ended";

/**
 * The "Moved to …" toast (Oct 20): a held ticket dragged to another day loses its hold —
 * followup_sync_upsert clears snoozed_until on a date move and reports `snooze_cleared` — and
 * until now the drop said nothing about it (assignServiceJob dropped the sync's answer). The
 * drag is not blocked; the toast says what happened: "Moved to Oct 22 — its hold was ended".
 */
export const movedToast = (day: string, snoozeCleared: boolean): string =>
  `Moved to ${monthDay(day)}${snoozeCleared ? HOLD_ENDED_SUFFIX : ""}`;
