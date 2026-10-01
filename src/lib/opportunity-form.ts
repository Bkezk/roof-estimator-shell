/**
 * The opportunity form's rules that are not layout (owner, Oct 1).
 *
 * - Assignee: required, no default (the office creates opportunities for others). A new
 *   opportunity needs one; an update may leave it out (unchanged) but may not clear it. The
 *   form shows ASSIGNEE_REQUIRED under the box and keeps Create / Save off; saveOpportunity
 *   refuses with the same text.
 * - Site: the customer stays optional (a prospect may not be a customer yet), but once a
 *   customer is set the opportunity names the site the way a ticket does (lib/ticket-form.ts
 *   siteProblem / autoSiteId): one site is picked automatically, several must be picked.
 * - "Start a bid": the /estimate prefill (lib/estimate-search.ts) from the opportunity.
 */
import { BID_NOTES_MAX } from "@/lib/inspection";
import type { EstimateSearch } from "@/lib/estimate-search";

export { autoSiteId, siteProblem, siteRequiredMessage } from "@/lib/ticket-form";
import { siteProblem } from "@/lib/ticket-form";

export const ASSIGNEE_REQUIRED = "Pick who follows this up";

/** The problem with an opportunity's assignee, or null. */
export function assigneeProblem(input: {
  id?: string | null | undefined;
  assignee_id?: string | null | undefined;
}): string | null {
  if (input.assignee_id === undefined) return input.id ? null : ASSIGNEE_REQUIRED;
  return input.assignee_id ? null : ASSIGNEE_REQUIRED;
}

/**
 * The problem with an opportunity's site, or null: none without a customer; with one, a
 * customer with several live sites needs one picked.
 */
export function opportunitySiteProblem(input: {
  account_id: string | null | undefined;
  site_id: string | null | undefined;
  siteCount: number;
}): string | null {
  if (!input.account_id) return null;
  return siteProblem({ siteCount: input.siteCount, site_id: input.site_id });
}

/**
 * "Start a bid" (every status): a NEW bid named after the opportunity, its customer (name,
 * linked profile and site, as the inspection hand-off links them) and the description as the
 * bid's notes. Only non-empty values are passed.
 */
export function bidPrefillFromOpportunity(o: {
  title: string;
  account_id: string | null;
  account_name: string | null;
  site_id: string | null;
  description: string | null;
}): Pick<EstimateSearch, "pfName" | "pfOwner" | "pfAccount" | "pfSite" | "pfNotes"> {
  const out: Pick<EstimateSearch, "pfName" | "pfOwner" | "pfAccount" | "pfSite" | "pfNotes"> = {
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
  return out;
}
