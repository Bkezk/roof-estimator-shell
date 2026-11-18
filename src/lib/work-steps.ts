/**
 * "Each step" for opportunities and bids (owner, Nov 18: "each step line should be able to be
 * turned on for opps and bids too but defaulted off for now"). Tickets have told every admin and
 * manager about each step since Nov 17 (ticket-watch.ts); these are the same idea for the other
 * two kinds of work, sent to whoever is listed on that type's "Each step" line on Admin ›
 * Reminders. Nobody is listed until someone picks people there, so nothing is sent until then.
 *
 * A step is: opened (or started, for a bid), given to someone, a new status, or deleted. One
 * notice per change. Pure: the words. The sending is work-steps.server.ts.
 */
export const OPPORTUNITY_WATCH_KIND = "opportunity_watch";
export const BID_WATCH_KIND = "bid_watch";

export interface StepNotice {
  title: string;
  body: string;
}

const OPP_LABELS: Readonly<Record<string, string>> = {
  open: "Open",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
  no_response: "No response",
};
const BID_LABELS: Readonly<Record<string, string>> = {
  draft: "Draft",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
};
const label = (map: Readonly<Record<string, string>>, v: string) => map[v] ?? v;

/** What the follow-up sync did with the opportunity's person (followups.server.ts SyncResult). */
export type PersonChange = "started" | "reassigned" | "closed" | "unchanged" | "snooze_cleared";

/**
 * The notice for one change to an opportunity, or null when it is not a step (a note edited, a
 * date moved). The order is the order of importance: deleted, opened, a new status, then who
 * has it.
 */
export function opportunityStepNotice(input: {
  title: string;
  status: string;
  /** The status before this change; null when it did not change status (or is new). */
  prevStatus: string | null;
  created?: boolean | undefined;
  deleted?: boolean | undefined;
  /** What happened to the person on it, when the caller knows. */
  person?: PersonChange | null | undefined;
  who: string;
  assigneeName: string | null;
}): StepNotice | null {
  const { title, who } = input;
  if (input.deleted) return { title: `Deleted: ${title}`, body: `${who} deleted it.` };
  const has = input.assigneeName ? `Assigned to ${input.assigneeName}.` : "Nobody is assigned yet.";
  if (input.created) return { title: `Opened: ${title}`, body: `${who} opened it. ${has}` };
  if (input.prevStatus && input.prevStatus !== input.status)
    return {
      title: `${label(OPP_LABELS, input.status)}: ${title}`,
      body: `${who} moved it from ${label(OPP_LABELS, input.prevStatus)} to ${label(OPP_LABELS, input.status)}.`,
    };
  if (input.person === "started")
    return {
      title: `Assigned: ${title}`,
      body: `${who} assigned it to ${input.assigneeName ?? "someone"}.`,
    };
  if (input.person === "reassigned")
    return {
      title: `Reassigned: ${title}`,
      body: `${who} gave it to ${input.assigneeName ?? "someone else"}.`,
    };
  // "closed" with no status change and nobody on it: the person was taken off.
  if (input.person === "closed" && !input.assigneeName)
    return {
      title: `Unassigned: ${title}`,
      body: `${who} took the person off it. Nobody is assigned now.`,
    };
  return null;
}

/** The notice for one change to a bid, or null when it is not a step. */
export function bidStepNotice(input: {
  name: string;
  status: string;
  /** The status before this change; null when it did not change status (or is new). */
  prevStatus: string | null;
  created?: boolean | undefined;
  deleted?: boolean | undefined;
  who: string;
}): StepNotice | null {
  const bid = `Bid ${input.name}`;
  if (input.deleted) return { title: `Deleted: ${bid}`, body: `${input.who} deleted it.` };
  if (input.created) return { title: `Started: ${bid}`, body: `${input.who} started it.` };
  if (input.prevStatus && input.prevStatus !== input.status)
    return {
      title: `${label(BID_LABELS, input.status)}: ${bid}`,
      body: `${input.who} marked it ${label(BID_LABELS, input.status)}. It was ${label(BID_LABELS, input.prevStatus)}.`,
    };
  return null;
}
