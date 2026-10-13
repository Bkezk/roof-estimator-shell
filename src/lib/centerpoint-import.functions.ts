/**
 * Admin › Import from CenterPoint (owner, Oct 13): the server side of the one-time Book of
 * Business import. `planCenterpointImport` reads the three CSV texts against the live customers,
 * properties, contacts, users and county codes and returns the counts and the report (a dry
 * run, nothing written). `applyCenterpointImport` takes the same texts, plans again on the
 * server (a client-sent plan is never trusted) and writes: new customers in batches, then the
 * links, then properties and contacts resolved to their customer. It stops at the first failed
 * batch and returns what was written; a re-run skips everything already carrying its
 * CenterPoint ID (src/lib/centerpoint-import.ts), so running again finishes the job.
 *
 * Admins only. Writes go through the admin's own client, so RLS and the audit triggers see the
 * admin as the actor (every imported row gets a History line, as the owner wants).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import {
  formatImportReport,
  planCenterpointImport as buildPlan,
  planSummary,
  type ImportLookups,
  type ImportPlan,
  type ImportReport,
} from "@/lib/centerpoint-import";
import { parseInput } from "@/lib/crm-account";
import { fetchAllPages } from "@/lib/paging";

/** Each CSV at most 5 MB of text (the real export is under 200 KB each). */
export const MAX_CSV_CHARS = 5 * 1024 * 1024;
/** Rows per insert statement. */
export const BATCH = 200;

const csvText = z
  .string()
  .max(MAX_CSV_CHARS, "A CSV is larger than 5 MB")
  .refine((s) => s.trim() !== "", "A CSV is empty");
export const importInputSchema = z.object({
  companies: csvText,
  properties: csvText,
  contacts: csvText,
});
export type ImportInput = z.infer<typeof importInputSchema>;

type Sb = SupabaseClient<Database>;

async function assertAdmin(supabase: Sb, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", userId)
    .single();
  if (error || !data || data.role !== "admin") {
    throw new Error("Forbidden: admin access required");
  }
  return data;
}

/** The live portal, as the planner wants it. */
export async function loadLookups(sb: Sb): Promise<ImportLookups> {
  const profiles = await fetchAllPages((from, to) =>
    sb.from("profiles").select("id, full_name, email, role").order("id").range(from, to),
  );
  const county_codes = await fetchAllPages((from, to) =>
    sb.from("county_codes").select("id, code, county, state").order("id").range(from, to),
  );
  const accounts = await fetchAllPages((from, to) =>
    sb
      .from("crm_accounts")
      .select(
        "id, name, centerpoint_company_id, centerpoint_alias_ids, deleted_at, phone, email, mobile, external_id",
      )
      .order("id")
      .range(from, to),
  );
  const sites = await fetchAllPages((from, to) =>
    sb
      .from("crm_sites")
      .select("id, account_id, name, centerpoint_property_id, centerpoint_alias_ids, deleted_at")
      .order("id")
      .range(from, to),
  );
  const contacts = await fetchAllPages((from, to) =>
    sb
      .from("crm_contacts")
      .select(
        "id, account_id, name, email, mobile, office_phone, centerpoint_contact_id, deleted_at",
      )
      .order("id")
      .range(from, to),
  );
  return { profiles, county_codes, accounts, sites, contacts };
}

export interface PlanResult {
  summary: ReturnType<typeof planSummary>;
  counts: ImportReport["counts"];
  report: string;
  flags: ImportReport["flags"];
}

export const planCenterpointImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(importInputSchema, d))
  .handler(async ({ data, context }): Promise<PlanResult> => {
    await assertAdmin(context.supabase, context.userId);
    const plan = buildPlan(data, await loadLookups(context.supabase));
    return {
      summary: planSummary(plan),
      counts: plan.report.counts,
      report: formatImportReport(plan),
      flags: plan.report.flags,
    };
  });

export interface ApplyResult {
  written: {
    accounts: number;
    accountLinks: number;
    sites: number;
    siteLinks: number;
    contacts: number;
    contactLinks: number;
  };
  /** Properties / contacts whose customer could not be resolved (not written). */
  unresolved: { sites: number; contacts: number };
  /** The first failed batch's message; everything counted in `written` was written before it. */
  error: string | null;
}

