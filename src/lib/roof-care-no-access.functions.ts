/**
 * A visit we could not do because we could not get on the roof — the server side
 * (roof-care-no-access.ts has the rule and the words). The database decides who may record one,
 * whether it is free or charged, and what it is charged: roof_care_no_access_preview(),
 * roof_care_no_access() and roof_care_no_access_remove().
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import {
  NO_ACCESS_NOTE_NEEDED,
  readNoAccessPreview,
  type NoAccessPreview,
} from "@/lib/roof-care-no-access";
import { planName } from "@/lib/roof-care-plan";

type Sb = SupabaseClient<Database>;

/** One record as the ticket shows it. The amount is on the plan, for the office. */
export interface TicketNoAccess {
  id: string;
  on: string;
  note: string;
  by_name: string;
  charged: boolean;
}

export interface TicketNoAccessState {
  /** Null when No access cannot be pressed here: the inspection is done, or not a plan's. */
  preview: NoAccessPreview | null;
  /** What is recorded on this inspection: all of it for the office, a technician's own. */
  records: TicketNoAccess[];
}

/** The database's refusals that mean "nothing to press here", not "something went wrong". */
const NOTHING_TO_PRESS = /already done|not a Roof Care plan inspection/i;

export async function readTicketNoAccess(sb: Sb, jobId: string): Promise<TicketNoAccessState> {
  const { data: job, error: jErr } = await sb
    .from("service_jobs")
    .select("id, roof_care_visit_id")
    .eq("id", jobId)
    .maybeSingle();
  if (jErr) throw new Error(jErr.message);
  if (!job?.roof_care_visit_id) return { preview: null, records: [] };
  const { data: rows, error: rErr } = await sb
    .from("roof_care_no_access")
    .select("id, on_date, note, by_name, charged, at")
    .eq("visit_id", job.roof_care_visit_id)
    .order("at", { ascending: true });
  if (rErr) throw new Error(rErr.message);
  const records = (rows ?? []).map((r) => ({
    id: r.id,
    on: r.on_date,
    note: r.note,
    by_name: r.by_name,
    charged: !!r.charged,
  }));
  const { data, error } = await sb.rpc("roof_care_no_access_preview", { p_job: jobId });
  if (error) {
    if (NOTHING_TO_PRESS.test(error.message)) return { preview: null, records };
    throw new Error(error.message);
  }
  return { preview: readNoAccessPreview(data), records };
}

export const roofCareNoAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TicketNoAccessState> =>
    readTicketNoAccess(context.supabase, data.job_id),
  );

/** What the office is told, so the inspection gets a new day. */
export function noAccessNotice(a: {
  plan: unknown;
  job_id: string;
  number: number | null;
  site: string | null;
  note: string;
  by_name: string | null;
  charged: boolean;
}) {
  const place = (a.site ?? "").trim() || "a property";
  const who = (a.by_name ?? "").trim();
  return {
    kind: "care_no_access",
    title: `No access for a ${planName(a.plan)} inspection: ${place}`,
    body: `${who ? `${who}: ` : ""}${a.note.trim().replace(/[.\s]+$/, "")}. ${a.charged ? "The return trip is charged: it goes on this inspection's invoice." : "The return trip is at no charge."} Ticket${a.number != null ? ` #${a.number}` : ""} needs a new day.`,
    url: `/service?id=${a.job_id}`,
  };
}

/**
 * Tell the admins and the managers, best effort: the record is kept either way. A failure is
 * logged and never the caller's.
 */
async function tellOffice(
  sb: Sb,
  a: { job_id: string; note: string; by_name: string | null; charged: boolean; plan_id: string },
): Promise<void> {
  try {
    const { notify, serverClient } = await import("@/lib/notify.server");
    const admin = await serverClient(sb);
    const [{ data: people }, { data: job }, { data: plan }] = await Promise.all([
      admin.from("profiles").select("id, role").in("role", ["admin", "manager"]),
      admin.from("service_jobs").select("number, site_name").eq("id", a.job_id).maybeSingle(),
      admin.from("roof_care_plans").select("plan").eq("id", a.plan_id).maybeSingle(),
    ]);
    const to = (people ?? []).map((p) => p.id);
    if (!to.length) return;
    await notify(
      to,
      noAccessNotice({
        plan: plan?.plan ?? null,
        job_id: a.job_id,
        number: job?.number ?? null,
        site: job?.site_name ?? null,
        note: a.note,
        by_name: a.by_name,
        charged: a.charged,
      }),
      admin,
    );
  } catch (e) {
    console.error("No access: the office could not be told —", e instanceof Error ? e.message : e);
  }
}

export const recordRoofCareNoAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        note: z.string().trim().min(1, NO_ACCESS_NOTE_NEEDED).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ charged: boolean; amount_known: boolean }> => {
    const sb = context.supabase;
    const { data: res, error } = await sb.rpc("roof_care_no_access", {
      p_job: data.job_id,
      p_note: data.note,
    });
    if (error) throw new Error(error.message);
    const now = readNoAccessPreview(res);
    if (!now) throw new Error("It was recorded, but the answer could not be read back");
    const { data: me } = await sb
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    await tellOffice(sb, {
      job_id: data.job_id,
      note: data.note,
      by_name: (me?.full_name ?? "").trim() || me?.email || null,
      charged: now.charged,
      plan_id: now.plan_id,
    });
    return { charged: now.charged, amount_known: now.amount_known };
  });

/** A manager takes a record off: a mistake, or a charge that is let go. */
export const removeRoofCareNoAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("roof_care_no_access_remove", { p_id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
