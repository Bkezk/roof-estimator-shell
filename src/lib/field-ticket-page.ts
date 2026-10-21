/**
 * The technician-only user's ticket page (owner, Oct 21, after testing as the technician-only
 * login): a FIELD page. The stage is text — no picker (Done comes from the close-out, Open /
 * Scheduled from the office); the customer, property, contact, description, PO # / Job #, type,
 * day and arrival are plain text; Notes stay theirs to edit; every field section (the clock,
 * inspection, repairs, materials, photos, purchase orders, close-out, History at this property,
 * Timeline) stays as it was. The office, managers, admins and a technician who also holds office
 * pages see no change (owner, Oct 8: the office keeps full visibility when ticked Technician).
 *
 * The same login's Tickets list and Tech Board send them to My tickets, the Service tabs row is
 * not shown to them, and a "field-only" decision never defaults open while the profile is still
 * loading (isFieldOnly(null) is false): `isFieldTicketPage` is true with no profile.
 */
import { isFieldOnly, type AccessLike } from "@/lib/access";
import type { ServiceJobInput, ServiceJobRow, ServiceType } from "@/lib/service.functions";
import { SERVICE_TYPES } from "@/lib/service.functions";

/**
 * Is this ticket page the field page? A saved ticket (a technician-only user never creates
 * one) read by a technician-only user — or by nobody known yet: until the profile is here the
 * office's controls stay away rather than flash.
 */
export const isFieldTicketPage = (
  profile: AccessLike | null | undefined,
  job: { id: string } | null | undefined,
): boolean => !!job && (!profile || isFieldOnly(profile));

/** Where the field page's Back arrow goes: My tickets. */
export const FIELD_BACK_TO = "/service/today";

/** Under the read-only details, in the technician's words. */
export const FIELD_DETAILS_NOTE =
  "The office sets these. Your notes are below; the close-out marks the ticket Done.";

const asType = (s: string): ServiceType =>
  (SERVICE_TYPES as readonly string[]).includes(s) ? (s as ServiceType) : "other";

/**
 * The field page's save: the notes, and nothing else changed. saveServiceJob always writes the
 * customer, site, contact, description, type, PO # and CenterPoint numbers (a key left out would
 * clear them), so those go back exactly as the ticket has them; the day, arrival window, Job #,
 * technician, crew and labor rate are left out — the server keeps each as it is when not sent
 * (and refuses a technician's move of the day anyway).
 */
export function fieldNotesInput(
  job: Pick<
    ServiceJobRow,
    | "id"
    | "account_id"
    | "site_id"
    | "contact_id"
    | "customer_name"
    | "description"
    | "service_type"
    | "po_number"
    | "centerpoint_ticket"
    | "centerpoint_invoice"
  >,
  notes: string,
): ServiceJobInput {
  return {
    id: job.id,
    account_id: job.account_id,
    site_id: job.site_id,
    contact_id: job.account_id ? job.contact_id : null,
    // A ticket from before customer profiles keeps its typed name.
    ...(!job.account_id ? { customer_name: job.customer_name } : {}),
    description: job.description,
    service_type: asType(job.service_type),
    po_number: job.po_number,
    notes,
    centerpoint_ticket: job.centerpoint_ticket,
    centerpoint_invoice: job.centerpoint_invoice,
  };
}
