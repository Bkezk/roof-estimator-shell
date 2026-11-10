/**
 * Reading Setup's History (setup-history.ts): the last lines of one tab, newest first. Admins
 * and managers only, as the page and every other History fold (RLS audit_log_read says the same).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import { seesEveryone } from "@/lib/access";
import type { AuditRow } from "@/lib/audit";
import { SETUP_HISTORY_ENTITY, SETUP_HISTORY_LIMIT, SETUP_HISTORY_TABS } from "@/lib/setup-history";

export const listSetupHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ tab: z.enum(SETUP_HISTORY_TABS) }).parse(d))
  .handler(async ({ data, context }): Promise<AuditRow[]> => {
    const sb = context.supabase;
    const { data: p } = await sb
      .from("profiles")
      .select("role, access, technician")
      .eq("id", context.userId)
      .maybeSingle();
    if (!seesEveryone(p)) throw new Error("The history is for admins and managers");
    const { data: rows, error } = await sb
      .from("audit_log")
      .select("id, at, by_user, by_name, by_role, entity, entity_id, action, summary, changes")
      .eq("entity", SETUP_HISTORY_ENTITY[data.tab])
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .limit(SETUP_HISTORY_LIMIT);
    if (error) throw new Error(error.message);
    return (rows ?? []) as AuditRow[];
  });
