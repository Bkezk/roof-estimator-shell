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
import type { TodayJob } from "@/lib/service-field.functions";

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
 * The ticket cache entry My tickets can plant before the close-out opens: the TodayJob row IS
 * the service_jobs row (myDay selects *) plus its own extras; the loader's shape adds the
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
  return { ...row, technician_name: me ? me.full_name?.trim() || me.email : null };
}
