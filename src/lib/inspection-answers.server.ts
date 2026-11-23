/**
 * The server's check before a Roof Care plan's inspection is moved into Done or later
 * (inspection-answers.ts has the rule). Called before anything is written, so a refused move
 * stops no clock.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { parseInspection } from "@/lib/inspection";
import {
  isPlanInspection,
  planRowsOpen,
  planRowsRefusal,
  planRowsUnchecked,
} from "@/lib/inspection-answers";

/**
 * Why this ticket may not be finished yet, or null. Only a plan's own inspection is ever read:
 * its saved answers as they stand now, and the live checklist. A read that fails is said
 * plainly and holds the move; it is never let through as "all answered".
 */
export async function planRowsStop(
  sb: SupabaseClient<Database>,
  job: {
    id: string;
    service_type?: string | null | undefined;
    roof_care_visit_id?: string | null | undefined;
  },
): Promise<string | null> {
  if (!isPlanInspection(job)) return null;
  try {
    const [row, list] = await Promise.all([
      sb.from("service_jobs").select("inspection").eq("id", job.id).maybeSingle(),
      sb.from("inspection_checklist_items").select("id, label, sort"),
    ]);
    if (row.error) throw new Error(row.error.message);
    if (list.error) throw new Error(list.error.message);
    return planRowsRefusal(
      planRowsOpen(parseInspection(row.data?.inspection ?? null), list.data ?? []),
    );
  } catch (e) {
    return planRowsUnchecked(e instanceof Error ? e.message : String(e));
  }
}
