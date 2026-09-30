/**
 * CRM hub — customer accounts and their sites (docs/service-module-design.md §11). An account
 * is a company / group or an individual; bids and service tickets link to it. Prospecting's
 * buildings are NOT the CRM: "Import into CRM" only prefills an account from a building.
 *
 * Reading needs Customers, Service or Estimate access (the typeahead on a ticket or a bid);
 * writing needs Customers or Service (an office user creating a ticket can add the customer).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database } from "@/integrations/supabase/types";
import { canAccess } from "@/lib/access";
import {
  accountSchema,
  optText,
  parseInput,
  quickAccountSchema,
  type AccountInput,
  type QuickAccountInput,
} from "@/lib/crm-account";
import { namesLookAlike } from "@/lib/name-match";

export type { AccountInput, QuickAccountInput };

export type AccountRow = Database["public"]["Tables"]["crm_accounts"]["Row"];
export type SiteRow = Database["public"]["Tables"]["crm_sites"]["Row"];
export type AccountKind = "company" | "individual";

type Ctx = { supabase: SupabaseClient<Database>; userId: string };

async function me(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, full_name, email")
    .eq("id", ctx.userId)
    .maybeSingle();
  return data;
}
async function readAccess(ctx: Ctx) {
  const p = await me(ctx);
  if (!p || !(canAccess(p, "customers") || canAccess(p, "service") || canAccess(p, "estimate")))
    throw new Error("Forbidden: Customers access required");
  return p;
}
async function writeAccess(ctx: Ctx) {
  const p = await me(ctx);
  if (!p || !(canAccess(p, "customers") || canAccess(p, "service")))
    throw new Error("Forbidden: Customers access required");
  return p;
}
const nameOf = (p: { full_name: string | null; email: string } | null) =>
  (p?.full_name ?? "").trim() || p?.email || null;

/** One line of a site's address for lists and snapshots. */
export function siteAddressLine(
  s: Pick<SiteRow, "address1" | "address2" | "city" | "state" | "zip"> | null | undefined,
): string {
  if (!s) return "";
  const street = [s.address1, s.address2].filter((x) => x && x.trim()).join(", ");
  const cityLine = [s.city, [s.state, s.zip].filter((x) => x && x.trim()).join(" ")]
    .filter((x) => x && x.trim())
    .join(", ");
  return [street, cityLine].filter(Boolean).join(", ");
}

/** A typeahead hit: an account, or one of its sites (with the account named). */
export interface AccountHit {
  account_id: string;
  account_name: string;
  kind: AccountKind;
  site_id: string | null;
  site_name: string | null;
  site_address: string;
  contact_name: string | null;
  phone: string | null;
}

/** Accounts and sites whose name matches `q` (prefix or word match), for the typeaheads. */
export const searchAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ q: z.string().trim().max(120) }).parse(d))
  .handler(async ({ data, context }): Promise<AccountHit[]> => {
    await readAccess(context);
    const sb = context.supabase;
    const q = data.q.replace(/[%_,]/g, " ").trim();
    const like = q ? `%${q}%` : "%";
    const [{ data: accounts, error: aErr }, { data: sites, error: sErr }] = await Promise.all([
      sb
        .from("crm_accounts")
        .select("id, name, kind, contact_name, phone")
        .is("deleted_at", null)
        .ilike("name", like)
        .order("name")
        .limit(25),
      sb
        .from("crm_sites")
        .select(
          "id, name, address1, address2, city, state, zip, account:crm_accounts!crm_sites_account_id_fkey(id, name, kind, contact_name, phone, deleted_at)",
        )
        .is("deleted_at", null)
        .ilike("name", like)
        .order("name")
        .limit(25),
    ]);
    if (aErr) throw new Error(aErr.message);
    if (sErr) throw new Error(sErr.message);
    const hits: AccountHit[] = (accounts ?? []).map((a) => ({
      account_id: a.id,
      account_name: a.name,
      kind: a.kind === "individual" ? "individual" : "company",
      site_id: null,
      site_name: null,
      site_address: "",
      contact_name: a.contact_name,
      phone: a.phone,
    }));
    for (const s of sites ?? []) {
      const a = s.account as unknown as {
        id: string;
        name: string;
        kind: string;
        contact_name: string | null;
        phone: string | null;
        deleted_at: string | null;
      } | null;
      if (!a || a.deleted_at) continue;
      hits.push({
        account_id: a.id,
        account_name: a.name,
        kind: a.kind === "individual" ? "individual" : "company",
        site_id: s.id,
        site_name: s.name,
        site_address: siteAddressLine(s),
        contact_name: a.contact_name,
        phone: a.phone,
      });
    }
    // Prefix matches first, then the rest alphabetically.
    const lq = q.toLowerCase();
    const key = (h: AccountHit) => (h.site_name ?? h.account_name).toLowerCase();
    hits.sort((x, y) => {
      const px = lq && key(x).startsWith(lq) ? 0 : 1;
      const py = lq && key(y).startsWith(lq) ? 0 : 1;
      return px - py || key(x).localeCompare(key(y));
    });
    return hits.slice(0, 30);
  });

