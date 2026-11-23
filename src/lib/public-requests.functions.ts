/**
 * The office's side of the public pages (Roof Care step 4): the request behind an opportunity
 * with its possible matches, the answer to it (whose it is), the three settings on Setup › QR
 * pages, and what a Roof Care request hands to the normal sign-up.
 *
 * Nov 23 (owner: "i like option A"): the database makes an opportunity for every request the
 * moment it is sent, so there is no list of requests here any more. The office answers a
 * request on its opportunity.
 *
 * Signed-in people only, with Customers access (the database says the same: public_requests'
 * read rule and the two functions). Making the customer and the property is done by the
 * functions that already do it (quickCreateAccount, saveSite), called from the page: nothing
 * here writes a second version of them.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import { canAccess, isAdmin, isManager } from "@/lib/access";
import { readProfile } from "@/lib/profile-cache.server";
import {
  carePrefill,
  cleanQrAddress,
  cleanServices,
  readMatches,
  type CareSignUpPrefill,
  type PublicFormSettings,
  type PublicMatch,
  type PublicRequestRow,
} from "@/lib/public-requests";

export const PUBLIC_REQUESTS_NEED = "Requests from the public pages need Customers access";
export const PUBLIC_SETTINGS_NEED = "Only an admin or a manager changes the QR page settings";

type Ctx = { supabase: Parameters<typeof readProfile>[0]; userId: string };

async function office(ctx: Ctx) {
  const p = await readProfile(ctx.supabase, ctx.userId);
  if (!p || !canAccess(p, "customers")) throw new Error(PUBLIC_REQUESTS_NEED);
  return p;
}

const REQUEST_SELECT =
  "id, reference, kind, created_at, status, contact_name, company, phone, email, address, city, state, zip, building_name, referred_by, plan, sqft, size_range, sqft_source, shown_price, quote, pay_method, terms_version, agreed_by, several_buildings, notes, services, details, handled_at, handled_by_name, dismiss_reason, account_id, site_id, opportunity_id, roof_care_plan_id" as const;

export interface OpportunityRequest {
  request: PublicRequestRow;
  /** Customers who may be the sender. Worked out only while nobody has said whose it is. */
  matches: PublicMatch[];
  /**
   * The status of the plan the request became ("awaiting_payment", "active", "ended"), or
   * null: the strip says whether the plan still waits for its payment.
   */
  plan_status: string | null;
}

/**
 * The request an opportunity was made from, for the strip on the opportunity. Null when the
 * opportunity did not come from a public page, and null (never an error) for someone without
 * Customers access: they may read the opportunity, and its description says where it came
 * from, but what the customer typed and who they may be is the office's.
 */
export const getOpportunityRequest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ opportunity_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<OpportunityRequest | null> => {
    const p = await readProfile(context.supabase, context.userId);
    if (!p || !canAccess(p, "customers")) return null;
    const sb = context.supabase;
    const { data: rows, error } = await sb
      .from("public_requests")
      .select(REQUEST_SELECT)
      .eq("opportunity_id", data.opportunity_id)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw new Error(error.message);
    const r = (rows?.[0] ?? null) as unknown as PublicRequestRow | null;
    if (!r) return null;
    if (r.status !== "new") {
      let plan_status: string | null = null;
      if (r.roof_care_plan_id) {
        const plan = await sb
          .from("roof_care_plans")
          .select("status")
          .eq("id", r.roof_care_plan_id)
          .maybeSingle();
        plan_status = plan.data?.status ?? null;
      }
      return { request: r, matches: [], plan_status };
    }
    const found = await sb.rpc("public_request_matches", { p_id: r.id });
    if (found.error) throw new Error(`The possible matches: ${found.error.message}`);
    return { request: r, matches: readMatches(found.data), plan_status: null };
  });

const handleInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["matched", "dismissed", "new"]),
  account_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  opportunity_id: z.string().uuid().nullable().optional(),
  plan_id: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

/**
 * The office's answer to a request. The database checks who, and what is allowed, and puts the
 * customer and the property on the request's opportunity. When the answer names the Roof Care
 * plan the request became, the request points at that plan. Its opportunity is set to Won by
 * the database the day the plan is paid and starts (owner, Nov 23: "2 go"; it was at sign-up
 * for a few hours), by whichever way the payment arrives.
 */
