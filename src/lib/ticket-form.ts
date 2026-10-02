/**
 * The ticket form's rules that are not layout (owner, Oct 1). A ticket names its site: a
 * customer with more than one live site must have one picked before the ticket is created or
 * saved (the form shows the message under the site box and keeps Create / Save off; the server,
 * saveServiceJob, refuses with the same text). A customer with exactly one site gets it picked
 * automatically.
 */

/** A ticket's description holds this many characters (saveServiceJob's schema). */
export const TICKET_DESCRIPTION_MAX = 500;

/** The line beside Create ticket: what stage a new ticket gets. */
export const TICKET_STAGE_HINT = "Scheduled once a technician is set, otherwise Open.";

export const siteRequiredMessage = (siteCount: number) =>
  `Pick the site — this customer has ${siteCount}`;

/** The problem with a ticket's site, or null. `siteCount` = the customer's live sites. */
export function siteProblem(input: {
  siteCount: number;
  site_id: string | null | undefined;
}): string | null {
  if (input.site_id) return null;
  return input.siteCount > 1 ? siteRequiredMessage(input.siteCount) : null;
}

/** The site to pick without asking: the only one, else none. */
export function autoSiteId(sites: readonly { id: string }[]): string | null {
  return sites.length === 1 ? sites[0]!.id : null;
}
