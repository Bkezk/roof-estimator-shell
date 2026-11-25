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
  readUsage,
  requestBuilding,
  sameBuilding,
  siteAddressWords,
  siteBuilding,
  type CareSignUpPrefill,
  type PublicFormSettings,
  type PublicMatch,
  type PublicRequestRow,
  type PublicUsage,
} from "@/lib/public-requests";

export const PUBLIC_REQUESTS_NEED = "Requests from the public pages need Customers access";
export const PUBLIC_SETTINGS_NEED = "Only an admin or a manager changes the QR page settings";

type Ctx = { supabase: Parameters<typeof readProfile>[0]; userId: string };

/** A database function the generated types do not list yet. */
type LooseRpc = (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function office(ctx: Ctx) {
  const p = await readProfile(ctx.supabase, ctx.userId);
  if (!p || !canAccess(p, "customers")) throw new Error(PUBLIC_REQUESTS_NEED);
  return p;
}

const REQUEST_SELECT =
  "id, reference, kind, created_at, status, contact_name, company, phone, email, address, city, state, zip, building_name, referred_by, plan, sqft, size_range, sqft_source, shown_price, quote, pay_method, terms_version, agreed_by, several_buildings, notes, services, details, handled_at, handled_by_name, dismiss_reason, account_id, site_id, opportunity_id, roof_care_plan_id" as const;

/** The property a request was put on, beside the address the request itself names (Nov 26). */
export interface RequestSite {
  id: string;
  name: string;
  /** "120 Main St, London, KY 40741" */
  address: string;
  /** Is it the building the request names (sameBuilding)? */
  same_address: boolean;
}

export interface OpportunityRequest {
  request: PublicRequestRow;
  /** Customers who may be the sender. Worked out only while nobody has said whose it is. */
  matches: PublicMatch[];
  /**
   * The status of the plan the request became ("awaiting_payment", "active", "ended"), or
   * null: the strip says whether the plan still waits for its payment.
   */
  plan_status: string | null;
  /** Nov 26: the day a plan that was ended was ended, and whether it was ever paid. */
  plan_ended_on?: string | null;
  plan_paid?: boolean;
  /** Nov 26: the property the request is on, once somebody said whose it is. */
  site?: RequestSite | null;
}

type SiteRow = {
  id: string;
  account_id: string | null;
  name: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};
const SITE_COLUMNS = "id, account_id, name, address1, city, state, zip" as const;

/**
 * Each possible match with the property that is the request's own building, when the customer
 * has one (Nov 26; the audit's number 17). The database's list is generous on purpose: a
 * property is offered when its street starts with the same number and word. Here the customers'
 * properties are read, and the one whose address IS the request's (sameBuilding) is the one
 * offered; a match is marked `same_address` only then. A read that fails leaves every match
 * marked "not the same", so nothing starts by itself on a guess.
 */
async function matchesWithAddress(
  sb: Ctx["supabase"],
  r: PublicRequestRow,
  matches: PublicMatch[],
): Promise<PublicMatch[]> {
  if (!matches.length) return matches;
  const { data, error } = await sb
    .from("crm_sites")
    .select(SITE_COLUMNS)
    .in(
      "account_id",
      matches.map((m) => m.account_id),
    )
    .is("deleted_at", null)
    .limit(1000);
  if (error) {
    console.error(`Request ${r.reference}: the matches' properties were not read —`, error.message);
    return matches;
  }
  const sites = (data ?? []) as SiteRow[];
  const asked = requestBuilding(r);
  return matches.map((m) => {
    const own = sites.filter((s) => s.account_id === m.account_id);
    const exact = own.find((s) => sameBuilding(asked, siteBuilding(s)));
    const shown = exact ?? own.find((s) => s.id === m.site_id);
    if (!shown) return m;
    return {
      ...m,
      site_id: shown.id,
      site_name: (shown.name ?? "").trim() || null,
      site_address: siteAddressWords(shown) || m.site_address,
      same_address: !!exact,
    };
  });
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
      let plan_ended_on: string | null = null;
      let plan_paid = false;
      if (r.roof_care_plan_id) {
        const plan = await sb
          .from("roof_care_plans")
          .select("status, ended_on, paid_on")
          .eq("id", r.roof_care_plan_id)
          .maybeSingle();
        plan_status = plan.data?.status ?? null;
        plan_ended_on = plan.data?.ended_on ?? null;
        plan_paid = !!plan.data?.paid_on;
      }
      // Nov 26: the property it was put on, beside the address they typed. A plan starts by
      // itself only at the same building; anywhere else the office looks at both first.
      let site: RequestSite | null = null;
      if (r.site_id && !r.roof_care_plan_id) {
        const s = await sb.from("crm_sites").select(SITE_COLUMNS).eq("id", r.site_id).maybeSingle();
        const row = (s.data ?? null) as SiteRow | null;
        if (row)
          site = {
            id: row.id,
            name: (row.name ?? "").trim(),
            address: siteAddressWords(row),
            same_address: sameBuilding(requestBuilding(r), siteBuilding(row)),
          };
      }
      return { request: r, matches: [], plan_status, plan_ended_on, plan_paid, site };
    }
    const found = await sb.rpc("public_request_matches", { p_id: r.id });
    if (found.error) throw new Error(`The possible matches: ${found.error.message}`);
    return {
      request: r,
      matches: await matchesWithAddress(sb, r, readMatches(found.data)),
      plan_status: null,
    };
  });

