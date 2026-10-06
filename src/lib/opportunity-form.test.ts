import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseEstimateSearch } from "./estimate-search";
import {
  ASSIGNEE_REQUIRED,
  assigneeProblem,
  autoSiteId,
  bidPrefillFromOpportunity,
  opportunitySiteProblem,
  siteRequiredMessage,
} from "./opportunity-form";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const ID = "6f1c1d2e-8a4b-4c3d-9e2f-1a2b3c4d5e6f";
const ACC = "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";
const SITE = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("assigneeProblem — someone always follows an opportunity up (owner, Oct 1)", () => {
  it("a new opportunity needs an assignee", () => {
    expect(ASSIGNEE_REQUIRED).toBe("Pick who follows this up");
    expect(assigneeProblem({})).toBe(ASSIGNEE_REQUIRED);
    expect(assigneeProblem({ assignee_id: null })).toBe(ASSIGNEE_REQUIRED);
    expect(assigneeProblem({ assignee_id: "" })).toBe(ASSIGNEE_REQUIRED);
    expect(assigneeProblem({ assignee_id: ACC })).toBeNull();
  });
  it("an update may leave it out (unchanged) but may not clear it", () => {
    expect(assigneeProblem({ id: ID })).toBeNull();
    expect(assigneeProblem({ id: ID, assignee_id: ACC })).toBeNull();
    expect(assigneeProblem({ id: ID, assignee_id: null })).toBe(ASSIGNEE_REQUIRED);
    expect(assigneeProblem({ id: ID, assignee_id: "" })).toBe(ASSIGNEE_REQUIRED);
  });
});

describe("opportunitySiteProblem — every opportunity names its site (owner, Oct 2)", () => {
  it("no customer: the customer comes first (it is required)", () => {
    expect(opportunitySiteProblem({ account_id: null, site_id: null, siteCount: 3 })).toBe(
      "Pick or add the customer",
    );
    expect(opportunitySiteProblem({ account_id: "", site_id: null, siteCount: 3 })).toBe(
      "Pick or add the customer",
    );
  });
  it("a customer with several sites needs one picked, with the count", () => {
    expect(opportunitySiteProblem({ account_id: ACC, site_id: null, siteCount: 3 })).toBe(
      "Pick the property — this customer has 3",
    );
    expect(opportunitySiteProblem({ account_id: ACC, site_id: null, siteCount: 2 })).toBe(
      siteRequiredMessage(2),
    );
    expect(opportunitySiteProblem({ account_id: ACC, site_id: SITE, siteCount: 3 })).toBeNull();
  });
  it("one site is picked without asking; none needs one added first", () => {
    expect(autoSiteId([{ id: SITE }])).toBe(SITE);
    expect(opportunitySiteProblem({ account_id: ACC, site_id: null, siteCount: 1 })).toBeNull();
    expect(opportunitySiteProblem({ account_id: ACC, site_id: null, siteCount: 0 })).toBe(
      "Add a property to this customer first",
    );
  });
});

describe("bidPrefillFromOpportunity — Start a bid", () => {
  const base = {
    title: "Reroof — Yellow Creek gym",
    account_id: ACC,
    account_name: "Bell County Schools",
    site_id: SITE,
    description: "  TPO over the gym  ",
  };
  it("links the customer and site, and passes the description as notes", () => {
    const pf = bidPrefillFromOpportunity(base);
    expect(pf).toEqual({
      pfName: "Reroof — Yellow Creek gym",
      pfOwner: "Bell County Schools",
      pfAccount: ACC,
      pfSite: SITE,
      pfNotes: "TPO over the gym",
    });
    // The estimate route keeps every one of them (estimate-search.ts).
    expect(parseEstimateSearch({ ...pf })).toEqual(pf);
  });
  it("a prospect (no customer): name only; never a site without its customer", () => {
    expect(
      bidPrefillFromOpportunity({
        ...base,
        account_id: null,
        account_name: null,
        site_id: SITE,
        description: null,
      }),
    ).toEqual({ pfName: "Reroof — Yellow Creek gym" });
  });
});

