import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SEARCH_LIMIT, shapeAccountHits } from "./account-search";

const acct = (id: string, name: string, kind = "company") => ({
  id,
  name,
  kind,
  contact_name: null,
  phone: null,
});
const site = (id: string, account_id: string, name: string, address = "") => ({
  id,
  account_id,
  name,
  address,
});

describe("shapeAccountHits — the customer search lists customers only (owner, Oct 1)", () => {
  const accounts = [acct("a1", "Bell County BOE"), acct("a2", "Acme Foods"), acct("a3", "Bellamy")];
  const sites = [
    site("s1", "a1", "Middlesboro High", "4840 W Cumberland Ave, Middlesboro, KY"),
    site("s2", "a1", "Yellow Creek Elementary"),
    site("s3", "a2", "Plant 2", "1 Main St, London, KY"),
  ];

  it("returns one row per customer and never a site row", () => {
    const hits = shapeAccountHits("", accounts, sites);
    expect(hits.map((h) => h.account_id).sort()).toEqual(["a1", "a2", "a3"]);
    // A site row used to carry the site with a sibling row for the account; now no account repeats.
    expect(new Set(hits.map((h) => h.account_id)).size).toBe(hits.length);
  });

  it("a customer found by name AND through one of its sites is listed once", () => {
    // The server adds the customers whose site name / street matched; the shaper dedupes.
    const a = acct("a1", "Bell County");
    const hits = shapeAccountHits(
      "gym",
      [a, a],
      [site("s1", "a1", "Gym"), site("s2", "a1", "Pool")],
    );
    expect(hits.map((h) => [h.account_id, h.site_count])).toEqual([["a1", 2]]);
  });

  it("a customer with exactly one site carries it, so the pick selects it", () => {
    const acme = shapeAccountHits("", accounts, sites).find((h) => h.account_id === "a2")!;
    expect(acme).toMatchObject({
      site_id: "s3",
      site_name: "Plant 2",
      site_address: "1 Main St, London, KY",
      site_count: 1,
    });
  });

  it("a customer with several sites, or none, carries no site", () => {
    const hits = shapeAccountHits("", accounts, sites);
    expect(hits.find((h) => h.account_id === "a1")).toMatchObject({
      site_id: null,
      site_name: null,
      site_address: "",
      site_count: 2,
    });
    expect(hits.find((h) => h.account_id === "a3")).toMatchObject({
      site_id: null,
      site_count: 0,
    });
  });

  it("puts prefix matches first, then alphabetical", () => {
    const hits = shapeAccountHits(
      "bell",
      [acct("x", "Campbell Co"), acct("y", "Bellamy"), acct("z", "Bell County BOE")],
      [],
    );
    expect(hits.map((h) => h.account_name)).toEqual(["Bell County BOE", "Bellamy", "Campbell Co"]);
  });

  it("keeps the kind and caps the list", () => {
    const many = Array.from({ length: SEARCH_LIMIT + 5 }, (_, i) =>
      acct(`id${i}`, `Customer ${String(i).padStart(2, "0")}`, i === 0 ? "individual" : "company"),
    );
    const hits = shapeAccountHits("", many, []);
    expect(hits).toHaveLength(SEARCH_LIMIT);
    expect(hits[0]!.kind).toBe("individual");
    expect(hits[1]!.kind).toBe("company");
  });
});

describe("the typeahead draws no site rows", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../components/crm/account-picker.tsx", import.meta.url)),
    "utf8",
  );
  it("no site icon, no 'customers and sites' placeholder, keeps the add-a-customer row", () => {
    expect(src).not.toContain("MapPin");
    expect(src).not.toContain("customers and sites");
    expect(src).toContain("as a new customer");
  });
});