/**
 * "I am answering this request" (Nov 26; the audit's number 15). The notice of a new request
 * goes to every admin and manager at once, and two of them answering it made two customers and
 * two plans. The page calls this before it makes a customer or a property: the database takes
 * the request for this person, or refuses in plain words when somebody already answered it or
 * is answering it right now (public_request_claim). The one refused has made nothing.
 */
export const claimPublicRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await office(context);
    const { error } = await (context.supabase as unknown as { rpc: LooseRpc }).rpc(
      "public_request_claim",
      { p_id: data.id },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
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
  .handler(({ data, context }): Promise<PublicRequestRow> => handleRequest(context, data));

/** The same, for a server function that has already been handed the request (Nov 24). */
export async function handleRequest(
  context: Ctx,
  data: z.infer<typeof handleInput>,
): Promise<PublicRequestRow> {
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
}

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
  .handler(({ data, context }): Promise<CareSignUpPrefill | null> =>
    readCarePrefill(context, data.id, data.site_id),
  );

/** The same reading, for a server function that starts the plan from the request (Nov 24). */
export async function readCarePrefill(
  context: Ctx,
  id: string,
  siteId?: string,
): Promise<CareSignUpPrefill | null> {
  const r = await readRequest(context, id);
  if (!r || r.status === "dismissed") return null;
  if (siteId && r.site_id && r.site_id !== siteId) return null;
  return carePrefill(r);
}

/**
 * One request as it stands now, for the office (Nov 26): whose it is, and the plan it became.
 * Starting a plan reads it fresh, so an answer somebody else gave a moment ago is seen.
 */
export async function readRequest(context: Ctx, id: string): Promise<PublicRequestRow | null> {
  await office(context);
  const { data: row, error } = await context.supabase
    .from("public_requests")
    .select(REQUEST_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return row as unknown as PublicRequestRow | null;
}

export interface PublicFormSettingsRead extends PublicFormSettings {
  /** The site's own address, which the codes hold while no other is saved. */
  own_url: string;
  /** Whether this person may change the settings. */
  can_edit: boolean;
  /** Today's Google drive lookups: used, the limit, and how many went to the free router. */
  google: { used: number; cap: number; held: number };
  /** Today's counts of the public pages and the day's emails; null when they could not be read. */
  usage: PublicUsage | null;
  /** The day's email limit on the email plan (0: none). */
  email_daily_cap: number;
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
  const [{ data, error }, today, counts] = await Promise.all([
    sb
      .from("public_form_settings")
      .select("services, qr_base_url, google_daily_cap, updated_at, updated_by_name")
      .eq("id", 1)
      .maybeSingle(),
    sb.rpc("google_route_today"),
    // Nov 24: today's counts beside their limits, and the day's emails. A read that fails
    // leaves the box out; the settings still show.
    (sb as unknown as { rpc: LooseRpc }).rpc("public_form_usage"),
  ]);
  if (error) throw new Error(error.message);
  if (counts.error) console.error("QR pages: the counts were not read —", counts.error.message);
  const usage = counts.error ? null : readUsage(counts.data);
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
    usage,
    email_daily_cap: usage ? usage.email.cap : 100,
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
  /** The day's email limit on the email plan; 0 for a plan with none. Left out = unchanged. */
  email_daily_cap: z.number().int().min(0).max(1_000_000).optional(),
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
    if (data.email_daily_cap != null) {
      const set = await (context.supabase as unknown as { rpc: LooseRpc }).rpc(
        "email_daily_cap_set",
        { p_cap: data.email_daily_cap },
      );
      if (set.error) throw new Error(`The email limit was not saved: ${set.error.message}`);
    }
    return readSettings(context, true);
  });
