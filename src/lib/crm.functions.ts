/**
 * CRM hub — customer accounts and their sites (docs/service-module-design.md §11). An account
 * is a company / group or an individual; bids and service tickets link to it. Prospecting's
 * buildings are NOT the CRM: "Import into CRM" only prefills an account from a building.
 *
 * Reading needs Customers, Service or Estimate access (the typeahead on a ticket or a bid);
 * writing needs Customers or Service (an office user creating a ticket can add the customer).
 * Every write to a customer, a site, a contact or a contact's sites is logged by the database
 * (trigger audit_row → audit_log, migration 20261001080000; owner, Oct 1: "whatever is changed
 * needs to be logged somewhere showing what they did, when, and who"), by everyone; admins and
 * managers read it in the customer's History. Nothing here logs.
 *
 * Deleting a customer (audit, Oct 2) is refused while it has open tickets or open opportunities,
 * refused again once deleted, and soft-deletes its live sites and contacts with the same stamp
 * so they leave every search; restoreAccount (admins and managers) brings back the customer and
 * the sites and contacts that went with it (same deleted_at), not ones deleted on their own
 * before. A deleted customer still opens by id (old links, a ticket's customer chip) but takes no
 * change: saveAccount, saveSite and saveContact refuse it (ACCOUNT_DELETED).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import type { Database, Json } from "@/integrations/supabase/types";
import { canAccess, seesEveryone } from "@/lib/access";
import {
  ACCOUNT_ALREADY_DELETED,
  ACCOUNT_DELETED,
  OPEN_OPPORTUNITY_STATUSES,
  OPEN_TICKET_STAGES,
  CRM_MAX,
  accountSchema,
  deleteBlockedMessage,
  keepText,
  normalizeAddress,
  parseInput,
  quickAccountSchema,
  type AccountInput,
  type QuickAccountInput,
} from "@/lib/crm-account";
import { namesLookAlike } from "@/lib/name-match";
import {
  SEARCH_LIMIT,
  ilikePattern,
  orIlike,
  shapeAccountHits,
  type SearchSiteRow,
} from "@/lib/account-search";
import { countBy, fetchAllPages } from "@/lib/paging";

export type { AccountInput, QuickAccountInput };

export type AccountRow = Database["public"]["Tables"]["crm_accounts"]["Row"];
export type SiteRow = Database["public"]["Tables"]["crm_sites"]["Row"];
export type AccountKind = "company" | "individual";

type Ctx = { supabase: SupabaseClient<Database>; userId: string };

async function me(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("profiles")
    .select("role, access, technician, full_name, email")
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

/** Refuse a change under a customer that is gone (not found, or deleted). */
async function assertLiveAccount(sb: SupabaseClient<Database>, accountId: string) {
  const { data, error } = await sb
    .from("crm_accounts")
    .select("id, deleted_at")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Customer not found");
  if (data.deleted_at) throw new Error(ACCOUNT_DELETED);
}

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

/**
 * A typeahead hit: one customer (owner, Oct 1: the search lists customers only, never sites). A
 * customer with exactly one live site carries it in the site fields, so a pick selects it;
 * otherwise they are null and the form's site box picks one.
 */
export interface AccountHit {
  account_id: string;
  account_name: string;
  kind: AccountKind;
  site_id: string | null;
  site_name: string | null;
  site_address: string;
  /** The customer's live sites. */
  site_count: number;
  contact_name: string | null;
  phone: string | null;
}

/**
 * Customers whose name matches `q` — or who have a live site whose name or address matches it
 * (typing a site still finds its customer; the row is always the customer, never the site) — for
 * the typeaheads (lib/account-search.ts shapes the rows).
 */
