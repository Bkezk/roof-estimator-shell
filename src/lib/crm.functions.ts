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
import { databaseRpc } from "@/lib/database-rpc";
import { canAccess, isAdmin, isFieldOnly, seesEveryone } from "@/lib/access";
import { BID_CUSTOMER_REQUIRED } from "@/lib/bid-status";
import { bidDataForCustomer } from "@/lib/bid-account-link";
import { liveLockHeldElsewhere } from "@/lib/bid-locks.functions";
import { compactName, LOOKALIKE_MIN_CHARS, lookalikeCustomers } from "@/lib/customer-lookalike";
import {
  ACCOUNT_ALREADY_DELETED,
  ACCOUNT_DELETED,
  ACCOUNT_MERGED,
  OFFICE_ADDS_CUSTOMERS,
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
import { type MentionOutcome, NO_MENTIONS } from "@/lib/mentions";
import { namesLookAlike } from "@/lib/name-match";
import {
  SEARCH_LIMIT,
  ilikePattern,
  orIlike,
  shapeAccountHits,
  type SearchSiteRow,
} from "@/lib/account-search";
import { countBy, fetchAllPages } from "@/lib/paging";
import type { PropertySiteRow } from "@/lib/property-sites.functions";
import { isMissingTable, type Warranty } from "@/lib/warranty";
import { WARRANTY_COLS } from "@/lib/warranties.functions";
import { DOCUMENTS_BUCKET } from "@/lib/documents/server-pure";

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
/**
 * The customer BOOK — every account (listAccounts). readAccess admits Service so a technician's
 * ticket page can show its customer, property and contact (getAccount, listContacts); the book
 * itself is not theirs (owner, Oct 8: "inventory and the tickets assigned to them"), and since
 * 20261020122000_technician_customer_fence.sql the database hands a technician-only token only
 * the rows of their own tickets. The server says so first (the fifth audit, Oct 20).
 */
async function bookAccess(ctx: Ctx) {
  const p = await readAccess(ctx);
  if (isFieldOnly(p)) throw new Error("Forbidden: Customers access required");
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

/**
 * The columns the Customers list reads (owner, Nov 2: "the list downloads every column"): what
 * the card shows and the search, the filter and the sort use — not the notes, the billing
 * instructions, the mailing address or the CenterPoint ids. 635 customers were 800 KB with every
 * column; these are a fraction of that.
 */
export const LIST_COLUMNS =
  "id, name, kind, contact_name, phone, mobile, email, address1, city, state, zip, external_id, account_manager_id, updated_at, deleted_at" as const;
export type AccountListColumn =
  | "id"
  | "name"
  | "kind"
  | "contact_name"
  | "phone"
  | "mobile"
  | "email"
  | "address1"
  | "city"
  | "state"
  | "zip"
  | "external_id"
  | "account_manager_id"
  | "updated_at"
  | "deleted_at";
export interface AccountListRow extends Pick<AccountRow, AccountListColumn> {
  site_count: number;
  open_jobs: number;
}

export const listAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountListRow[]> => {
    await bookAccess(context);
    const sb = context.supabase;
    // Every row, 1,000 at a time (paging.ts: PostgREST caps a request at 1,000 rows, so
    // asking for 2,000 stopped at 1,000 customers and the counts at 1,000 sites / tickets).
    // Ordered by a unique column last, so no row repeats or drops between pages.
    const [accounts, sites, jobs] = await Promise.all([
      fetchAllPages((from, to) =>
        sb
          .from("crm_accounts")
          .select(LIST_COLUMNS)
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
/**
 * One of the customer's opportunities for the Opportunities section (owner, Oct 12): title,
 * status, who follows it up, when it is expected to close, and the linked bid's status.
 */
export interface AccountOpportunity {
  id: string;
  title: string;
  status: string;
  assignee_id: string | null;
  assignee_name: string | null;
  expected_close: string | null;
  bid_id: string | null;
  bid_status: string | null;
  deleted_at: string | null;
  updated_at: string;
}

/**
 * The order the section shows them in: live open ones first (open / contacted / quoted, newest
 * change first), then live closed ones (Won / Lost / No response), deleted ones last.
 */
export function orderAccountOpportunities<
  T extends { status: string; deleted_at: string | null; updated_at: string },
>(rows: readonly T[]): T[] {
  const rank = (o: T) =>
    o.deleted_at ? 2 : ["won", "lost", "no_response"].includes(o.status) ? 1 : 0;
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.updated_at.localeCompare(a.updated_at));
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
  /**
   * The customer's opportunities (owner, Oct 12: an Opportunities section on the customer, like
   * Tickets): live open first, closed next, deleted last (orderAccountOpportunities); what RLS
   * lets the reader see (Customers / Estimate: all; anyone else: their own).
   */
  opportunities: AccountOpportunity[];
  /** Bids linked to the account — empty when the reader has no Estimate access. */
  bids: LinkedBidRow[];
  /**
   * The customer's tasks (owner, Oct 9: a Tasks list on a customer, like Tickets): whole rows,
   * so the Tasks section opens one in the task dialog. Admins and managers get them all; anyone
   * else what tasks RLS lets through (their own, and open unassigned ones).
   */
  tasks: Database["public"]["Tables"]["tasks"]["Row"][];
  /**
   * With `detail` (the customer's page; owner, Nov 2): every property's roof warranties and
   * named sites, by property id, in two reads — the page asked for them property by property
   * (92 requests on a customer with 46 properties, before its Properties fold was even opened).
   * Left out otherwise (a ticket's customer, a bid's): those pages read a site's own.
   */
  warranties?: Record<string, Warranty[]>;
  property_sites?: Record<string, PropertySiteRow[]>;
}

/** The rows grouped by one column, in the order read. */
function groupBy<T>(rows: readonly T[], key: (r: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[key(r)] ??= []).push(r);
  return out;
}

export const getAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    parseInput(z.object({ id: z.string().uuid(), detail: z.boolean().optional() }), d),
  )
  .handler(async ({ data, context }): Promise<AccountDetail> => {
    const p = await readAccess(context);
    const sb = context.supabase;
    const [
      { data: account, error },
      { data: sites },
      { data: jobs },
      { data: tasks },
      { data: oppRows },
    ] = await Promise.all([
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
      sb
        .from("crm_opportunities")
        .select("id, title, status, assignee_id, expected_close, bid_id, deleted_at, updated_at")
        .eq("account_id", data.id)
        .order("updated_at", { ascending: false })
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
    const opportunities = await accountOpportunities(sb, oppRows ?? []);
    const out: AccountDetail = {
      account,
      deleted_by,
      sites: sites ?? [],
      jobs: jobs ?? [],
      opportunities,
      bids,
      tasks: tasks ?? [],
    };
    if (data.detail) {
      const siteIds = out.sites.map((s) => s.id);
      const [{ data: w, error: wErr }, { data: ps, error: pErr }] = siteIds.length
        ? await Promise.all([
            sb
              .from("site_warranties")
              .select(WARRANTY_COLS)
              .in("site_id", siteIds)
              .order("end_date", { ascending: false, nullsFirst: true }),
            sb
              .from("property_sites")
              .select("*")
              .in("property_id", siteIds)
              .is("deleted_at", null)
              .order("sort")
              .order("name"),
          ])
        : [
            { data: [] as Warranty[], error: null },
            { data: [] as PropertySiteRow[], error: null },
          ];
      // Before either migration: none, not an error (as the per-site reads say).
      if (wErr && !isMissingTable(wErr)) throw new Error(wErr.message);
      if (pErr && !isMissingTable(pErr)) throw new Error(pErr.message);
      out.warranties = groupBy(w ?? [], (r) => r.site_id);
      out.property_sites = groupBy(ps ?? [], (r) => r.property_id);
    }
    return out;
  });

/** The customer's opportunities with the assignee's name and the linked bid's status, ordered. */
async function accountOpportunities(
  sb: SupabaseClient<Database>,
  rows: readonly Omit<AccountOpportunity, "assignee_name" | "bid_status">[],
): Promise<AccountOpportunity[]> {
  if (!rows.length) return [];
  const bidIds = [...new Set(rows.map((r) => r.bid_id).filter((x): x is string => !!x))];
  const [{ data: people }, { data: bids }] = await Promise.all([
    sb.rpc("crm_user_options"),
    bidIds.length
      ? sb.from("bids").select("id, status").in("id", bidIds)
      : Promise.resolve({ data: [] as { id: string; status: string }[] }),
  ]);
  const names = new Map<string, string>();
  for (const u of people ?? []) names.set(u.id, (u.full_name ?? "").trim() || u.email);
  const bidStatus = new Map<string, string>();
  for (const b of bids ?? []) bidStatus.set(b.id, b.status);
  return orderAccountOpportunities(
    rows.map((r) => ({
      ...r,
      assignee_name: r.assignee_id ? (names.get(r.assignee_id) ?? null) : null,
      bid_status: r.bid_id ? (bidStatus.get(r.bid_id) ?? null) : null,
    })),
  );
}

/**
 * A property's own page (owner, Oct 15: "click a property to open its own page where you can see
 * its details, how many tickets were there, its sites, etc."): the crm_sites row, its customer,
 * and what links to it by site_id — the tickets (every stage, newest first, with a count by
 * stage), the opportunities, the bids (Estimate access only, as on the customer) and the tasks
 * RLS lets the reader see. Takeoffs link by customer and building only, so none here.
 */
export interface PropertyDetail {
  /** Deleted too (deleted_at set): an old link shows it with a banner, read-only. */
  site: SiteRow;
  /** Its customer; deleted_at set when the customer is gone (the page is read-only then too). */
  account: { id: string; name: string; deleted_at: string | null };
  /** Live tickets at this property, newest change first (the latest PROPERTY_JOBS_MAX). */
  jobs: Database["public"]["Tables"]["service_jobs"]["Row"][];
  /** How many of `jobs` are at each stage ("open" → 2); a stage with none is left out. */
  job_counts: Record<string, number>;
  opportunities: AccountOpportunity[];
  /** Bids linked to the property — empty when the reader has no Estimate access. */
  bids: LinkedBidRow[];
  tasks: Database["public"]["Tables"]["tasks"]["Row"][];
}

/** The most tickets a property's page lists. */
export const PROPERTY_JOBS_MAX = 500;

/**
 * The Tickets header's summary on a property, "12 tickets · 2 open · 1 scheduled · 9 closed":
 * the total, then each stage with any, in stage order. "No tickets" for none.
 */
export function stageCountsLine(counts: Readonly<Record<string, number>>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return "No tickets";
  const parts = [`${total} ticket${total === 1 ? "" : "s"}`];
  for (const s of SERVICE_STAGE_ORDER) {
    const n = counts[s] ?? 0;
    if (n > 0) parts.push(`${n} ${STAGE_WORDS[s] ?? s}`);
  }
  // A stage the list does not know (an old row): after the known ones.
  for (const [s, n] of Object.entries(counts))
    if (n > 0 && !(SERVICE_STAGE_ORDER as readonly string[]).includes(s)) parts.push(`${n} ${s}`);
  return parts.join(" · ");
}
// service.functions.ts's SERVICE_STAGES / STAGE_LABELS, lower-cased for the line; repeated here so
// this CRM module does not import the Service module (MODULES.md).
const SERVICE_STAGE_ORDER = [
  "open",
  "scheduled",
  "done",
  "authorized",
  "invoiced",
  "closed",
] as const;
const STAGE_WORDS: Record<string, string> = {
  open: "open",
  scheduled: "scheduled",
  done: "done",
  authorized: "authorized",
  invoiced: "invoiced",
  closed: "closed",
};

export const getProperty = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(z.object({ id: z.string().uuid() }), d))
  .handler(async ({ data, context }): Promise<PropertyDetail> => {
    const p = await readAccess(context);
    const sb = context.supabase;
    const { data: site, error } = await sb
      .from("crm_sites")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!site) throw new Error("Property not found");
    const [{ data: account, error: aErr }, { data: jobs }, { data: tasks }, { data: oppRows }] =
      await Promise.all([
        sb
          .from("crm_accounts")
          .select("id, name, deleted_at")
          .eq("id", site.account_id)
          .maybeSingle(),
        sb
          .from("service_jobs")
          .select("*")
          .eq("site_id", data.id)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(PROPERTY_JOBS_MAX),
        sb
          .from("tasks")
          .select("*")
          .eq("site_id", data.id)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(200),
        sb
          .from("crm_opportunities")
          .select("id, title, status, assignee_id, expected_close, bid_id, deleted_at, updated_at")
          .eq("site_id", data.id)
          .order("updated_at", { ascending: false })
          .limit(200),
      ]);
    if (aErr) throw new Error(aErr.message);
    if (!account) throw new Error("Customer not found");
    let bids: LinkedBidRow[] = [];
    if (canAccess(p, "estimate")) {
      const { data: b } = await sb
        .from("bids")
        .select("id, name, status, grand_total, updated_at")
        .eq("site_id", data.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(200);
      bids = (b ?? []) as LinkedBidRow[];
    }
    const opportunities = await accountOpportunities(sb, oppRows ?? []);
    const job_counts: Record<string, number> = {};
    for (const [stage, n] of countBy(jobs ?? [], (j) => j.stage)) job_counts[stage] = n;
    return {
      site,
      account,
      jobs: jobs ?? [],
      job_counts,
      opportunities,
      bids,
      tasks: tasks ?? [],
    };
  });

/** Drop the keys a caller left out, so an update leaves those columns as they are. */
const defined = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

/** The customer's fields that mirror its primary contact row (migration 20261102190000). */
export const ACCOUNT_CONTACT_FIELDS = ["contact_name", "phone", "mobile", "email"] as const;

/** Does the customer have a live primary contact row? */
async function hasPrimaryContact(sb: SupabaseClient<Database>, accountId: string) {
  const { data, error } = await sb
    .from("crm_contacts")
    .select("id")
    .eq("account_id", accountId)
    .eq("is_primary", true)
    .is("deleted_at", null)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * The primary contact row a new customer gets from the dialog's contact fields: the name typed
 * (or the customer's own name when only a number or an email was), the cell and office phones
 * and the email; null when none of the four was given.
 */
export function primaryContactFromAccount(a: {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
}): Database["public"]["Tables"]["crm_contacts"]["Insert"] | null {
  const t = (v: string | null) => (v ?? "").trim() || null;
  const name = t(a.contact_name);
  const mobile = t(a.mobile);
  const office_phone = t(a.phone);
  const email = t(a.email);
  if (!name && !mobile && !office_phone && !email) return null;
  return {
    account_id: a.id,
    name: name ?? a.name,
    mobile,
    office_phone,
    email,
    is_primary: true,
  };
}

/**
 * Create (no id) or update an account. Returns the saved row. Needs an email, a cell phone or
 * an office phone (crm-account.ts; the database checks it too).
 */
export const saveAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(accountSchema, d))
  .handler(async ({ data, context }): Promise<AccountRow & MentionOutcome> => {
    const p = await writeAccess(context);
    // Audit, Nov 6, finding 7: the office adds customers (quickCreateAccount says so; this path
    // did not).
    if (!data.id && isFieldOnly(p)) throw new Error(OFFICE_ADDS_CUSTOMERS);
    const sb = context.supabase;
    const { id, source, ...fields } = data;
    const patch = { ...defined(fields), updated_by_name: nameOf(p) };
    let row: AccountRow;
    // Owner, Nov 2: the Contact / Cell phone / Office phone / Email are the primary contact
    // row's (mirrored by trigger). A customer with one takes no change to them here — the
    // Edit form no longer sends them; an older page's are dropped so the two cannot drift.
    if (id && (await hasPrimaryContact(sb, id)))
      for (const k of ACCOUNT_CONTACT_FIELDS) delete (patch as Record<string, unknown>)[k];
    // The stored Notes, read only when the new ones name someone (owner, Oct 14: @mentions on a
    // customer's Notes): the names already there were told when they were written.
    let oldNotes: string | null = null;
    if (id) {
      await assertLiveAccount(sb, id);
      if (fields.notes?.includes("@")) {
        const { data: cur } = await sb
          .from("crm_accounts")
          .select("notes")
          .eq("id", id)
          .maybeSingle();
        oldNotes = cur?.notes ?? null;
      }
      const { data: r, error } = await sb
        .from("crm_accounts")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      row = r;
    } else {
      const { data: r, error } = await sb
        .from("crm_accounts")
        .insert({ ...patch, source: source ?? "manual", created_by: context.userId })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      row = r;
    }
    let mentions: MentionOutcome = NO_MENTIONS;
    if (fields.notes?.includes("@")) {
      const { sendMentions } = await import("@/lib/mention-notify");
      mentions = await sendMentions(context, {
        text: fields.notes,
        previous: oldNotes,
        writer: nameOf(p) ?? "Someone",
        where: `customer ${row.name}`,
        url: `/customers?id=${row.id}`,
      });
    }
    return { ...row, ...mentions };
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

/** Did the save change any part of the street address? A part left out is unchanged. */
export function addressChanged(
  before: {
    address1: string | null;
    address2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  },
  fields: Partial<
    Record<"address1" | "address2" | "city" | "state" | "zip", string | null | undefined>
  >,
): boolean {
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  return (["address1", "address2", "city", "state", "zip"] as const).some(
    (k) => fields[k] !== undefined && norm(fields[k]) !== norm(before[k]),
  );
}

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
      // Owner, Nov 2: an aerial cover is of the address; a new address drops it (the file too),
      // and the next visit makes a new one. A photo the office uploaded stays.
      const { data: before, error: bErr } = await sb
        .from("crm_sites")
        .select("address1, address2, city, state, zip, cover_photo_path, cover_photo_source")
        .eq("id", id)
        .maybeSingle();
      if (bErr) throw new Error(bErr.message);
      const redoAerial =
        !!before && before.cover_photo_source === "aerial" && addressChanged(before, fields);
      const { data: row, error } = await sb
        .from("crm_sites")
        .update(
          redoAerial
            ? { ...fields, cover_photo_path: null, aerial_tried_at: null, aerial_note: null }
            : fields,
        )
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      if (redoAerial && before?.cover_photo_path) {
        const { error: rmErr } = await sb.storage
          .from(DOCUMENTS_BUCKET)
          .remove([before.cover_photo_path]);
        if (rmErr) console.warn(`Aerial cover: the old file was not removed (${rmErr.message})`);
      }
      return row;
    }
    const { data: row, error } = await sb.from("crm_sites").insert(fields).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

/**
 * The one-step "new customer" from the Customers page or a ticket's / bid's / opportunity's
 * customer search. The account, its primary contact row and — when a physical address was typed
 * — its first property at that address, named after the customer (owner, Nov 4: the opportunity
 * form asked for the address and then for "Add property", the same address a second time; a
 * ticket needs the property too). No address: the account only (owner, Sep 30: sites are added
 * under the account afterwards). Needs an
 * email, a cell phone or an office phone. Not a technician-only user's (Oct 21, the sixth
 * audit, OFFICE_ADDS_CUSTOMERS): the office owns the customer book — and a row they created was
 * unreadable to their own token under 20261020122000's fence (no ticket links it yet), so the
 * ticket's save failed "Customer not found" over an orphan customer. Refused before any write.
 */
export const quickCreateAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(quickAccountSchema, d))
  .handler(async ({ data, context }): Promise<AccountHit> => {
    const p = await writeAccess(context);
    if (isFieldOnly(p)) throw new Error(OFFICE_ADDS_CUSTOMERS);
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
    // The person typed on the dialog is the customer's primary contact row (owner, Nov 2: the
    // customer's contact is a pointer to one contact row). A company with a number and no
    // contact name gets a row named after the company. Should the row fail, the customer just
    // made is taken back, so a retry cannot make a second one.
    const primary = primaryContactFromAccount(account);
    if (primary) {
      const { error: cErr } = await sb.from("crm_contacts").insert(primary);
      if (cErr) {
        await sb.from("crm_accounts").delete().eq("id", account.id);
        throw new Error(`Could not save the contact: ${cErr.message}`);
      }
    }
    // The first property, from the physical address typed (owner, Nov 4). Should the row fail,
    // the customer just made is taken back, so a retry cannot make a second one.
    const site = firstSiteFromAccount(account);
    let siteRow: SiteRow | null = null;
    if (site) {
      const { data: s, error: sErr } = await sb.from("crm_sites").insert(site).select("*").single();
      if (sErr) {
        await sb.from("crm_accounts").delete().eq("id", account.id);
        throw new Error(`Could not save the property: ${sErr.message}`);
      }
      siteRow = s;
    }
    return {
      account_id: account.id,
      account_name: account.name,
      kind: data.kind,
      site_id: siteRow?.id ?? null,
      site_name: siteRow?.name ?? null,
      site_address: siteRow ? siteAddressLine(siteRow) : "",
      site_count: siteRow ? 1 : 0,
      contact_name: account.contact_name,
      phone: account.phone ?? account.mobile,
    };
  });

/**
 * A new customer's first property from its physical address: the customer's name as the
 * property's, the street, city, state and zip as typed. Null when no address was typed (a
 * state alone is not an address — normalizeAddress drops it).
 */
export function firstSiteFromAccount(
  a: Pick<AccountRow, "id" | "name" | "address1" | "address2" | "city" | "state" | "zip">,
): Database["public"]["Tables"]["crm_sites"]["Insert"] | null {
  const has = (v: string | null) => !!v && v.trim() !== "";
  if (!has(a.address1) && !has(a.city) && !has(a.zip)) return null;
  return {
    account_id: a.id,
    name: a.name,
    address1: a.address1,
    address2: a.address2,
    city: a.city,
    state: a.state,
    zip: a.zip,
  };
}

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
      .select("id, deleted_at, merged_into")
      .eq("id", data.id)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!account) throw new Error("Customer not found");
    const stamp = account.deleted_at;
    if (!stamp) throw new Error("This customer is not deleted");
    // Audit, Nov 6, finding 4: everything on a merged customer moved to the kept one; bringing
    // the shell back would make an empty duplicate beside it.
    if (account.merged_into) throw new Error(ACCOUNT_MERGED);
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

/**
 * Link a saved bid to an account (and optionally a site) — the reverse of the Setup typeahead;
 * also how a bid is moved to another customer. Never unlinks: every bid belongs to a customer
 * (owner, Oct 26), and the estimator refuses to save one without (Customers audit Nov 6,
 * finding 8).
 */
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
    if (!data.account_id) throw new Error(BID_CUSTOMER_REQUIRED);
    const sb = context.supabase;
    const { data: cur, error: cErr } = await sb
      .from("bids")
      .select("id, account_id, data, deleted_at")
      .eq("id", data.bid_id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!cur) throw new Error("That bid was not found");
    if (cur.deleted_at) throw new Error("That bid is deleted");
    const patch: Database["public"]["Tables"]["bids"]["Update"] = {
      account_id: data.account_id,
      site_id: data.site_id ?? null,
    };
    if (cur.account_id !== data.account_id) {
      // A move, or a first link: the bid's client fields (and the job-site fields when a
      // property was named) follow the new customer, as a pick in the estimator does (owner,
      // Nov 6). Refused while someone has the bid open in the estimator: their tab would save
      // the old fields back over it.
      const other = await liveLockHeldElsewhere(sb, cur.id, undefined);
      if (other)
        throw new Error(
          `${other.holderName} has this bid open in the estimator; move it when they are done`,
        );
      const { data: acct, error: aErr } = await sb
        .from("crm_accounts")
        .select("name, contact_name, phone, email, address1, address2, city, state, zip")
        .eq("id", data.account_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (aErr) throw new Error(aErr.message);
      if (!acct) throw new Error("That customer was not found, or is deleted");
      let site: Pick<SiteRow, "address1" | "address2" | "city" | "state" | "zip"> | null = null;
      if (data.site_id) {
        const { data: s, error: sErr } = await sb
          .from("crm_sites")
          .select("address1, address2, city, state, zip")
          .eq("id", data.site_id)
          .eq("account_id", data.account_id)
          .is("deleted_at", null)
          .maybeSingle();
        if (sErr) throw new Error(sErr.message);
        site = s ?? null;
      }
      patch.data = bidDataForCustomer(cur.data, acct, site) as Json;
      // The contents changed: a tab that loaded the bid before this refuses to save over it
      // (bid-stale-save.ts), and the Bids list says who changed it.
      patch.content_saved_at = new Date().toISOString();
      patch.updated_by_name = (p.full_name ?? "").trim() || p.email || null;
    }
    const { error } = await sb.from("bids").update(patch).eq("id", data.bid_id);
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
/**
 * Customers whose name looks like the one typed (the New customer dialog's warning; owner,
 * Nov 2). The live names are few (635) and the likeness rule is in TypeScript
 * (customer-lookalike.ts), so they are read and sifted here: at most LOOKALIKE_MAX, exact first.
 */
export const similarAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => parseInput(z.object({ name: z.string().trim().max(CRM_MAX.name) }), d))
  .handler(async ({ data, context }): Promise<SimilarAccount[]> => {
    await readAccess(context);
    if (compactName(data.name).length < LOOKALIKE_MIN_CHARS) return [];
    const rows = await fetchAllPages((from, to) =>
      context.supabase
        .from("crm_accounts")
        .select("id, name, kind, city, external_id, contact_name, phone")
        .is("deleted_at", null)
        .order("name")
        .order("id")
        .range(from, to),
    );
    return lookalikeCustomers(data.name, rows);
  });
export interface SimilarAccount {
  id: string;
  name: string;
  kind: string;
  city: string | null;
  external_id: string | null;
  contact_name: string | null;
  phone: string | null;
}

/** What merge_accounts reports (migration 20261102190000): the kept customer and the counts moved. */
export interface MergeResult {
  kept: string;
  kept_name: string;
  merged_from: string;
  properties: number;
  contacts: number;
  tickets: number;
  bids: number;
  opportunities: number;
  tasks: number;
  takeoffs: number;
  documents: number;
  followups: number;
}

/**
 * Merge one customer into another (owner, Nov 2: "Boyd Cat" twice, "D.D Roberts" and "DD
 * Roberts"): admins only. Everything on `drop` moves to `keep` and `drop` is deleted with a
 * note saying where it went — one transaction in the database (merge_accounts, which checks
 * is_admin() itself) with the counts on the kept customer's history.
 */
export const mergeAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    parseInput(z.object({ keep_id: z.string().uuid(), drop_id: z.string().uuid() }), d),
  )
  .handler(async ({ data, context }): Promise<MergeResult> => {
    const p = await me(context);
    if (!isAdmin(p)) throw new Error("Only an admin can merge customers");
    if (data.keep_id === data.drop_id) throw new Error("Pick a different customer to merge into");
    const { data: out, error } = await context.supabase.rpc("merge_accounts", {
      p_keep: data.keep_id,
      p_drop: data.drop_id,
    });
    if (error) throw new Error(error.message);
    if (!out) throw new Error("The merge did not report back");
    return out as unknown as MergeResult;
  });

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
      .order("is_primary", { ascending: false })
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
  /**
   * The customer's main person (owner, Nov 2): their name, phones and email are the customer's
   * Contact / Cell phone / Office phone / Email (mirrored by trigger; migration 20261102190000).
   * One per customer: marking one unmarks the previous.
   */
  is_primary: z.boolean().optional(),
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
    const { data: saved, error } = await databaseRpc(sb)("save_contact_with_sites", saveContactArgs(data));
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