export const handlePublicRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => handleInput.parse(d))
  .handler(async ({ data, context }): Promise<PublicRequestRow> => {
    await office(context);
    const { data: row, error } = await context.supabase.rpc("public_request_handle", {
      p_id: data.id,
      p_status: data.status,
      ...(data.account_id ? { p_account: data.account_id } : {}),
      ...(data.site_id ? { p_site: data.site_id } : {}),
      ...(data.opportunity_id ? { p_opportunity: data.opportunity_id } : {}),
      ...(data.plan_id ? { p_plan: data.plan_id } : {}),
      ...(data.reason ? { p_reason: data.reason } : {}),
    });
    if (error) throw new Error(error.message);
    return row as unknown as PublicRequestRow;
  });

/**
 * What a Roof Care request hands to the sign-up on its property's page: the plan picked, the
 * size, how they pay, the customer's own typed name as the one who agreed, who referred them.
 * Null when the request is not a Roof Care one, is dismissed, or is not this property's.
 */
export const publicCarePrefill = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), site_id: z.string().uuid().optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<CareSignUpPrefill | null> => {
    await office(context);
    const { data: row, error } = await context.supabase
      .from("public_requests")
      .select(REQUEST_SELECT)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const r = row as unknown as PublicRequestRow | null;
    if (!r || r.status === "dismissed") return null;
    if (data.site_id && r.site_id && r.site_id !== data.site_id) return null;
    return carePrefill(r);
  });

export interface PublicFormSettingsRead extends PublicFormSettings {
  /** The site's own address, which the codes hold while no other is saved. */
  own_url: string;
  /** Whether this person may change the settings. */
  can_edit: boolean;
  /** Today's Google drive lookups: used, the limit, and how many went to the free router. */
  google: { used: number; cap: number; held: number };
}

async function ownUrl(): Promise<string> {
  const { appUrl } = await import("@/lib/notify.server");
  const set = appUrl();
  if (set) return set;
  const { getRequest } = await import("@tanstack/react-start/server");
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return "";
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

async function readSettings(ctx: Ctx, canEdit: boolean): Promise<PublicFormSettingsRead> {
  const sb = ctx.supabase;
  const [{ data, error }, today] = await Promise.all([
    sb
      .from("public_form_settings")
      .select("services, qr_base_url, google_daily_cap, updated_at, updated_by_name")
      .eq("id", 1)
      .maybeSingle(),
    sb.rpc("google_route_today"),
  ]);
  if (error) throw new Error(error.message);
  const g = (today.data ?? {}) as Record<string, unknown>;
  const cap = data?.google_daily_cap ?? 200;
  return {
    services: data?.services ?? [],
    qr_base_url: data?.qr_base_url ?? null,
    google_daily_cap: cap,
    updated_at: data?.updated_at ?? null,
    updated_by_name: data?.updated_by_name ?? null,
    own_url: await ownUrl(),
    can_edit: canEdit,
    google: { used: num(g["used"]), cap: num(g["cap"]) || cap, held: num(g["held"]) },
  };
}

export const getPublicFormSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PublicFormSettingsRead> => {
    const p = await office(context);
    return readSettings(context, isAdmin(p) || isManager(p));
  });

const settingsInput = z.object({
  services: z.array(z.string().max(200)).max(60),
  qr_base_url: z.string().max(300),
  google_daily_cap: z.number().int().min(0).max(100_000),
});

export const savePublicFormSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => settingsInput.parse(d))
  .handler(async ({ data, context }): Promise<PublicFormSettingsRead> => {
    const p = await office(context);
    if (!(isAdmin(p) || isManager(p))) throw new Error(PUBLIC_SETTINGS_NEED);
    const services = cleanServices(data.services);
    if (!services.ok) throw new Error(services.problem);
    const address = cleanQrAddress(data.qr_base_url);
    if (!address.ok) throw new Error(address.problem);
    const { data: saved, error } = await context.supabase
      .from("public_form_settings")
      .update({
        services: services.services,
        qr_base_url: address.url,
        google_daily_cap: data.google_daily_cap,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
        updated_by_name: (p.full_name ?? "").trim() || p.email || null,
      })
      .eq("id", 1)
      .select("id");
    if (error) throw new Error(error.message);
    if (!saved?.length)
      throw new Error("The settings were not saved. Reload the page and try again.");
    return readSettings(context, true);
  });