const chunks = <T>(rows: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

/** Writes the plan with `sb`; exported for the apply step and its tests (the client is a stub). */
export async function writePlan(
  sb: Sb,
  plan: ImportPlan,
  actor: string | null,
): Promise<ApplyResult> {
  const written = {
    accounts: 0,
    accountLinks: 0,
    sites: 0,
    siteLinks: 0,
    contacts: 0,
    contactLinks: 0,
  };
  const unresolved = { sites: 0, contacts: 0 };
  const accountIds = new Map<string, string>(Object.entries(plan.existingAccountIds));
  const fail = (step: string, message: string): ApplyResult => ({
    written,
    unresolved,
    error: `${step}: ${message}`,
  });

  // 1. New customers, 200 at a time; the returned ids key the properties and contacts.
  for (const batch of chunks(plan.accountsToInsert, BATCH)) {
    const { data, error } = await sb
      .from("crm_accounts")
      .insert(batch.map((row) => ({ ...row, updated_by_name: actor })))
      .select("id, centerpoint_company_id");
    if (error) return fail("customers", error.message);
    for (const r of data ?? [])
      if (r.centerpoint_company_id) accountIds.set(r.centerpoint_company_id, r.id);
    written.accounts += data?.length ?? 0;
  }
  // 2. Customers with the same name: only the CenterPoint ID (and a blank customer number).
  for (const link of plan.accountsToLink) {
    const { error } = await sb
      .from("crm_accounts")
      .update({ ...link.set, updated_by_name: actor })
      .eq("id", link.id)
      .is("deleted_at", null);
    if (error) return fail(`linking customer "${link.name}"`, error.message);
    written.accountLinks++;
  }
  // 3. Properties, resolved to their customer.
  const siteRows: Database["public"]["Tables"]["crm_sites"]["Insert"][] = [];
  for (const s of plan.sitesToInsert) {
    const account_id = accountIds.get(s.companyCpId);
    if (!account_id) {
      unresolved.sites++;
      continue;
    }
    siteRows.push({ ...s.row, account_id });
  }
  for (const batch of chunks(siteRows, BATCH)) {
    const { data, error } = await sb.from("crm_sites").insert(batch).select("id");
    if (error) return fail("properties", error.message);
    written.sites += data?.length ?? 0;
  }
  for (const link of plan.sitesToLink) {
    const { error } = await sb
      .from("crm_sites")
      .update(link.set)
      .eq("id", link.id)
      .is("deleted_at", null);
    if (error) return fail(`linking property "${link.name}"`, error.message);
    written.siteLinks++;
  }
  // 4. Contacts, the same way.
  const contactRows: Database["public"]["Tables"]["crm_contacts"]["Insert"][] = [];
  for (const c of plan.contactsToInsert) {
    const account_id = accountIds.get(c.companyCpId);
    if (!account_id) {
      unresolved.contacts++;
      continue;
    }
    contactRows.push({ ...c.row, account_id });
  }
  for (const batch of chunks(contactRows, BATCH)) {
    const { data, error } = await sb.from("crm_contacts").insert(batch).select("id");
    if (error) return fail("contacts", error.message);
    written.contacts += data?.length ?? 0;
  }
  for (const link of plan.contactsToLink) {
    const { error } = await sb
      .from("crm_contacts")
      .update(link.set)
      .eq("id", link.id)
      .is("deleted_at", null);
    if (error) return fail(`linking contact "${link.name}"`, error.message);
    written.contactLinks++;
  }
  return { written, unresolved, error: null };
}

export const applyCenterpointImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(importInputSchema, d))
  .handler(async ({ data, context }): Promise<ApplyResult> => {
    const admin = await assertAdmin(context.supabase, context.userId);
    const actor = `${(admin.full_name ?? "").trim() || admin.email} (CenterPoint import)`;
    // Planned again here, against the database as it is now: the client's plan is only a preview.
    const plan = buildPlan(data, await loadLookups(context.supabase));
    return writePlan(context.supabase, plan, actor);
  });
