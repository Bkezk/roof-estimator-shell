/**
 * Reading the audit log (audit.ts) for the History folds: admins and managers only (owner, Oct
 * 1: management sees what was changed; a sales person does not see the history of their own
 * edits). RLS audit_log_read says the same.
 *
 * An invoice's history includes its lines' rows (entity 'invoice_line', entity_id = the
 * invoice). A customer's history includes the rows of its sites and contacts, deleted ones too.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import { seesEveryone } from "@/lib/access";
import type { AuditRow } from "@/lib/audit";

const LIMIT = 300;

export const listAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ entity: z.enum(["invoice", "account"]), entity_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<AuditRow[]> => {
    const sb = context.supabase;
    const { data: p } = await sb
      .from("profiles")
      .select("role, access, technician")
      .eq("id", context.userId)
      .maybeSingle();
    if (!seesEveryone(p)) throw new Error("The history is for admins and managers");
    const cols = "id, at, by_user, by_name, by_role, entity, entity_id, action, summary, changes";
    if (data.entity === "invoice") {
      const { data: rows, error } = await sb
        .from("audit_log")
        .select(cols)
        .in("entity", ["invoice", "invoice_line"])
        .eq("entity_id", data.entity_id)
        .order("at", { ascending: false })
        .order("id", { ascending: false })
        .limit(LIMIT);
      if (error) throw new Error(error.message);
      return (rows ?? []) as AuditRow[];
    }
    const [{ data: sites, error: sErr }, { data: contacts, error: cErr }] = await Promise.all([
      sb.from("crm_sites").select("id").eq("account_id", data.entity_id),
      sb.from("crm_contacts").select("id").eq("account_id", data.entity_id),
    ]);
    if (sErr) throw new Error(sErr.message);
    if (cErr) throw new Error(cErr.message);
    const ors = [`and(entity.eq.account,entity_id.eq.${data.entity_id})`];
    const siteIds = (sites ?? []).map((s) => s.id);
    const contactIds = (contacts ?? []).map((c) => c.id);
    if (siteIds.length) ors.push(`and(entity.eq.site,entity_id.in.(${siteIds.join(",")}))`);
    if (contactIds.length)
      ors.push(`and(entity.eq.contact,entity_id.in.(${contactIds.join(",")}))`);
    const { data: rows, error } = await sb
      .from("audit_log")
      .select(cols)
      .or(ors.join(","))
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .limit(LIMIT);
    if (error) throw new Error(error.message);
    return (rows ?? []) as AuditRow[];
  });
