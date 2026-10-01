import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TICKET_STAGE_HINT, autoSiteId, siteProblem, siteRequiredMessage } from "./ticket-form";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("siteProblem — a ticket names the site when the customer has several (owner, Oct 1)", () => {
  it("several sites and none picked: the message names the count", () => {
    expect(siteProblem({ siteCount: 3, site_id: null })).toBe(
      "Pick the site — this customer has 3",
    );
    expect(siteProblem({ siteCount: 2, site_id: undefined })).toBe(siteRequiredMessage(2));
    expect(siteProblem({ siteCount: 2, site_id: "" })).toBe(siteRequiredMessage(2));
  });
  it("a site picked, or zero / one site, is fine", () => {
    expect(siteProblem({ siteCount: 3, site_id: "s1" })).toBeNull();
    expect(siteProblem({ siteCount: 1, site_id: null })).toBeNull();
    expect(siteProblem({ siteCount: 0, site_id: null })).toBeNull();
  });
});

describe("autoSiteId — one site is picked without asking", () => {
  it("only when there is exactly one", () => {
    expect(autoSiteId([{ id: "s1" }])).toBe("s1");
    expect(autoSiteId([])).toBeNull();
    expect(autoSiteId([{ id: "s1" }, { id: "s2" }])).toBeNull();
  });
});

describe("the footer hint", () => {
  it("reads as the owner worded it", () => {
    expect(TICKET_STAGE_HINT).toBe("Scheduled once a technician is set, otherwise Open.");
  });
});

describe("saveServiceJob refuses a multi-site customer without a site", () => {
  const src = read("./service.functions.ts");
  it("counts the customer's live sites and applies siteProblem", () => {
    expect(src).toMatch(/import \{ siteProblem \} from "@\/lib\/ticket-form"/);
    expect(src).toMatch(
      /count: "exact", head: true \}\)\s*\.eq\("account_id", fields\.account_id\)\s*\.is\("deleted_at", null\)/,
    );
    expect(src).toContain("siteProblem({ siteCount: count ?? 0, site_id: null })");
  });
});

describe("the ticket form (service-page.tsx) after the Oct 1 clean-up", () => {
  const src = read("../components/service-page.tsx");
  it("B1: no week grid and no 'Change on the week grid' toggle", () => {
    expect(src).not.toContain("AssignGrid");
    expect(src).not.toContain("Change on the week grid");
  });
  it("B2/B3: one customer block with the site box and the site contact; no right-hand card", () => {
    expect(src).toContain("function CustomerBlock(");
    expect(src).not.toContain("function CustomerCard(");
    const block = src.slice(src.indexOf("function CustomerBlock("));
    expect(block.indexOf("<SiteSelect")).toBeGreaterThan(0);
    expect(block.indexOf("<ContactSelect")).toBeGreaterThan(block.indexOf("<SiteSelect"));
    expect(block).toContain('aria-label="Change the customer"');
  });
  it("A: the site rule disables Create / Save and shows under the site box", () => {
    expect(src).toContain("siteProblem({ siteCount, site_id: draft.customer.site_id })");
    expect(src).toMatch(/dateMissing \|\| !!siteMessage/);
    expect(src).toContain("{props.siteMessage}");
  });
  it("B4: the $ / hour box and '+' wait for a technician", () => {
    expect(src).toContain("const showRate = !!crew && !!draft.technician_id;");
    expect(src).toContain("{crew && showRate && (");
  });
  it("B5/B8: Type, Labor rate and Date share one row; the label is plain 'Date'", () => {
    const row = src.slice(src.indexOf('<Label htmlFor="ticket-type">'));
    const end = row.indexOf('<Label htmlFor="ticket-tech">');
    const between = row.slice(0, end);
    expect(between).toContain('<Label htmlFor="ticket-rate">Labor rate</Label>');
    expect(between).toContain('<Label htmlFor="ticket-date">Date</Label>');
    expect(src).not.toContain("(any day)");
  });
  it("B6: Notes start at two rows and grow", () => {
    expect(src).toMatch(/<AutoTextarea\s+id="ticket-notes"\s+rows=\{2\}/);
  });
  it("B7: the footer hint is the constant", () => {
    expect(src).toContain("{TICKET_STAGE_HINT}");
    expect(src).not.toContain("Saved as Scheduled when a technician and a date are set");
  });
  it("keeps the folded CenterPoint numbers", () => {
    expect(src).toContain("CenterPoint numbers");
  });
});
