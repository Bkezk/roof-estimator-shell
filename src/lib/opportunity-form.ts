/**
 * The opportunity form's rules that are not layout (owner, Oct 1).
 *
 * - Assignee: required, no default (the office creates opportunities for others). A new
 *   opportunity needs one; an update may leave it out (unchanged) but may not clear it. The
 *   form shows ASSIGNEE_REQUIRED under the box and keeps Create / Save off; saveOpportunity
 *   refuses with the same text.
 * - Customer, site and contact (owner, Oct 2: "require the customer name, address and one
 *   contact and site for an opportunity"): every opportunity names its customer
 *   (OPP_CUSTOMER_REQUIRED) and its site, the way a ticket does (lib/ticket-form.ts siteProblem /
 *   autoSiteId): one site is picked automatically, several must be picked, none must be added
 *   first (OPP_SITE_NEEDED). The customer must be reachable by the customer rule itself
 *   (lib/crm-account.ts hasContactMethod; OPP_CUSTOMER_NO_CONTACT for older data saved before
 *   it). The form keeps Create / Save off and the server (saveOpportunity) refuses the same.
 * - "Start a bid": the /estimate prefill (lib/estimate-search.ts) from the opportunity.
 * - "Start a ticket": /service?new=1&opportunity=<id>; the new-ticket form fills the customer,
 *   the site and the description (ticketSeedFromOpportunity) and the ticket keeps the
 *   opportunity as service_jobs.from_opportunity_id.
 */
import { BID_NOTES_MAX } from "@/lib/inspection";
import type { EstimateSearch } from "@/lib/estimate-search";
import type { ServiceSearch } from "@/lib/service-search";
import { seesEveryone, type AccessLike } from "@/lib/access";

type BidPrefill = Pick<
  EstimateSearch,
  "pfName" | "pfOwner" | "pfAccount" | "pfSite" | "pfNotes" | "opportunity"
>;

export { autoSiteId, siteProblem, siteRequiredMessage } from "@/lib/ticket-form";
import { siteProblem, TICKET_DESCRIPTION_MAX } from "@/lib/ticket-form";

export const ASSIGNEE_REQUIRED = "Pick who follows this up";

/** The problem with an opportunity's assignee, or null. */
export function assigneeProblem(input: {
  id?: string | null | undefined;
  assignee_id?: string | null | undefined;
}): string | null {
  if (input.assignee_id === undefined) return input.id ? null : ASSIGNEE_REQUIRED;
  return input.assignee_id ? null : ASSIGNEE_REQUIRED;
}

export const OPP_CUSTOMER_REQUIRED = "Pick or add the customer";
export const OPP_SITE_NEEDED = "Add a site to this customer first";
/** The customer rule (hasContactMethod) for a customer saved before it (older data). */
export const OPP_CUSTOMER_NO_CONTACT = "This customer needs a phone or an email first";

/**
 * The problem with an opportunity's site, or null: every opportunity has one. Without a
 * customer there is none to pick (OPP_CUSTOMER_REQUIRED); a customer with no live site needs one
 * added; with several, one picked; the only one is the one.
 */
export function opportunitySiteProblem(input: {
  account_id: string | null | undefined;
  site_id: string | null | undefined;
  siteCount: number;
}): string | null {
  if (!input.account_id) return OPP_CUSTOMER_REQUIRED;
  if (input.site_id) return null;
  if (input.siteCount === 0) return OPP_SITE_NEEDED;
  return siteProblem({ siteCount: input.siteCount, site_id: input.site_id });
}

/**
 * The opportunity's customer side, or null: the customer, a way to reach them
 * (`hasContact`: hasContactMethod on the account; null / left out = not known yet), the site.
 */
export function opportunityProblem(input: {
  account_id: string | null | undefined;
  site_id: string | null | undefined;
  siteCount: number;
  hasContact?: boolean | null | undefined;
}): string | null {
  if (!input.account_id) return OPP_CUSTOMER_REQUIRED;
  if (input.hasContact === false) return OPP_CUSTOMER_NO_CONTACT;
  return opportunitySiteProblem(input);
}

/**
 * "Start a bid" (every status): a NEW bid named after the opportunity, its customer (name,
 * linked profile and site, as the inspection hand-off links them) and the description as the
 * bid's notes. Only non-empty values are passed.
 */
