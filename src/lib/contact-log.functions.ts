/**
 * Contact log and untouched work (owner, Sep 28: things get assigned and sit; we need to see
 * that people have been contacted or jobs have been initiated).
 *
 * - logContact: one tap on a ticket or an opportunity — Called / Texted / Emailed / Visited
 *   plus an optional note. The database trigger stamps the item's contacted_at, moves an Open
 *   opportunity to Contacted, and writes a ticket timeline entry.
 * - listUntouched: everything assigned and neither started nor contacted, from the SQL
 *   definition in crm_untouched() (RLS: a technician sees their own, the office everyone's).
 *   Each row carries its admin-set limit so the UI can grade it: muted before the limit, red
 *   past it. The reminder pass escalates the red ones to admins (notify.server.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";

export type ContactLogRow = Database["public"]["Tables"]["crm_contact_log"]["Row"];
export type UntouchedRow = Database["public"]["Functions"]["crm_untouched"]["Returns"][number];

export const CONTACT_METHODS = ["called", "texted", "emailed", "visited", "other"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];
export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  called: "Called",
  texted: "Texted",
  emailed: "Emailed",
  visited: "Visited",
  other: "Other",
};
/**
 * A plain log note that is not a contact ("Expected close moved from … to …", owner, Oct 1): it
 * is listed with the contacts but does not stamp contacted_at or move an Open opportunity to
 * Contacted (crm_contact_log_apply skips it). Not one of the one-tap buttons.
 */
export const LOG_NOTE_METHOD = "note";
/** The label a logged row shows: the contact method, or "Note" for a plain note. */
export const contactMethodLabel = (method: string): string =>
  method === LOG_NOTE_METHOD
    ? "Note"
    : CONTACT_METHOD_LABELS[
        (CONTACT_METHODS as readonly string[]).includes(method)
          ? (method as ContactMethod)
          : "other"
      ];
export const CONTACT_KINDS = ["ticket", "opportunity"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
async function myName(ctx: Ctx): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  return (data?.full_name ?? "").trim() || data?.email || null;
}

/** Whole days since `iso` (0 for today); null when unknown. */
export function daysSince(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000));
}
/** Past the admin limit: the row turns red and the reminder pass escalates it. */
export function isPastLimit(
  row: Pick<UntouchedRow, "assigned_at" | "limit_days">,
  now = new Date(),
) {
  const d = daysSince(row.assigned_at, now);
  return d !== null && d >= row.limit_days;
}

const logSchema = z.object({
  kind: z.enum(CONTACT_KINDS),
  item_id: z.string().uuid(),
  method: z.enum(CONTACT_METHODS),
  note: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
});
export type LogContactInput = z.input<typeof logSchema>;

export const logContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => logSchema.parse(d))
  .handler(async ({ data, context }): Promise<ContactLogRow> => {
    // A deleted opportunity takes no contact: the log's trigger would move it Open → Contacted.
    if (data.kind === "opportunity") {
      const { assertLiveOpportunity } = await import("@/lib/opportunities.functions");
      await assertLiveOpportunity(context.supabase, data.item_id);
    }
    const by_name = await myName(context);
    const { data: row, error } = await context.supabase
      .from("crm_contact_log")
      .insert({
        kind: data.kind,
        item_id: data.item_id,
        method: data.method,
        note: data.note,
        by_user: context.userId,
        by_name,
      })
      .select("*")
      .single();
    if (error) {
      // RLS: the item is not one this user may see (or it was deleted).
      if (error.code === "42501")
        throw new Error("You cannot log a contact on this item (no access to it)");
      throw new Error(error.message);
    }
    return row;
  });

export const listContactLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ kind: z.enum(CONTACT_KINDS), item_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ContactLogRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("crm_contact_log")
      .select("*")
      .eq("kind", data.kind)
      .eq("item_id", data.item_id)
      .order("at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Untouched items this user may see, oldest assignment first. */
export const listUntouched = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UntouchedRow[]> => {
    const { data, error } = await context.supabase.rpc("crm_untouched");
    if (error) throw new Error(error.message);
    return [...(data ?? [])].sort((a, b) =>
      (a.assigned_at ?? "").localeCompare(b.assigned_at ?? ""),
    );
  });
