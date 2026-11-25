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
  `Pick the property — this customer has ${siteCount}`;

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

/**
 * A ticket that is linked to a customer stays linked (owner, Nov 25: "go with solution A").
 * The customer can be changed to another one, never just taken off. On Nov 25 the form let
 * ticket 6069 be saved after "Change" was pressed and nobody picked: the ticket lost its
 * customer and its property and kept only the old name as text. The form refuses that save
 * and offers the customer back; saveServiceJob refuses it too, in the same words.
 *
 * A ticket from before customer profiles, with a typed name and no customer, is as it was.
 */
export const customerTakenOffMessage = (name: string | null | undefined): string => {
  const who = (name ?? "").trim();
  return who
    ? "Pick a customer before saving. " +
        who +
        " was taken off this ticket and no other customer was picked, so nothing was saved."
    : "Pick a customer before saving. The customer was taken off this ticket and no other was picked, so nothing was saved.";
};

/** The problem with a save that would leave a linked ticket with no customer, or null. */
export function customerTakenOffProblem(
  saved: { account_id: string | null | undefined; customer_name?: string | null },
  next: { account_id: string | null | undefined },
): string | null {
  return saved.account_id && !next.account_id ? customerTakenOffMessage(saved.customer_name) : null;
}

/** The link under the empty search box that puts the ticket's own customer back. */
export const keepCustomerLabel = (name: string | null | undefined): string =>
  "Keep " + ((name ?? "").trim() || "the customer it has");
