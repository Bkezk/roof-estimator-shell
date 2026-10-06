/**
 * The header search (owner, Oct 6: "a search bar where you can search anything — job number,
 * name, customers, etc."): the query reading, the per-kind filters, the routes a hit opens, the
 * ranking, and the wiring (header, server function, row security through the caller's client).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  groupHits,
  hitHref,
  hitRoute,
  numberPrefixFilter,
  parseGlobalQuery,
  rankHits,
  searchFilter,
  SEARCH_KINDS,
  SEARCH_LIMIT,
  type SearchHit,
} from "./global-search";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("parseGlobalQuery", () => {
  it("reads a ticket / invoice number with or without #", () => {
    expect(parseGlobalQuery("6008")).toMatchObject({
      number: 6008,
      like: "%6008%",
      tooShort: false,
    });
    expect(parseGlobalQuery("# 6008")).toMatchObject({ number: 6008, like: "%6008%" });
    expect(parseGlobalQuery("Owens")).toMatchObject({ number: null, like: "%Owens%" });
  });
  it("neutralises reserved characters and refuses fewer than two characters", () => {
    expect(parseGlobalQuery("Smith (Main), O'Brien").like).toBe("%Smith _Main__ O_Brien%");
    expect(parseGlobalQuery("a").tooShort).toBe(true);
    expect(parseGlobalQuery("  ").tooShort).toBe(true);
    expect(parseGlobalQuery("#7").tooShort).toBe(true);
  });
});

describe("searchFilter", () => {
  it("tickets: the number exactly plus Job #, PO #, customer, property, address, description, CenterPoint #s", () => {
    const f = searchFilter("ticket", parseGlobalQuery("6008"));
    expect(f.startsWith("number.eq.6008,and(number.gte.60080,number.lte.60089),")).toBe(true);
    for (const c of [
      "job_number",
      "po_number",
      "customer_name",
      "site_name",
      "site_address",
      "location_name",
      "description",
      "centerpoint_ticket",
    ])
      expect(f).toContain(`${c}.ilike.%6008%`);
  });
  it("text only: no number clause; invoices search their display number and bill-to", () => {
    expect(searchFilter("ticket", parseGlobalQuery("leak"))).not.toContain("number.eq");
    const inv = searchFilter("invoice", parseGlobalQuery("6006.2"));
    // bill_to / property are jsonb: their name key, never the whole column (owner's phone, Oct 6:
    // "operator does not exist: jsonb ~~* unknown").
    expect(inv).toContain("bill_to->>name.ilike.%6006_2%");
    expect(inv).toContain("property->>name.ilike.%6006_2%");
    expect(inv).not.toMatch(/,bill_to\.ilike|,property\.ilike/);
    // The dot is a reserved character and becomes "_" (any one character): still finds 6006.2.
    expect(inv).toContain("display_number.ilike.%6006_2%");
    expect(inv).not.toContain("number.eq");
    expect(searchFilter("customer", parseGlobalQuery("hardee"))).toBe(
      "name.ilike.%hardee%,contact_name.ilike.%hardee%,phone.ilike.%hardee%,email.ilike.%hardee%,city.ilike.%hardee%",
    );
  });
});

describe("numberPrefixFilter", () => {
  it("60 finds 60, 600–609, 6000–6099 … (every number that starts with 60) up to nine digits", () => {
    expect(numberPrefixFilter("60", 5)).toBe(
      "number.eq.60,and(number.gte.600,number.lte.609),and(number.gte.6000,number.lte.6099),and(number.gte.60000,number.lte.60999)",
    );
    expect(numberPrefixFilter("6008", 4)).toBe("number.eq.6008");
    expect(numberPrefixFilter("007", 4)).toBe("number.eq.7,and(number.gte.70,number.lte.79)");
  });
});

describe("hitRoute / hitHref", () => {
  it("every kind opens somewhere; properties and contacts open their customer", () => {
    expect(hitRoute("ticket", { id: "t1" })).toEqual({ to: "/service", search: { id: "t1" } });
    expect(hitRoute("customer", { id: "a1" })).toEqual({ to: "/customers", search: { id: "a1" } });
    expect(hitRoute("property", { id: "s1", account_id: "a1" })).toEqual({
      to: "/customers",
      search: { id: "a1" },
    });
    expect(hitRoute("contact", { id: "c1", account_id: "a1" })).toEqual({
      to: "/customers",
      search: { id: "a1" },
    });
    expect(hitRoute("opportunity", { id: "o1" })).toEqual({
      to: "/opportunities",
      search: { id: "o1" },
    });
    expect(hitRoute("bid", { id: "b1" })).toEqual({ to: "/estimate", search: { bid: "b1" } });
    expect(hitRoute("invoice", { id: "i1" })).toEqual({
      to: "/service/invoices",
      search: { id: "i1" },
    });
    expect(hitRoute("vendor", { id: "v1" })).toEqual({
      to: "/customers",
      search: { tab: "vendors" },
    });
    expect(hitHref({ to: "/service", search: { id: "t1" } })).toBe("/service?id=t1");
    expect(hitHref({ to: "/customers", search: {} })).toBe("/customers");
  });
});

describe("rankHits / groupHits", () => {
  const hit = (kind: SearchHit["kind"], id: string, title: string, subtitle = ""): SearchHit => ({
    kind,
    id,
    title,
    subtitle,
    ...hitRoute(kind, { id, account_id: "a" }),
  });
  it("the exact ticket number first, then titles that start with the text, then contain it, then the rest", () => {
    const q = parseGlobalQuery("6008");
    const ranked = rankHits(
      [
        hit("customer", "a", "Bell County", "PO 6008"),
        hit("ticket", "t2", "#16008 Someone"),
        hit("ticket", "t1", "#6008 bell county"),
        hit("bid", "b", "6008 Main St reroof"),
      ],
      q,
    );
    expect(ranked.map((h) => h.id)).toEqual(["t1", "b", "t2", "a"]);
  });
  it("ties keep the kinds' order, then A–Z; groups follow the kinds' order", () => {
    const q = parseGlobalQuery("owen");
    const ranked = rankHits(
      [
        hit("bid", "b", "Owens bid"),
        hit("customer", "a2", "Owens Z"),
        hit("customer", "a1", "Owens A"),
      ],
      q,
    );
    expect(ranked.map((h) => h.id)).toEqual(["a1", "a2", "b"]);
    expect(groupHits(ranked).map((g) => [g.kind, g.hits.length])).toEqual([
      ["customer", 2],
      ["bid", 1],
    ]);
    expect(SEARCH_KINDS[0]).toBe("ticket");
    expect(SEARCH_LIMIT).toBe(6);
  });
});

describe("the wiring", () => {
  it("the header shows the box; Ctrl / ⌘ K opens it; results navigate by href", () => {
    const shell = read("../components/auth-gate.tsx");
    expect(shell).toContain("<GlobalSearch />");
    const ui = read("../components/global-search.tsx");
    expect(ui).toContain('e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)');
    expect(ui).toContain("shouldFilter={false}");
    expect(ui).toContain("router.navigate({ href })");
    // Every row says what it is.
    expect(ui).toContain("{SEARCH_KIND_ONE[h.kind]}");
  });
  it("the server function reads every kind with the caller's client (row security), each capped and never deleted rows", () => {
    const fn = read("./global-search.functions.ts");
    for (const t of [
      "service_jobs",
      "crm_accounts",
      "crm_sites",
      "crm_contacts",
      "crm_opportunities",
      "bids",
      "invoices",
      "vendors",
    ])
      expect(fn).toContain(`.from("${t}")`);
    expect(fn).not.toMatch(/service_role|createServiceClient|SUPABASE_SERVICE/);
    expect((fn.match(/\.limit\(SEARCH_LIMIT\)/g) ?? []).length).toBe(8);
    expect((fn.match(/\.is\("deleted_at", null\)/g) ?? []).length).toBe(6);
    expect(fn).toContain('.is("archived_at", null)');
    expect(fn).toContain("errors.push({ kind, message:");
  });
});