describe("saveOpportunity enforces the rules", () => {
  const src = read("./opportunities.functions.ts");
  it("assignee required, site with the customer, site stored", () => {
    expect(src).toContain("assigneeProblem({ id, assignee_id: fields.assignee_id })");
    expect(src).toMatch(/site_id: z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/);
    // Owner, Oct 2: customer, contact and site in one rule (opportunity-customer-required.test.ts).
    expect(src).toMatch(
      /opportunityProblem\(\{\s*account_id,\s*site_id,\s*siteCount,\s*hasContact: hasContactMethod\(acc\),\s*\}\)/,
    );
    expect(src).toMatch(/\.from\("crm_sites"\)\s*\.select\("id", \{ count: "exact" \}\)/);
    expect(src).toContain('.is("deleted_at", null)');
    expect(src).toContain("That property does not belong to the customer");
    expect(src).toMatch(/const patch = \{\s*account_id,\s*site_id,/);
    // An update never writes a null assignee.
    expect(src).not.toContain("assignee_id: fields.assignee_id ?? null");
    expect(src).toContain("site_name: r.site_id ?");
  });
});

describe("the opportunity page (owner, Oct 1)", () => {
  const page = read("../components/opportunities-page.tsx");
  const editorStart = page.indexOf("function OppEditor(");
  const editor = page.slice(editorStart, page.indexOf("function OppCustomerBlock("));
  const headerEnd = editor.indexOf("{opp ? (");
  const header = editor.slice(editor.indexOf("<BackToList />"), headerEnd);
  const block = page.slice(page.indexOf("function OppCustomerBlock("));

  it("the status is in the header only, for a new opportunity too (Open to start)", () => {
    expect(page).not.toContain('id="opp-status"');
    expect(page).not.toContain('htmlFor="opp-status"');
    expect(editor).toMatch(
      /onValueChange=\{\(v\) =>\s*opp \? statusMut\.mutate\(v as OppStatus\) : set\("status", v as OppStatus\)/,
    );
    expect(header).toContain("{statusSelect}");
    expect(header).not.toMatch(/\{opp && \(\s*<div className="flex items-center gap-2">\s*<Select/);
    expect(page).toMatch(/status: "open",/);
    expect(editor).toContain("...(opp ? { id: opp.id } : { status: draft.status })");
  });

  it("the site picker sits in the customer block under the customer", () => {
    expect(editor).toMatch(/<Label htmlFor=\{draft\.customer \? undefined : "opp-customer"\}>/);
    expect(editor).toContain("<OppCustomerBlock");
    expect(block).toMatch(/<SiteSelect\s+id="opp-site"/);
    expect(block).toContain("required");
    expect(block).toContain('aria-label="Change the customer"');
    expect(editor).toContain("site_id: siteId,");
    expect(editor).toContain("autoSiteId(liveSites)");
  });

  it("xl: two panes, the follow-up and the Contact section in the right column", () => {
    expect(editor).toContain(
      "xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(380px,2fr)] xl:items-start",
    );
    const aside = editor.slice(editor.indexOf("<aside"), editor.indexOf("</aside>"));
    expect(aside).toContain("xl:sticky");
    expect(aside).toContain("<FollowupStrip opp={opp} status={status} />");
    expect(aside).toContain("<LogContactButtons");
    expect(aside).toContain("<ContactLogList");
    // Not at the top of the page any more.
    expect(header).not.toContain("<LogContactButtons");
    expect(header).not.toContain("<FollowupStrip");
  });

  it("Assignee, Expected close, Lead source, Est. value in one row (four wide, else two)", () => {
    const at = editor.indexOf('data-row="opp-four-fields"');
    expect(at).toBeGreaterThan(0);
    const rowOpen = editor.slice(editor.lastIndexOf("<div", at), at);
    expect(rowOpen).toContain("grid-cols-2");
    expect(rowOpen).toContain("@2xl:grid-cols-4");
    const row = editor.slice(at, editor.indexOf('htmlFor="opp-notes"'));
    const order = ["opp-assignee", "opp-close", "opp-source", "opp-value"].map((id) =>
      row.indexOf(`htmlFor="${id}"`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(row).toMatch(/<LeadSourcePicker\s+id="opp-source"/);
  });

  it("Description and Notes grow as typed (two rows to start)", () => {
    expect(editor).toMatch(/<AutoTextarea\s+id="opp-description"\s+rows=\{2\}/);
    expect(editor).toMatch(/<AutoTextarea\s+id="opp-notes"\s+rows=\{2\}/);
    expect(page).not.toMatch(/<Textarea\b/);
  });

  it("the assignee is required: no Unassigned choice, message inline, Create off", () => {
    expect(page).not.toContain("Unassigned: no follow-up reminders");
    expect(editor).not.toContain('<SelectItem value="none">Unassigned</SelectItem>');
    expect(editor).toContain('{assigneeMessage && <p className="text-xs text-destructive">');
    expect(editor).toContain("!!assigneeMessage ||");
    expect(editor).toContain("!!siteMessage");
    expect(page).not.toMatch(/assignee_id: meId/);
  });

  it("Start a bid is a header button at every status; a linked bid shows instead", () => {
    expect(page).not.toContain('status === "quoted"');
    expect(header).toContain("Start a bid");
    expect(header).toContain("search={bidPrefillFromOpportunity(opp)}");
    expect(header).toMatch(/opp\.bid_id \?/);
    expect(header).toContain("search={{ bid: opp.bid_id }}");
    expect(header).toContain("Bid: {opp.bid_name");
  });

  it("the site shows on the list card and in the header line", () => {
    expect(page).toContain("o.site_name ? `Site: ${o.site_name}` : null");
    expect(header).toContain("opp.site_name ? `Site: ${opp.site_name}` : null");
  });
});