export function bidPrefillFromOpportunity(o: {
  /** The opportunity's id: the bid links back to it once saved (`opportunity=`). */
  id?: string;
  title: string;
  account_id: string | null;
  account_name: string | null;
  site_id: string | null;
  description: string | null;
}): BidPrefill {
  const out: BidPrefill = {
    pfName: o.title.trim() || "Untitled bid",
  };
  const owner = (o.account_name ?? "").trim();
  if (owner) out.pfOwner = owner;
  if (o.account_id) {
    out.pfAccount = o.account_id;
    if (o.site_id) out.pfSite = o.site_id;
  }
  const notes = (o.description ?? "").trim();
  if (notes) out.pfNotes = notes.length > BID_NOTES_MAX ? notes.slice(0, BID_NOTES_MAX) : notes;
  // The new bid links back: /estimate writes its id on this opportunity once it is saved
  // (opportunities.functions.ts linkBid; audit, Oct 2: bid_id was never written).
  if (o.id) out.opportunity = o.id;
  return out;
}

/**
 * "Start a ticket" (every status; those who create tickets — managesTickets): a new ticket that
 * carries the opportunity. /service loads it and fills the form (ticketSeedFromOpportunity).
 */
export function ticketPrefillFromOpportunity(o: { id: string }): ServiceSearch {
  return { new: 1, opportunity: o.id };
}

/**
 * The new ticket's description (the opportunity's, else its title; a ticket's description holds
 * TICKET_DESCRIPTION_MAX) and the link back (service_jobs.from_opportunity_id). The customer and
 * the site come from the opportunity the way the Customers page's "New ticket" passes them.
 */
export function ticketSeedFromOpportunity(o: {
  id: string;
  title: string;
  description: string | null;
}): { description: string; from_opportunity_id: string } {
  const text = (o.description ?? "").trim() || o.title.trim();
  return {
    description: text.slice(0, TICKET_DESCRIPTION_MAX),
    from_opportunity_id: o.id,
  };
}

/** The ticket's line under "Opened …". */
export const fromOpportunityLabel = (title: string) => `From opportunity: ${title}`;
/** The opportunity's link to a ticket started from it. */
export const ticketLinkLabel = (n: number) => `Ticket #${n}`;

/**
 * Won / Lost / No response end the follow-up reminders that management relies on, so they are
 * an admin's or a manager's (owner decision, audit Oct 2: a rep could end their own reminders by
 * setting No response or Lost). A rep moves Open → Contacted → Quoted. The twin of the database
 * trigger crm_opportunities_closing_rule (20261002140000_followup_guard.sql).
 */
export const OPP_MANAGER_STATUSES: readonly string[] = ["won", "lost", "no_response"];
export const OPP_STATUS_MANAGER_ONLY =
  "Only a manager can mark an opportunity Won, Lost or No response";

/** May this person set this status? */
export const canSetOppStatus = (p: AccessLike | null | undefined, status: string): boolean =>
  !OPP_MANAGER_STATUSES.includes(status) || seesEveryone(p);

/**
 * The problem with a status change, or null: setting Won / Lost / No response (from any other
 * status, or creating one at it) is a manager's. Keeping the current status is never refused.
 */
export function oppStatusProblem(input: {
  profile: AccessLike | null | undefined;
  from: string | null | undefined;
  to: string | null | undefined;
}): string | null {
  if (!input.to || input.to === input.from) return null;
  return canSetOppStatus(input.profile, input.to) ? null : OPP_STATUS_MANAGER_ONLY;
}

/** The hint under the status select for someone who may not pick the closing statuses. */
export const OPP_STATUS_REP_HINT = "Won, Lost and No response are set by a manager";

/**
 * The line beside "Create opportunity": creating an assigned opportunity starts the assignee's
 * reminders, except at Won / Lost / No response, which start none (audit, Oct 2: the hint
 * promised reminders for a new opportunity created as Won).
 */
export function createReminderHint(input: {
  status: string;
  assignee_id: string | null | undefined;
}): string | null {
  if (!input.assignee_id) return null;
  if (OPP_MANAGER_STATUSES.includes(input.status))
    return "Created at this status, it starts no follow-up reminders.";
  return "Creating it starts the assignee's follow-up reminders.";
}
