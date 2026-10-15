/**
 * Work Overview's row actions (owner, Oct 15) — the pure rules; the page wires them to the
 * server functions in components/my-work-actions.tsx.
 *
 *   - A task row opens the task in place, in the TaskDialog (`taskOpensInPlace`): its old link
 *     led to the Prospecting map (a bare map for a task without a building — a dead link), so the
 *     map is a small "Open on map" link instead, only for a task that has a building
 *     (`taskMapHref`). Every other kind keeps its link. An unassigned task for someone who can
 *     neither Claim nor assign it does not open (getTask would refuse): plain text with a hint.
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
 *   - The toolbar's New ticket / New opportunity links (`newTicketHref`, NEW_OPPORTUNITY_HREF):
 *     from the Calendar the ticket carries the selected day.
 */
import { canClaim, dispatchesTickets, seesEveryone, type AccessLike } from "@/lib/access";
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
 * (Oct 15, later): a task nobody is on, for a viewer who can neither Claim it (`canClaim`) nor
 * assign it (`seesEveryone`) — an office or sales user without the Technician tick. getTask
 * refuses them ("Claim it first"), so the button was a dead end: the row is plain text with a
 * hint instead (`UNASSIGNED_TASK_HINT`). Every other task — an admin's, a manager's, a ticked
 * office person's, or an assigned task for its assignee — opens as before.
 */
export function taskOpensInPlace(
  item: Pick<WorkItem, "kind" | "unassigned">,
  viewer?: Viewer,
): boolean {
  if (item.kind !== "task") return false;
  if (!item.unassigned) return true;
  return canClaim(viewer) || seesEveryone(viewer);
}

/** The muted line under an unassigned task row that does not open (`taskOpensInPlace`). */
export const UNASSIGNED_TASK_HINT = "Claim it, or ask a manager to assign it";

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

/** What a drop on a calendar day does: a ticket keeps its technician and takes the day. */
export type DropPlan =
  | { kind: "ticket"; id: string; technicianId: string; date: string }
  | { kind: "task"; id: string; date: string };

/**
 * The move a drop on `day` makes, or null when there is nothing to do (the same day) or the
 * viewer may not (`canMoveWork`). A ticket: assignServiceJob with its technician unchanged and
 * the new day (a date-only move keeps Scheduled and is logged on the ticket); a task:
 * moveTaskDate (its time of day kept).
 */
export function dropPlan(item: ActionIn, day: string, viewer: Viewer): DropPlan | null {
  if (!YMD.test(day) || item.date === day || !canMoveWork(item, viewer)) return null;
  const id = workId(item);
  if (isTicketKind(item.kind))
    return item.assigneeId
      ? { kind: "ticket", id, technicianId: item.assigneeId, date: day }
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

/** What "Assign to…" sends: a ticket keeps its day (assignServiceJob needs one). */
export type AssignPlan =
  | { kind: "ticket"; id: string; technicianId: string; date: string | null }
  | { kind: "task"; id: string; assignee: string }
  | { kind: "opportunity"; id: string; assignee: string };

/** The assignment picking `userId` on an Unassigned row makes; null when not allowed. */
export function assignPlan(item: ActionIn, userId: string, viewer: Viewer): AssignPlan | null {
  const kind = assignKind(item, viewer);
  if (!kind || !userId) return null;
  const id = workId(item);
  if (kind === "ticket") return { kind, id, technicianId: userId, date: item.date };
  return { kind, id, assignee: userId };
}

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