export interface AccountListRow extends AccountRow {
  site_count: number;
  open_jobs: number;
}

export const listAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountListRow[]> => {
    await readAccess(context);
    const sb = context.supabase;
    const [{ data: accounts, error }, { data: sites }, { data: jobs }] = await Promise.all([
      sb.from("crm_accounts").select("*").is("deleted_at", null).order("name").limit(2000),
      sb.from("crm_sites").select("account_id").is("deleted_at", null),
      sb
        .from("service_jobs")
        .select("account_id")
        .is("deleted_at", null)
        .in("stage", ["open", "scheduled", "done"]),
    ]);
    if (error) throw new Error(error.message);
    const siteCount = new Map<string, number>();
    for (const s of sites ?? [])
      siteCount.set(s.account_id, (siteCount.get(s.account_id) ?? 0) + 1);
    const jobCount = new Map<string, number>();
    for (const j of jobs ?? [])
      if (j.account_id) jobCount.set(j.account_id, (jobCount.get(j.account_id) ?? 0) + 1);
    return (accounts ?? []).map((a) => ({
      ...a,
      site_count: siteCount.get(a.id) ?? 0,
      open_jobs: jobCount.get(a.id) ?? 0,
    }));
  });

export interface LinkedBidRow {
  id: string;
  name: string;
  status: string;
  grand_total: number;
  updated_at: string;
}
export interface AccountDetail {
  account: AccountRow;
  sites: SiteRow[];
  jobs: Database["public"]["Tables"]["service_jobs"]["Row"][];
  /** Bids linked to the account — empty when the reader has no Estimate access. */
  bids: LinkedBidRow[];
}

