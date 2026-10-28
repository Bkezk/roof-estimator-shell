/**
 * The ticket row's query cache (fieldKeys.job) as the close-out's saves and My tickets touch it.
 *
 * Owner, Oct 9: a saved signature could look unsaved. Each save (the notes' autosave, the crew
 * box) spread the WHOLE job row the server returned into the cache, so a slow notes save landing
 * after the signature save wrote back the row's old null signature_path. A save now merges only
 * the fields it sent (plus the stamp columns), and the cache keeps what the other saves wrote.
 *
 * Also here: the seed My tickets' "Open ticket" plants in the ticket cache so the close-out
 * renders at once instead of waiting on getServiceJob (the loader still re-reads in the
 * background). Pure, so it is tested without the screens.
 */
import type { ServiceJobRow, ServiceJobWithTech } from "@/lib/service.functions";
import type { TodayJob, TodayJobColumn } from "@/lib/service-field.functions";

/** What saveCloseout writes from the Notes and Signed-by boxes (plus the stamp columns). */
export const CLOSEOUT_TEXT_FIELDS = [
  "closing_notes",
  "checked_in_with",
  "checked_out_with",
  "recommend_new_roof",
  "signed_by",
  "updated_at",
  "updated_by_name",
] as const satisfies readonly (keyof ServiceJobRow)[];

/** What setJobCrew writes (plus the stamp columns). */
export const CREW_FIELDS = [
  "helper_count",
  "crew_confirmed_at",
  "updated_at",
  "updated_by_name",
] as const satisfies readonly (keyof ServiceJobRow)[];

/**
 * `old` with only `keys` taken from `row`. Nothing cached (undefined) stays nothing: the
 * loader's own read fills it, and a partial row must never stand in for the whole ticket.
 */
export function mergeSaved<T extends object, K extends keyof T>(
  old: T | undefined,
  row: Pick<T, K>,
  keys: readonly K[],
): T | undefined {
  if (!old) return old;
  const next = { ...old };
  for (const k of keys) next[k] = row[k];
  return next;
}

/**
 * The service_jobs columns My tickets does not read (TODAY_JOB_SELECT, Oct 28 audit), as the seed
 * supplies them: none of these is read by the close-out, so null stands until the loader's own
 * read lands. The type is the complement of the select, so a column dropped from the select must
 * be added here (and one the close-out starts reading must move to the select).
 */
const UNREAD_COLUMNS: Omit<ServiceJobRow, TodayJobColumn> = {
  assigned_at: null,
  location_id: null,
  location_name: null,
  stage_changed_at: null,
  contacted_at: null,
  escalated_at: null,
  centerpoint_invoice: null,
  centerpoint_ticket: null,
  created_by: null,
  deleted_at: null,
  from_opportunity_id: null,
  invoice_id: null,
  job_number: null,
  notes: null,
  po_number: null,
};

/**
 * The ticket cache entry My tickets can plant before the close-out opens: the TodayJob row is
 * the service_jobs row's columns My tickets reads (TODAY_JOB_SELECT) plus its own extras; the
 * columns it does not read are null here (UNREAD_COLUMNS) and the loader's shape adds the
 * technician's name, which on My tickets is always the signed-in person (myDay lists their own
 * tickets only). The optional site_city / site_state stay absent (the loader fills them).
 */
export function seedJobFromToday(
  j: TodayJob,
  me: { full_name: string | null; email: string } | null,
): ServiceJobWithTech {
  const {
    technician_instructions: _ti,
    contact_name: _cn,
    contact_phone: _cp,
    account_phone: _ap,
    crew_names: _crew,
    warranty_badges: _wb,
    ...row
  } = j;
  return {
    ...UNREAD_COLUMNS,
    ...row,
    technician_name: me ? me.full_name?.trim() || me.email : null,
  };
}
