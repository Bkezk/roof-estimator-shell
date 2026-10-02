/**
 * Reading and writing a ticket's crew rows (service_job_techs) — SERVER ONLY; load inside
 * handlers with `await import("@/lib/service-crew.server")`. The rules are the pure functions in
 * service-crew.ts; this only moves rows.
 *
 * Who is on a crew is read from the price-free view service_job_crew (every Service / Customers
 * user); the per-job rates (bill_rate) only from the table, which RLS shows to admins, managers
 * and sales / project managers alone (service_job_techs_read,
 * 20261002160000_tech_price_free_reads.sql). The crew is written through set_job_crew (SECURITY
 * DEFINER: the lead or a manager; rates a manager's).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { helperCountFor, releadCrew, type CrewRow } from "@/lib/service-crew";

type Client = SupabaseClient<Database>;

/**
 * The per-job rates stored on the ticket's crew, by technician. Office money: to anyone the
 * read policy does not cover (a technician) RLS returns no rows, so every rate reads as null.
 */
export async function readCrewRates(sb: Client, jobId: string): Promise<Map<string, number>> {
  const { data, error } = await sb
    .from("service_job_techs")
    .select("technician_id, bill_rate")
    .eq("service_job_id", jobId);
  if (error) throw new Error(`Could not read the crew's rates: ${error.message}`);
  const rates = new Map<string, number>();
  for (const r of data ?? [])
    if (r.technician_id && r.bill_rate != null) rates.set(r.technician_id, Number(r.bill_rate));
  return rates;
}

/**
 * The ticket's crew, the lead first. `rates: false` skips the rates (all null) and reads only
 * the view: a technician's call, whose rates RLS hides anyway.
 */
export async function readCrew(
  sb: Client,
  jobId: string,
  opts: { rates?: boolean } = {},
): Promise<CrewRow[]> {
  const [{ data, error }, rates] = await Promise.all([
    sb
      .from("service_job_crew")
      .select("technician_id, sort")
      .eq("service_job_id", jobId)
      .order("sort"),
    opts.rates === false ? Promise.resolve(new Map<string, number>()) : readCrewRates(sb, jobId),
  ]);
  if (error) throw new Error(`Could not read the crew: ${error.message}`);
  return (data ?? [])
    .filter((r): r is typeof r & { technician_id: string } => !!r.technician_id)
    .map((r) => ({
      technician_id: r.technician_id,
      sort: r.sort ?? 0,
      bill_rate: rates.get(r.technician_id) ?? null,
    }));
}

/**
 * Replace the ticket's crew with `rows` and keep service_jobs.helper_count in step (the time
 * entries the stage buttons write copy it). Returns the helper count written. One call to
 * set_job_crew: the members not kept leave, the rest are upserted. A manager's rates are
 * written as given; a lead's row without a rate keeps the stored one (they cannot see it), and
 * a lead's row with a different rate is refused.
 */
export async function writeCrew(sb: Client, jobId: string, rows: readonly CrewRow[]) {
  const { error } = await sb.rpc("set_job_crew", {
    p_job: jobId,
    p_rows: rows.map((r) => ({
      technician_id: r.technician_id,
      sort: r.sort,
      bill_rate: r.bill_rate,
    })),
  });
  if (error) throw new Error(`Could not save the crew: ${error.message}`);
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