export const getAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<AccountDetail> => {
    const p = await readAccess(context);
    const sb = context.supabase;
    const [{ data: account, error }, { data: sites }, { data: jobs }] = await Promise.all([
      sb.from("crm_accounts").select("*").eq("id", data.id).maybeSingle(),
      sb
        .from("crm_sites")
        .select("*")
        .eq("account_id", data.id)
        .is("deleted_at", null)
        .order("name"),
      sb
        .from("service_jobs")
        .select("*")
        .eq("account_id", data.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(200),
    ]);
    if (error) throw new Error(error.message);
    if (!account) throw new Error("Customer not found");
    let bids: LinkedBidRow[] = [];
    if (canAccess(p, "estimate")) {
      const { data: b } = await sb
        .from("bids")
        .select("id, name, status, grand_total, updated_at")
        .eq("account_id", data.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(200);
      bids = (b ?? []) as LinkedBidRow[];
    }
    return { account, sites: sites ?? [], jobs: jobs ?? [], bids };
  });

/** Drop the keys a caller left out, so an update leaves those columns as they are. */
const defined = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

/**
 * Create (no id) or update an account. Returns the saved row. Needs an email, a cell phone or
 * an office phone (crm-account.ts; the database checks it too).
 */
export const saveAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(accountSchema, d))
  .handler(async ({ data, context }): Promise<AccountRow> => {
    const p = await writeAccess(context);
    const sb = context.supabase;
    const { id, source, ...fields } = data;
    const patch = { ...defined(fields), updated_by_name: nameOf(p) };
    if (id) {
      const { data: row, error } = await sb
        .from("crm_accounts")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await sb
      .from("crm_accounts")
      .insert({ ...patch, source: source ?? "manual", created_by: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const siteSchema = z.object({
  id: z.string().uuid().optional(),
  account_id: z.string().uuid(),
  name: z.string().trim().min(1, "Site name is required").max(200),
  address1: optText(200),
  address2: optText(200),
  city: optText(120),
  state: optText(20),
  zip: optText(20),
  technician_instructions: optText(2000),
  notes: optText(5000),
});
export type SiteInput = z.input<typeof siteSchema>;

export const saveSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => siteSchema.parse(d))
  .handler(async ({ data, context }): Promise<SiteRow> => {
    await writeAccess(context);
    const sb = context.supabase;
    const { id, ...fields } = data;
    if (id) {
      const { data: row, error } = await sb
        .from("crm_sites")
        .update(fields)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await sb.from("crm_sites").insert(fields).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

/**
 * The one-step "new customer" from the Customers page or a ticket's / bid's customer search: the
 * account only, no site (owner, Sep 30: sites are added under the account afterwards). Needs an
 * email, a cell phone or an office phone.
 */
export const quickCreateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(quickAccountSchema, d))
  .handler(async ({ data, context }): Promise<AccountHit> => {
    const p = await writeAccess(context);
    const sb = context.supabase;
    const { source, ...fields } = data;
    const { data: account, error } = await sb
      .from("crm_accounts")
      .insert({
        ...defined(fields),
        source: source ?? "manual",
        created_by: context.userId,
        updated_by_name: nameOf(p),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return {
      account_id: account.id,
      account_name: account.name,
      kind: data.kind,
      site_id: null,
      site_name: null,
      site_address: "",
      contact_name: account.contact_name,
      phone: account.phone ?? account.mobile,
    };
  });

/** A user who can be a customer's account manager. */
export interface CrmUserOption {
  id: string;
  name: string;
}

/**
 * Every user, for the Account manager pickers and the Customers filter. `crm_user_options()` is
 * SECURITY DEFINER because profiles RLS hides other users' rows from non-admins.
 */
export const listCrmUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CrmUserOption[]> => {
    await readAccess(context);
    const { data, error } = await context.supabase.rpc("crm_user_options");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, name: (r.full_name ?? "").trim() || r.email }));
  });

/** Soft delete; tickets and bids keep their snapshot names and lose the link on purge. */
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    await writeAccess(context);
    const { error } = await context.supabase
      .from("crm_accounts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
  });

export const deleteSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    await writeAccess(context);
    const { error } = await context.supabase
      .from("crm_sites")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
  });

/** Link a saved bid to an account (and optionally a site) — the reverse of the Setup typeahead. */
export const linkBidToAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        bid_id: z.string().uuid(),
        account_id: z.string().uuid().nullable(),
        site_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<void> => {
    const p = await me(context);
    if (!p || !canAccess(p, "estimate")) throw new Error("Forbidden: Estimate access required");
    const { error } = await context.supabase
      .from("bids")
      .update({ account_id: data.account_id, site_id: data.site_id ?? null })
      .eq("id", data.bid_id);
    if (error) throw new Error(error.message);
  });

/** Saved bids not yet linked to any account, for the account page's "Link a bid" search. */
export const listUnlinkedBids = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ q: z.string().trim().max(120) }).parse(d))
  .handler(async ({ data, context }): Promise<LinkedBidRow[]> => {
    const p = await me(context);
    if (!p || !canAccess(p, "estimate")) return [];
    const q = data.q.replace(/[%_,]/g, " ").trim();
    const { data: rows, error } = await context.supabase
      .from("bids")
      .select("id, name, status, grand_total, updated_at")
      .is("deleted_at", null)
      .is("account_id", null)
      .ilike("name", q ? `%${q}%` : "%")
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return (rows ?? []) as LinkedBidRow[];
  });