export const searchAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(z.object({ q: z.string().trim().max(120) }), d))
  .handler(async ({ data, context }): Promise<AccountHit[]> => {
    await readAccess(context);
    const sb = context.supabase;
    const q = data.q.trim();
    // Reserved characters become "_" (account-search.ts): nothing typed is PostgREST syntax.
    const like = ilikePattern(q);
    const { data: accounts, error: aErr } = await sb
      .from("crm_accounts")
      .select("id, name, kind, contact_name, phone")
      .is("deleted_at", null)
      .ilike("name", like)
      .order("name")
      .limit(SEARCH_LIMIT);
    if (aErr) throw new Error(aErr.message);
    // Customers found through a site (its name or street): the search box used to list the site
    // itself; now the site only leads to its customer.
    let viaSite: typeof accounts = [];
    if (q) {
      const { data: siteHits, error: shErr } = await sb
        .from("crm_sites")
        .select("account_id")
        .is("deleted_at", null)
        .or(orIlike(["name", "address1"], like))
        .limit(SEARCH_LIMIT * 4);
      if (shErr) throw new Error(shErr.message);
      const known = new Set((accounts ?? []).map((a) => a.id));
      const extra = [...new Set((siteHits ?? []).map((s) => s.account_id))].filter(
        (id) => !known.has(id),
      );
      if (extra.length) {
        const { data: more, error: mErr } = await sb
          .from("crm_accounts")
          .select("id, name, kind, contact_name, phone")
          .is("deleted_at", null)
          .in("id", extra.slice(0, SEARCH_LIMIT))
          .order("name");
        if (mErr) throw new Error(mErr.message);
        viaSite = more ?? [];
      }
    }
    const found = [...(accounts ?? []), ...viaSite];
    // The live sites of those customers: counted per customer, and the only one carried.
    const ids = found.map((a) => a.id);
    let sites: SearchSiteRow[] = [];
    if (ids.length) {
      const { data: rows, error: sErr } = await sb
        .from("crm_sites")
        .select("id, account_id, name, address1, address2, city, state, zip")
        .in("account_id", ids)
        .is("deleted_at", null);
      if (sErr) throw new Error(sErr.message);
      sites = (rows ?? []).map((s) => ({
        id: s.id,
        account_id: s.account_id,
        name: s.name,
        address: siteAddressLine(s),
      }));
    }
    return shapeAccountHits(q, found, sites);
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
    // Every row, 1,000 at a time (paging.ts: PostgREST caps a request at 1,000 rows, so
    // asking for 2,000 stopped at 1,000 customers and the counts at 1,000 sites / tickets).
    // Ordered by a unique column last, so no row repeats or drops between pages.
    const [accounts, sites, jobs] = await Promise.all([
      fetchAllPages((from, to) =>
        sb
          .from("crm_accounts")
          .select("*")
          .is("deleted_at", null)
          .order("name")
          .order("id")
          .range(from, to),
      ),
      fetchAllPages((from, to) =>
        sb
          .from("crm_sites")
          .select("id, account_id")
          .is("deleted_at", null)
          .order("id")
          .range(from, to),
      ),
      fetchAllPages((from, to) =>
        sb
          .from("service_jobs")
          .select("id, account_id")
          .is("deleted_at", null)
          .in("stage", [...OPEN_TICKET_STAGES])
          .order("id")
          .range(from, to),
      ),
    ]);
    const siteCount = countBy(sites, (s) => s.account_id);
    const jobCount = countBy(jobs, (j) => j.account_id);
    return accounts.map((a) => ({
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
  /** Deleted ones too (deleted_at set): an old link shows it with a banner, read-only. */
  account: AccountRow;
  /**
   * Who deleted it (the audit log's delete row), when it is deleted and the reader may read the
   * log (admins and managers); otherwise null and the banner shows the date alone.
   */
  deleted_by: string | null;
  sites: SiteRow[];
  jobs: Database["public"]["Tables"]["service_jobs"]["Row"][];
  /** Bids linked to the account — empty when the reader has no Estimate access. */
  bids: LinkedBidRow[];
  /**
   * The customer's tasks (owner, Oct 9: a Tasks list on a customer, like Tickets): whole rows,
   * so the Tasks section opens one in the task dialog. Admins and managers get them all; anyone
   * else what tasks RLS lets through (their own, and open unassigned ones).
   */
  tasks: Database["public"]["Tables"]["tasks"]["Row"][];
}

export const getAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(z.object({ id: z.string().uuid() }), d))
  .handler(async ({ data, context }): Promise<AccountDetail> => {
    const p = await readAccess(context);
    const sb = context.supabase;
    const [{ data: account, error }, { data: sites }, { data: jobs }, { data: tasks }] =
      await Promise.all([
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
        // Every column (done_by / done_by_name arrive with 20261009100000; a named list would fail
        // until it is applied). The section orders them (tasks.ts orderAccountTasks).
        sb
          .from("tasks")
          .select("*")
          .eq("account_id", data.id)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(200),
      ]);
    if (error) throw new Error(error.message);
    if (!account) throw new Error("Customer not found");
    let deleted_by: string | null = null;
    if (account.deleted_at) {
      // Best effort: the log is an admin's or a manager's to read (RLS); anyone else gets none.
      const { data: logged } = await sb
        .from("audit_log")
        .select("by_name, at")
        .eq("entity", "account")
        .eq("entity_id", data.id)
        .eq("action", "delete")
        .order("at", { ascending: false })
        .limit(1);
      deleted_by = (logged?.[0]?.by_name ?? "").trim() || null;
    }
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
    return { account, deleted_by, sites: sites ?? [], jobs: jobs ?? [], bids, tasks: tasks ?? [] };
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
      await assertLiveAccount(sb, id);
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

/**
 * A site's fields. Every optional one left out stays as it is (keepText: missing = unchanged,
 * "" or null = clear; audit, Oct 2: a save that did not send the notes wiped them);
 * county_code_id: null clears the JBK county code, left out keeps it. A state with no other
 * address part is stored as no address (normalizeAddress).
 */
export const siteSchema = z
  .object({
    id: z.string().uuid().optional(),
    account_id: z.string().uuid(),
    name: z.string().trim().min(1, "Property name is required").max(CRM_MAX.name),
    address1: keepText(CRM_MAX.address1),
    address2: keepText(CRM_MAX.address2),
    city: keepText(CRM_MAX.city),
    state: keepText(CRM_MAX.state),
    zip: keepText(CRM_MAX.zip),
    technician_instructions: keepText(CRM_MAX.technician_instructions),
    notes: keepText(CRM_MAX.notes),
    county_code_id: z.string().uuid().nullable().optional(),
  })
  .transform((s) => normalizeAddress(s));
export type SiteInput = z.input<typeof siteSchema>;

export const saveSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(siteSchema, d))
  .handler(async ({ data, context }): Promise<SiteRow> => {
    await writeAccess(context);
    const sb = context.supabase;
    const { id, ...rest } = data;
    await assertLiveAccount(sb, data.account_id);
    // A county code left out stays as it is.
    const fields = defined(rest);
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
      site_count: 0,
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

/**
 * Soft delete; tickets and bids keep their snapshot names and lose the link on purge. Refused
 * while the customer has open tickets (open / scheduled / done) or open opportunities (open /
 * contacted / quoted), and when it is already deleted (nothing is written). Its live sites and
 * contacts are deleted with it, with the same stamp, so they leave the searches; the database
 * logs each row (audit_row).
 */
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(z.object({ id: z.string().uuid() }), d))
  .handler(async ({ data, context }): Promise<void> => {
    const p = await writeAccess(context);
    const sb = context.supabase;
    const { data: account, error: aErr } = await sb
      .from("crm_accounts")
      .select("id, deleted_at")
      .eq("id", data.id)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!account) throw new Error("Customer not found");
    if (account.deleted_at) throw new Error(ACCOUNT_ALREADY_DELETED);
    const [{ data: tickets, error: tErr }, { data: opps, error: oErr }] = await Promise.all([
      sb
        .from("service_jobs")
        .select("id")
        .eq("account_id", data.id)
        .is("deleted_at", null)
        .in("stage", [...OPEN_TICKET_STAGES])
        .limit(1000),
      sb
        .from("crm_opportunities")
        .select("id")
        .eq("account_id", data.id)
        .is("deleted_at", null)
        .in("status", [...OPEN_OPPORTUNITY_STATUSES])
        .limit(1000),
    ]);
    if (tErr) throw new Error(tErr.message);
    if (oErr) throw new Error(oErr.message);
    const blocked = deleteBlockedMessage(tickets?.length ?? 0, opps?.length ?? 0);
    if (blocked) throw new Error(blocked);
    // One stamp for the customer, its sites and its contacts: restoreAccount brings back
    // exactly the rows deleted with it.
    const stamp = new Date().toISOString();
    const { data: row, error } = await sb
      .from("crm_accounts")
      .update({ deleted_at: stamp, updated_by_name: nameOf(p) })
      .eq("id", data.id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error(ACCOUNT_ALREADY_DELETED);
    const { error: sErr } = await sb
      .from("crm_sites")
      .update({ deleted_at: stamp })
      .eq("account_id", data.id)
      .is("deleted_at", null);
    if (sErr) throw new Error(sErr.message);
    const { error: cErr } = await sb
      .from("crm_contacts")
      .update({ deleted_at: stamp })
      .eq("account_id", data.id)
      .is("deleted_at", null);
    if (cErr) throw new Error(cErr.message);
  });

/**
 * Undo deleteAccount: admins and managers only. Clears deleted_at on the customer and on the
 * sites and contacts deleted with it (the same stamp); a site or contact deleted on its own
 * before stays deleted.
 */
export const restoreAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(z.object({ id: z.string().uuid() }), d))
  .handler(async ({ data, context }): Promise<void> => {
    const p = await me(context);
    if (!seesEveryone(p)) throw new Error("Only an admin or a manager can restore a customer");
    const sb = context.supabase;
    const { data: account, error: aErr } = await sb
      .from("crm_accounts")
      .select("id, deleted_at")
      .eq("id", data.id)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!account) throw new Error("Customer not found");
    const stamp = account.deleted_at;
    if (!stamp) throw new Error("This customer is not deleted");
    const { error } = await sb
      .from("crm_accounts")
      .update({ deleted_at: null, updated_by_name: nameOf(p) })
      .eq("id", data.id)
      .eq("deleted_at", stamp);
    if (error) throw new Error(error.message);
    const { error: sErr } = await sb
      .from("crm_sites")
      .update({ deleted_at: null })
      .eq("account_id", data.id)
      .eq("deleted_at", stamp);
    if (sErr) throw new Error(sErr.message);
    const { error: cErr } = await sb
      .from("crm_contacts")
      .update({ deleted_at: null })
      .eq("account_id", data.id)
      .eq("deleted_at", stamp);
    if (cErr) throw new Error(cErr.message);
  });

export const deleteSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(z.object({ id: z.string().uuid() }), d))
  .handler(async ({ data, context }): Promise<void> => {
    await writeAccess(context);
    // Once deleted it keeps its stamp (a deleted customer's rows are restored by that stamp).
    const { data: row, error } = await context.supabase
      .from("crm_sites")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id)
      .is("deleted_at", null)
      .select("id, name")
      .maybeSingle();
    if (error) throw new Error(error.message);
  });

/** Link a saved bid to an account (and optionally a site) — the reverse of the Setup typeahead. */
export const linkBidToAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    parseInput(
      z.object({
        bid_id: z.string().uuid(),
        account_id: z.string().uuid().nullable(),
        site_id: z.string().uuid().nullable().optional(),
      }),
      d,
    ),
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
  .validator((d: unknown) => parseInput(z.object({ q: z.string().trim().max(120) }), d))
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
  .validator((d: unknown) => parseInput(z.object({ account_id: z.string().uuid() }), d))
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
  .validator((d: unknown) => parseInput(z.object({ account_id: z.string().uuid() }), d))
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

/**
 * A contact's fields: every optional one left out stays as it is (keepText; is_billing too), ""
 * or null clears it. site_ids left out keeps the contact's site links.
 */
export const contactSchema = z.object({
  id: z.string().uuid().optional(),
  account_id: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(CRM_MAX.name),
  position: keepText(CRM_MAX.position),
  email: keepText(CRM_MAX.email),
  mobile: keepText(CRM_MAX.mobile),
  office_phone: keepText(CRM_MAX.office_phone),
  is_billing: z.boolean().optional(),
  notes: keepText(CRM_MAX.contact_notes),
  /** Sites this contact belongs to (empty = the whole account). */
  site_ids: z.array(z.string().uuid()).max(200).optional(),
});
export type ContactInput = z.input<typeof contactSchema>;

/**
 * The arguments of save_contact_with_sites (migration 20261002130000_audit_readable.sql): the
 * contact's fields that were sent (a key left out = that column unchanged; no id = a new
 * contact), and its sites (null = links unchanged). One call, one transaction: the contact and
 * its links are saved together or not at all (audit, Oct 2: a failed link insert after the
 * contact insert left a duplicate contact on retry).
 */
export function saveContactArgs(data: z.output<typeof contactSchema>): {
  p_contact: Json;
  p_site_ids: string[] | null;
} {
  const { site_ids, ...fields } = data;
  return {
    p_contact: defined(fields) as Json,
    p_site_ids: site_ids ? [...new Set(site_ids)] : null,
  };
}

export const saveContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(contactSchema, d))
  .handler(async ({ data, context }): Promise<ContactWithSites> => {
    await writeAccess(context);
    const sb = context.supabase;
    await assertLiveAccount(sb, data.account_id);
    // Under the caller's RLS (security invoker); only the sites that changed are unlinked /
    // linked, so the audit log records "site 'X' linked / unlinked" for those alone.
    const { data: saved, error } = await sb.rpc("save_contact_with_sites", saveContactArgs(data));
    if (error) throw new Error(error.message);
    if (!saved) throw new Error("The contact was not saved");
    return saved as unknown as ContactWithSites;
  });

export const deleteContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(z.object({ id: z.string().uuid() }), d))
  .handler(async ({ data, context }): Promise<void> => {
    await writeAccess(context);
    // Once deleted it keeps its stamp (a deleted customer's rows are restored by that stamp).
    const { data: row, error } = await context.supabase
      .from("crm_contacts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", data.id)
      .is("deleted_at", null)
      .select("id, name")
      .maybeSingle();
    if (error) throw new Error(error.message);
  });
