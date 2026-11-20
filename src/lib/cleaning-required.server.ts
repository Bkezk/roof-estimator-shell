/**
 * The server's check before a plan's inspection is moved into Done or later (cleaning-required.ts
 * has the rule). Called before anything is written, so a refused move stops no clock.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { cleaningRefusalOf, cleaningUnchecked } from "@/lib/cleaning-required";
import { readVisitCleaning } from "@/lib/roof-care-cleaning.functions";

/**
 * Why this ticket may not be finished yet, or null. `visitId`: the ticket's roof_care_visit_id
 * (null on every ticket that is not a plan's inspection, which is never held).
 *
 * A reader who cannot see the plan gets null here: the database's own rule
 * (service_jobs_cleaning_rule) reads the plan whoever asks, and decides.
 */
export async function cleaningStop(
  sb: SupabaseClient<Database>,
  visitId: string | null | undefined,
): Promise<string | null> {
  if (!visitId) return null;
  try {
    return cleaningRefusalOf(await readVisitCleaning(sb, visitId));
  } catch (e) {
    return cleaningUnchecked(e instanceof Error ? e.message : String(e));
  }
}
