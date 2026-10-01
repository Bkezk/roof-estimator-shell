/**
 * Opportunities — a potential new customer, or new work for one (design §11). Assigned to a
 * user with an expected close date; the follow-up timer (followups.server.ts) reminds them
 * until it is Won / Lost / No response.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess } from "@/lib/access";
import { opportunityDateProblem } from "@/lib/ticket-date";

export type OpportunityRow = Database["public"]["Tables"]["crm_opportunities"]["Row"];
export const OPP_STATUSES = ["open", "contacted", "quoted", "won", "lost", "no_response"] as const;
export type OppStatus = (typeof OPP_STATUSES)[number];
export const OPP_STATUS_LABELS: Record<OppStatus, string> = {
  open: "Open",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
  no_response: "No response",
};
export const OPP_CLOSING: readonly OppStatus[] = ["won", "lost", "no_response"];

export type OpportunityWithNames = OpportunityRow & {
  assignee_name: string | null;
  account_name: string | null;
};

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
async function me(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!data) throw new Error("Profile not found");
  return data;
}
const nameOf = (p: { full_name: string | null; email: string }) =>
  (p.full_name ?? "").trim() || p.email;

async function withNames(sb: SupabaseClient<Database>, rows: OpportunityRow[]) {
  const accountIds = [...new Set(rows.map((r) => r.account_id).filter((x): x is string => !!x))];
  const [{ data: techs }, { data: accounts }] = await Promise.all([
    sb.rpc("technician_options"),
    accountIds.length
      ? sb.from("crm_accounts").select("id, name").in("id", accountIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const names = new Map<string, string>();
  for (const t of techs ?? []) names.set(t.id, (t.full_name ?? "").trim() || t.email);
  const accs = new Map<string, string>();
  for (const a of accounts ?? []) accs.set(a.id, a.name);
  return rows.map((r) => ({
    ...r,
    assignee_name: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null,
    account_name: r.account_id ? (accs.get(r.account_id) ?? null) : null,
  })) as OpportunityWithNames[];
}

export const listOpportunities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpportunityWithNames[]> => {
    const { data, error } = await context.supabase
      .from("crm_opportunities")
      .select("*")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return withNames(context.supabase, data ?? []);
  });

export const getOpportunity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<OpportunityWithNames> => {
    const { data: row, error } = await context.supabase
      .from("crm_opportunities")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Opportunity not found");
    const [r] = await withNames(context.supabase, [row]);
    return r as OpportunityWithNames;
  });

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v == null || v === "" ? null : v));
const oppSchema = z.object({
  id: z.string().uuid().optional(),
  account_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optText(2000),
  assignee_id: z.string().uuid().nullable().optional(),
  expected_close: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  status: z.enum(OPP_STATUSES).optional(),
  lead_source: optText(120),
  est_value: z.number().finite().nonnegative().nullable().optional(),
  bid_id: z.string().uuid().nullable().optional(),
  notes: optText(10000),
});
export type OpportunityInput = z.input<typeof oppSchema>;

/**
 * Create (no id) or update. A new opportunity with no expected close gets today +
 * crm_settings.opportunity_close_days. The follow-up timer is synced after every save.
 */
export const saveOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => oppSchema.parse(d))
  .handler(async ({ data, context }): Promise<OpportunityWithNames> => {
    const p = await me(context);
    if (!canAccess(p, "customers") && !(data.assignee_id === context.userId || data.id))
      throw new Error("Forbidden: Customers access required");
    const sb = context.supabase;
    const { id, ...fields } = data;
    // Every opportunity keeps a date (owner, Oct 1): an update may not clear it.
    const dateProblem = opportunityDateProblem({ id, expected_close: fields.expected_close });
    if (dateProblem) throw new Error(dateProblem);
    let expected = fields.expected_close ?? null;
    if (!id && !expected) {
      const { data: s } = await sb
        .from("crm_settings")
        .select("opportunity_close_days")
        .eq("id", 1)
        .maybeSingle();
      const d = new Date(Date.now() + (s?.opportunity_close_days ?? 30) * 86400000);
      expected = d.toISOString().slice(0, 10);
    }
    const patch = {
      account_id: fields.account_id ?? null,
      title: fields.title,
      description: fields.description ?? null,
      assignee_id: fields.assignee_id ?? null,
      expected_close: expected,
      ...(fields.status ? { status: fields.status } : {}),
      lead_source: fields.lead_source ?? null,
      est_value: fields.est_value ?? null,
      bid_id: fields.bid_id ?? null,
      notes: fields.notes ?? null,
      updated_by_name: nameOf(p),
    };
    let row: OpportunityRow;
    if (id) {
      const { data: r, error } = await sb
        .from("crm_opportunities")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      row = r;
    } else {
      const { data: r, error } = await sb
        .from("crm_opportunities")
        .insert({ ...patch, created_by: context.userId })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      row = r;
    }
    const { syncFollowup } = await import("@/lib/followups.server");
    await syncFollowup(
      {
        kind: "opportunity",
        itemId: row.id,
        accountId: row.account_id,
        assigneeId: row.assignee_id,
        title: row.title,
        url: `/opportunities?id=${row.id}`,
        closing: OPP_CLOSING.includes(row.status as OppStatus),
        closeReason: `status ${row.status}`,
        dueDate: row.expected_close,
        actorId: context.userId,
        actorName: nameOf(p),
      },
      context.supabase,
    );
    const [r] = await withNames(sb, [row]);
    return r as OpportunityWithNames;
  });

export const setOpportunityStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(OPP_STATUSES) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    const p = await me(context);
    const { data: row, error } = await context.supabase
      .from("crm_opportunities")
      .update({ status: data.status, updated_by_name: nameOf(p) })
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Opportunity not found, or not yours to change");
    const { syncFollowup } = await import("@/lib/followups.server");
    await syncFollowup(
      {
        kind: "opportunity",
        itemId: row.id,
        accountId: row.account_id,
        assigneeId: row.assignee_id,
        title: row.title,
        url: `/opportunities?id=${row.id}`,
        closing: OPP_CLOSING.includes(row.status as OppStatus),
        closeReason: `status ${row.status}`,
        dueDate: row.expected_close,
        actorId: context.userId,
        actorName: nameOf(p),
      },
      context.supabase,
    );
  });

export const deleteOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    const p = await me(context);
    if (!canAccess(p, "customers")) throw new Error("Forbidden: Customers access required");
    const { error } = await context.supabase
      .from("crm_opportunities")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    const { syncFollowup } = await import("@/lib/followups.server");
    await syncFollowup(
      {
        kind: "opportunity",
        itemId: data.id,
        accountId: null,
        assigneeId: null,
        title: "",
        url: "",
        closing: true,
        closeReason: "deleted",
        dueDate: null,
        actorId: context.userId,
        actorName: null,
      },
      context.supabase,
    );
  });
