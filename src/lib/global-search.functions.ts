/**
 * The header search (owner, Oct 6; the pure parts are in global-search.ts). Every kind is read
 * with the caller's own client, so row security decides what comes back for each role; a kind
 * that fails (a table the role may not read, a network blip) is reported by name rather than
 * hiding the whole result or failing it (owner: bugs surface loudly).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware.hardened";
import {
  hitRoute,
  parseGlobalQuery,
  rankHits,
  searchFilter,
  SEARCH_LIMIT,
  SEARCH_MAX_LEN,
  type SearchHit,
  type SearchKind,
} from "@/lib/global-search";
import { STAGE_LABELS, type ServiceStage } from "@/lib/service.functions";

export interface GlobalSearchResult {
  hits: SearchHit[];
  /** Kinds that could not be searched, with the database's reason. */
  errors: Array<{ kind: SearchKind; message: string }>;
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const joinParts = (...parts: Array<string | null | undefined>) =>
  parts
    .map((p) => s(p))
    .filter(Boolean)
    .join(" · ");

export const globalSearch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ q: z.string().max(SEARCH_MAX_LEN) }).parse(d))
  .handler(async ({ data, context }): Promise<GlobalSearchResult> => {
    const q = parseGlobalQuery(data.q);
    if (q.tooShort) return { hits: [], errors: [] };
    const sb = context.supabase;
    const errors: GlobalSearchResult["errors"] = [];
    const hits: SearchHit[] = [];

    // Each kind on its own, so one failure does not take the others with it.
    const read = async (
      kind: SearchKind,
      run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
    ) => {
      try {
        const r = await run();
        if (r.error) {
          errors.push({ kind, message: r.error.message });
          return [] as Row[];
        }
        return (r.data ?? []) as Row[];
      } catch (e) {
        errors.push({ kind, message: e instanceof Error ? e.message : String(e) });
        return [] as Row[];
      }
    };

    const [tickets, accounts, sites, contacts, opps, bids, invoices, vendors] = await Promise.all([
      read("ticket", () =>
        sb
          .from("service_jobs")
          .select(
            "id, number, customer_name, site_name, description, stage, job_number, po_number, scheduled_date",
          )
          .is("deleted_at", null)
          .or(searchFilter("ticket", q))
          .order("number", { ascending: false })
          .limit(SEARCH_LIMIT),
      ),
      read("customer", () =>
        sb
          .from("crm_accounts")
          .select("id, name, contact_name, city, state")
          .is("deleted_at", null)
          .or(searchFilter("customer", q))
          .order("name")
          .limit(SEARCH_LIMIT),
      ),
      read("property", () =>
        sb
          .from("crm_sites")
          .select("id, name, address1, city, state, account_id")
          .is("deleted_at", null)
          .or(searchFilter("property", q))
          .order("name")
          .limit(SEARCH_LIMIT),
      ),
      read("contact", () =>
        sb
          .from("crm_contacts")
          .select("id, name, email, mobile, office_phone, position, account_id")
          .is("deleted_at", null)
          .or(searchFilter("contact", q))
          .order("name")
          .limit(SEARCH_LIMIT),
      ),
      read("opportunity", () =>
        sb
          .from("crm_opportunities")
          .select("id, title, status, account_id")
          .is("deleted_at", null)
          .or(searchFilter("opportunity", q))
          .order("updated_at", { ascending: false })
          .limit(SEARCH_LIMIT),
      ),
      read("bid", () =>
        sb
          .from("bids")
          .select("id, name, status, updated_at, account_id")
          .is("deleted_at", null)
          .or(searchFilter("bid", q))
          .order("updated_at", { ascending: false })
          .limit(SEARCH_LIMIT),
      ),
      read("invoice", () =>
        sb
          .from("invoices")
          .select("id, number, display_number, status, bill_to, property, total")
          .or(searchFilter("invoice", q))
          .order("number", { ascending: false })
          .limit(SEARCH_LIMIT),
      ),
      read("vendor", () =>
        sb
          .from("vendors")
          .select("id, name, city, state")
          .is("archived_at", null)
          .or(searchFilter("vendor", q))
          .order("name")
          .limit(SEARCH_LIMIT),
      ),
    ]);

    // Customer names for the rows that only carry an account id.
    const accountIds = [
      ...new Set(
        [...sites, ...contacts, ...opps, ...bids].map((r) => s(r["account_id"])).filter(Boolean),
      ),
    ];
    const accountName = new Map<string, string>();
    if (accountIds.length) {
      const { data: names } = await sb.from("crm_accounts").select("id, name").in("id", accountIds);
      for (const a of (names ?? []) as Row[]) accountName.set(s(a["id"]), s(a["name"]));
    }
    const nameOf = (r: Row) => accountName.get(s(r["account_id"])) ?? "";

    for (const r of tickets) {
      const stage = STAGE_LABELS[s(r["stage"]) as ServiceStage] ?? s(r["stage"]);
      hits.push({
        kind: "ticket",
        id: s(r["id"]),
        title: `#${String(r["number"] ?? "")} ${s(r["customer_name"])}`.trim(),
        subtitle: joinParts(
          s(r["description"]),
          s(r["site_name"]),
          stage,
          s(r["job_number"]) ? `Job # ${s(r["job_number"])}` : null,
          s(r["po_number"]) ? `PO # ${s(r["po_number"])}` : null,
        ),
        ...hitRoute("ticket", { id: s(r["id"]) }),
      });
    }
    for (const r of accounts)
      hits.push({
        kind: "customer",
        id: s(r["id"]),
        title: s(r["name"]),
        subtitle: joinParts(
          s(r["contact_name"]),
          [s(r["city"]), s(r["state"])].filter(Boolean).join(", "),
        ),
        ...hitRoute("customer", { id: s(r["id"]) }),
      });
    for (const r of sites)
      hits.push({
        kind: "property",
        id: s(r["id"]),
        title: s(r["name"]),
        subtitle: joinParts(
          nameOf(r),
          [s(r["address1"]), s(r["city"]), s(r["state"])].filter(Boolean).join(", "),
        ),
        ...hitRoute("property", { id: s(r["id"]), account_id: s(r["account_id"]) || null }),
      });
    for (const r of contacts)
      hits.push({
        kind: "contact",
        id: s(r["id"]),
        title: s(r["name"]),
        subtitle: joinParts(
          nameOf(r),
          s(r["position"]),
          s(r["mobile"]) || s(r["office_phone"]),
          s(r["email"]),
        ),
        ...hitRoute("contact", { id: s(r["id"]), account_id: s(r["account_id"]) || null }),
      });
    for (const r of opps)
      hits.push({
        kind: "opportunity",
        id: s(r["id"]),
        title: s(r["title"]),
        subtitle: joinParts(nameOf(r), s(r["status"])),
        ...hitRoute("opportunity", { id: s(r["id"]) }),
      });
    for (const r of bids)
      hits.push({
        kind: "bid",
        id: s(r["id"]),
        title: s(r["name"]),
        subtitle: joinParts(nameOf(r), s(r["status"])),
        ...hitRoute("bid", { id: s(r["id"]) }),
      });
    for (const r of invoices)
      hits.push({
        kind: "invoice",
        id: s(r["id"]),
        title: `Invoice ${s(r["display_number"]) || String(r["number"] ?? "")}`,
        subtitle: joinParts(s(r["bill_to"]), s(r["property"]), s(r["status"])),
        ...hitRoute("invoice", { id: s(r["id"]) }),
      });
    for (const r of vendors)
      hits.push({
        kind: "vendor",
        id: s(r["id"]),
        title: s(r["name"]),
        subtitle: [s(r["city"]), s(r["state"])].filter(Boolean).join(", "),
        ...hitRoute("vendor", { id: s(r["id"]) }),
      });

    return { hits: rankHits(hits, q), errors };
  });
