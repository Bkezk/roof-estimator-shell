/**
 * Reading and writing a ticket's crew rows (service_job_techs) — SERVER ONLY; load inside
 * handlers with `await import("@/lib/service-crew.server")`. The rules are the pure functions in
 * service-crew.ts; this only moves rows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { helperCountFor, releadCrew, type CrewRow } from "@/lib/service-crew";

type Client = SupabaseClient<Database>;

export async function readCrew(sb: Client, jobId: string): Promise<CrewRow[]> {
  const { data, error } = await sb
    .from("service_job_techs")
    .select("technician_id, sort, bill_rate")
    .eq("service_job_id", jobId)
    .order("sort");
  if (error) throw new Error(`Could not read the crew: ${error.message}`);
  return (data ?? [])
    .filter((r): r is typeof r & { technician_id: string } => !!r.technician_id)
    .map((r) => ({
      technician_id: r.technician_id,
      sort: r.sort,
      bill_rate: r.bill_rate == null ? null : Number(r.bill_rate),
    }));
}

/**
 * Replace the ticket's crew with `rows` and keep service_jobs.helper_count in step (the time
 * entries the stage buttons write copy it). Returns the helper count written.
 */
export async function writeCrew(sb: Client, jobId: string, rows: readonly CrewRow[]) {
  const keep = rows.map((r) => r.technician_id);
  let del = sb.from("service_job_techs").delete().eq("service_job_id", jobId);
  if (keep.length) del = del.not("technician_id", "in", `(${keep.join(",")})`);
  const { error: dErr } = await del;
  if (dErr) throw new Error(`Could not update the crew: ${dErr.message}`);
  if (rows.length) {
    const { error } = await sb.from("service_job_techs").upsert(
      rows.map((r) => ({
        service_job_id: jobId,
        technician_id: r.technician_id,
        sort: r.sort,
        bill_rate: r.bill_rate,
      })),
      { onConflict: "service_job_id,technician_id" },
    );
    if (error) throw new Error(`Could not save the crew: ${error.message}`);
  }
  const helper_count = helperCountFor(rows);
  const { error: jErr } = await sb.from("service_jobs").update({ helper_count }).eq("id", jobId);
  if (jErr) throw new Error(jErr.message);
  return helper_count;
}

/**
 * After the ticket's technician changed (form, Tech Board): row 0 follows it. An old-style
 * ticket (no crew rows) is left alone.
 */
export async function syncCrewLead(sb: Client, jobId: string, leadId: string | null) {
  const rows = await readCrew(sb, jobId);
  if (!rows.length) return;
  const next = releadCrew(rows, leadId);
  if (JSON.stringify(next) === JSON.stringify(rows)) return;
  await writeCrew(sb, jobId, next);
}
