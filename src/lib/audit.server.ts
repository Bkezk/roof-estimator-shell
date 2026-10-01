/**
 * Writing the audit log (audit.ts explains the rows). Called by the invoice and customer server
 * functions right after each write, as the signed-in user (RLS audit_log_insert: by_user must be
 * the caller).
 *
 * It never throws: a failed log is console-logged (the server's log) and the save it describes
 * still succeeds — the change is made but that one log row is missing. Update entries with no
 * changed field (and no summary of their own) are skipped.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { auditSummary, type AuditActor, type AuditEntry } from "@/lib/audit";

export async function logAudit(
  sb: SupabaseClient<Database>,
  actor: AuditActor,
  entries: AuditEntry | AuditEntry[],
): Promise<void> {
  try {
    const list = (Array.isArray(entries) ? entries : [entries]).filter(
      (e) => e.action !== "update" || !!e.summary || Object.keys(e.changes ?? {}).length > 0,
    );
    if (!list.length) return;
    const rows = list.map((e) => ({
      by_user: actor.id,
      by_name: actor.name,
      by_role: actor.role,
      entity: e.entity,
      entity_id: e.entity_id,
      action: e.action,
      summary: e.summary ?? auditSummary(e.entity, e.action, e.changes, e.label),
      changes: (e.changes ?? null) as Json,
    }));
    const { error } = await sb.from("audit_log").insert(rows);
    if (error)
      console.error(
        `[audit] ${rows.length} row(s) not logged: ${error.message}`,
        rows.map((r) => r.summary),
      );
  } catch (e) {
    console.error("[audit] not logged:", e);
  }
}