/**
 * Saved bids that look like they belong to an account but are not linked to any (owner, Sep
 * 27: "a new Knox County customer should be offered the Knox County bid"). A bid matches when
 * its name or its saved customer name contains the account name, or the account name contains
 * the bid's customer name. Empty for readers without Estimate access.
 */
export const suggestBidsForAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ account_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<LinkedBidRow[]> => {
    const p = await me(context);
    if (!p || !canAccess(p, "estimate")) return [];
    const sb = context.supabase;
    const { data: account } = await sb
      .from("crm_accounts")
      .select("name")
      .eq("id", data.account_id)
      .maybeSingle();
    const name = (account?.name ?? "").trim();
    if (name.length < 3) return [];
    const { data: rows, error } = await sb
      .from("bids")
      .select("id, name, status, grand_total, updated_at, customer_name:data->customer->>name")
      .is("deleted_at", null)
      .is("account_id", null)
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const out: LinkedBidRow[] = [];
    for (const r of (rows ?? []) as unknown as (LinkedBidRow & {
      customer_name?: string | null;
    })[]) {
      // Word-by-word with typo tolerance (name-match.ts): "broad head elementry" finds the
      // "Broad Head Elementary" bid.
      const cust = (r.customer_name ?? "").trim();
      const hit = namesLookAlike(name, r.name) || (cust.length >= 3 && namesLookAlike(name, cust));
      if (hit)
        out.push({
          id: r.id,
          name: r.name,
          status: r.status,
          grand_total: r.grand_total,
          updated_at: r.updated_at,
        });
      if (out.length >= 20) break;
    }
    return out;
  });

// ---------------------------------------------------------------------------------------------
// Contacts (phase B): people at an account, optionally tied to specific sites.
export type ContactRow = Database["public"]["Tables"]["crm_contacts"]["Row"];
export interface ContactWithSites extends ContactRow {
  site_ids: string[];
}

export const listContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ account_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ContactWithSites[]> => {
    await readAccess(context);
    const sb = context.supabase;
    const { data: rows, error } = await sb
      .from("crm_contacts")
      .select("*")
      .eq("account_id", data.account_id)
      .is("deleted_at", null)
      .order("is_billing", { ascending: false })
      .order("name");
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r) => r.id);
    const { data: links } = ids.length
      ? await sb.from("crm_site_contacts").select("site_id, contact_id").in("contact_id", ids)
      : { data: [] as { site_id: string; contact_id: string }[] };
    return (rows ?? []).map((r) => ({
      ...r,
      site_ids: (links ?? []).filter((l) => l.contact_id === r.id).map((l) => l.site_id),
    }));
  });

const contactSchema = z.object({
  id: z.string().uuid().optional(),
  account_id: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(200),
  position: optText(200),
  email: optText(200),
  mobile: optText(60),
  office_phone: optText(60),
  is_billing: z.boolean().optional(),
  notes: optText(2000),
  /** Sites this contact belongs to (empty = the whole account). */
  site_ids: z.array(z.string().uuid()).max(200).optional(),
});
export type ContactInput = z.input<typeof contactSchema>;

export const saveContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => contactSchema.parse(d))
  .handler(async ({ data, context }): Promise<ContactWithSites> => {
    await writeAccess(context);
    const sb = context.supabase;
    const { id, site_ids, ...fields } = data;
    const row = { ...fields, is_billing: fields.is_billing ?? false };
    let saved: ContactRow;
    if (id) {
      const { data: r, error } = await sb
        .from("crm_contacts")
        .update(row)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      saved = r;
    } else {
      const { data: r, error } = await sb.from("crm_contacts").insert(row).select("*").single();
      if (error) throw new Error(error.message);
      saved = r;
    }
    if (site_ids) {
      await sb.from("crm_site_contacts").delete().eq("contact_id", saved.id);
      if (site_ids.length) {
        const { error: lErr } = await sb
          .from("crm_site_contacts")
          .insert(site_ids.map((site_id) => ({ site_id, contact_id: saved.id })));
        if (lErr) throw new Error(lErr.message);
      }
    }
    return { ...saved, site_ids: site_ids ?? [] };
  });

export const deleteContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<void> => {
    await writeAccess(context);
    const { error } = await context.supabase
      .from("crm_contacts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
  });
