/**
 * A property's own page (owner, Oct 15: "make it to where you can click a property to open its
 * own page where you can see its details, how many tickets were there, its sites, etc.").
 *
 * getProperty (crm.functions.ts) runs against an in-memory stand-in for the caller's Supabase
 * client (src/test/fake-supabase.ts); createServerFn is reduced to "validate, then call the
 * handler". The route, the page, the customer page's card and the ticket page's link are checked
 * from their source. Fails on the old code: no /properties/<id>, no getProperty, the property's
 * name plain text on the card.
 */
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { getProperty, PROPERTY_JOBS_MAX, stageCountsLine } from "@/lib/crm.functions";
import { pageForPath } from "@/lib/access";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const src = (p: string) => read(p).replace(/\s+/g, " ");

const OFFICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ESTIMATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TECH = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NOBODY = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ACC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S9 = "99999999-9999-4999-8999-999999999999";
const BID = "55555555-5555-4555-8555-555555555555";
const OLD = "2026-09-01T10:00:00.000Z";

const office = {
  id: OFFICE,
  role: "user",
  access: ["customers", "service"],
  technician: false,
  full_name: "Pat Office",
  email: "pat@example.com",
};
const estimator = { ...office, id: ESTIMATOR, access: ["estimate"], full_name: "Eve Estimator" };
const tech = { ...office, id: TECH, access: ["service"], technician: true, full_name: "Ty Tech" };
const nobody = { ...office, id: NOBODY, access: ["inventory"], full_name: "No Access" };

let env: ReturnType<typeof fakeSupabase>;
const job = (id: string, stage: string, over: Row = {}): Row => ({
  id,
  number: Number(id.replace(/\D/g, "")) || 1,
  account_id: ACC,
  site_id: S1,
  stage,
  deleted_at: null,
  updated_at: "2026-10-10T10:00:00.000Z",
  ...over,
});
function setup(opts: { site?: Row; account?: Row } = {}) {
  env = fakeSupabase({
    profiles: [office, estimator, tech, nobody],
    crm_accounts: [
      { id: ACC, name: "Acme Roofing", kind: "company", deleted_at: null, ...opts.account },
    ],
    crm_sites: [
      {
        id: S1,
        account_id: ACC,
        name: "Main St",
        address1: "1 Main St",
        city: "Middlesboro",
        state: "KY",
        zip: "40965",
        deleted_at: null,
        ...opts.site,
      },
      { id: S2, account_id: ACC, name: "Old shed", address1: "9 Elm", deleted_at: OLD },
    ],
    service_jobs: [
      job("j1", "open"),
      job("j2", "scheduled"),
      job("j3", "closed"),
      job("j4", "closed"),
      job("j5", "open", { deleted_at: OLD }), // deleted: not listed, not counted
      job("j6", "open", { site_id: S2 }), // another property's
      job("j7", "open", { site_id: null }), // the customer's, no property
    ],
    tasks: [
      { id: "t1", account_id: ACC, site_id: S1, title: "Call back", status: "open" },
      { id: "t2", account_id: ACC, site_id: null, title: "Not here", status: "open" },
    ],
    crm_opportunities: [
      {
        id: "o1",
        account_id: ACC,
        site_id: S1,
        title: "Reroof",
        status: "quoted",
        assignee_id: ESTIMATOR,
        expected_close: null,
        bid_id: BID,
        deleted_at: null,
        updated_at: "2026-10-10T10:00:00.000Z",
      },
      {
        id: "o2",
        account_id: ACC,
        site_id: null,
        title: "Elsewhere",
        status: "open",
        assignee_id: null,
        expected_close: null,
        bid_id: null,
        deleted_at: null,
        updated_at: "2026-10-10T10:00:00.000Z",
      },
    ],
    bids: [
      {
        id: BID,
        name: "Main St reroof",
        status: "draft",
        grand_total: 12345,
        account_id: ACC,
        site_id: S1,
        deleted_at: null,
        updated_at: "2026-10-09T10:00:00.000Z",
      },
      {
        id: "b2",
        name: "Other",
        status: "draft",
        grand_total: 1,
        account_id: ACC,
        site_id: null,
        deleted_at: null,
      },
    ],
  });
}
const ctx = (userId: string) => ({ supabase: env.db, userId });
const call = <T = void>(fn: unknown, data: Row, userId = OFFICE) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({ data, context: ctx(userId) });
type Detail = {
  site: Row;
  account: { id: string; name: string; deleted_at: string | null };
  jobs: Row[];
  job_counts: Record<string, number>;
  opportunities: Row[];
  bids: Row[];
  tasks: Row[];
};

beforeEach(() => setup());

describe("stageCountsLine (pure)", () => {
  it("the total, then each stage with any, in stage order", () => {
    expect(stageCountsLine({ closed: 9, open: 2, scheduled: 1 })).toBe(
      "12 tickets · 2 open · 1 scheduled · 9 closed",
    );
    expect(stageCountsLine({ done: 1 })).toBe("1 ticket · 1 done");
    expect(stageCountsLine({ invoiced: 2, authorized: 1, odd: 1 })).toBe(
      "4 tickets · 1 authorized · 2 invoiced · 1 odd",
    );
    expect(stageCountsLine({})).toBe("No tickets");
    expect(stageCountsLine({ open: 0 })).toBe("No tickets");
  });
});

describe("getProperty", () => {
  it("the property, its customer and what links to it by site_id — live tickets with counts by stage, tasks, opportunities", async () => {
    const d = await call<Detail>(getProperty, { id: S1 });
    expect(d.site["id"]).toBe(S1);
    expect(d.site["name"]).toBe("Main St");
    expect(d.account).toMatchObject({ id: ACC, name: "Acme Roofing", deleted_at: null });
    expect(d.jobs.map((j) => j["id"]).sort()).toEqual(["j1", "j2", "j3", "j4"]);
    expect(d.job_counts).toEqual({ open: 1, scheduled: 1, closed: 2 });
    expect(d.tasks.map((t) => t["id"])).toEqual(["t1"]);
    expect(d.opportunities.map((o) => o["id"])).toEqual(["o1"]);
    expect(d.opportunities[0]!["assignee_name"]).toBe("Eve Estimator");
    expect(d.opportunities[0]!["bid_status"]).toBe("draft");
    expect(PROPERTY_JOBS_MAX).toBe(500);
  });
  it("bids ride along for Estimate access only (as on the customer); a technician gets none", async () => {
    expect((await call<Detail>(getProperty, { id: S1 })).bids).toEqual([]);
    expect((await call<Detail>(getProperty, { id: S1 }, TECH)).bids).toEqual([]);
    const d = await call<Detail>(getProperty, { id: S1 }, ESTIMATOR);
    expect(d.bids.map((b) => b["id"])).toEqual([BID]);
    expect(d.bids[0]!["grand_total"]).toBe(12345);
  });
  it("reads with Customers, Service or Estimate access; refuses anyone else", async () => {
    await expect(call(getProperty, { id: S1 }, TECH)).resolves.toBeTruthy();
    await expect(call(getProperty, { id: S1 }, NOBODY)).rejects.toThrow(
      "Forbidden: Customers access required",
    );
  });
  it("a deleted property still opens (its deleted_at set); a deleted customer is reported", async () => {
    const gone = await call<Detail>(getProperty, { id: S2 });
    expect(gone.site["deleted_at"]).toBe(OLD);
    expect(gone.jobs.map((j) => j["id"])).toEqual(["j6"]);
    setup({ account: { deleted_at: OLD } });
    expect((await call<Detail>(getProperty, { id: S1 })).account.deleted_at).toBe(OLD);
  });
  it("an unknown id and a bad id", async () => {
    await expect(call(getProperty, { id: S9 })).rejects.toThrow("Property not found");
    expect(() => call(getProperty, { id: "nope" })).toThrow("The record looks wrong");
    expect(env.writes).toEqual([]);
  });
});

describe("the route and the page (source)", () => {
  it("/properties/<id> renders PropertyPage, like /customers/<id>", () => {
    const route = read("src/routes/properties_.$id.tsx");
    expect(route).toContain('createFileRoute("/properties_/$id")');
    expect(route).toContain('title: "Property — JBK Portal"');
    expect(route).toContain("return <PropertyPage key={id} id={id} />;");
    // The generated tree resolves the underscore file to /properties/$id.
    const tree = read("src/routeTree.gen.ts");
    expect(tree).toContain("'/properties/$id'");
    expect(tree).toContain("'/properties_/$id'");
    // The gate: the Customers page's, like the customer it belongs to.
    expect(pageForPath("/properties/0d1b5a1e-0000-4000-8000-000000000001")).toBe("customers");
  });
  it("the page: name, address, county code, the customer link, Edit (SiteForm in place), New ticket on the customer page's gate, warranties and sites", () => {
    const page = read("src/components/property-page.tsx");
    expect(page).toContain('<h2 className="truncate text-xl font-semibold">{s.name}</h2>');
    expect(page).toContain('{siteAddressLine(s) || "No address on file"}');
    expect(page).toContain("<CountyCodeLine id={s.county_code_id}");
    expect(page).toContain('to="/customers/$id"');
    expect(page).toContain("params={{ id: d.account.id }}");
    expect(page).toContain("<SiteForm");
    expect(page).toContain(
      'const canNewTicket = can("service") && dispatchesTickets(profile) && !deleted;',
    );
    expect(page).toContain(
      '<Link to="/service" search={{ new: 1, account: d.account.id, site: s.id }}>',
    );
    expect(page).toContain("<SiteWarranties siteId={s.id} />");
    expect(page).toContain("<PropertySites propertyId={s.id} />");
    expect(page).toContain("{s.technician_instructions && (");
    expect(page).toContain("{s.notes && (");
  });
  it("the sections: Tickets with the counts line, Opportunities and Bids behind their gates, Tasks on the property, History of the site", () => {
    const page = read("src/components/property-page.tsx");
    expect(page).toContain("summary={stageCountsLine(counts)}");
    expect(page).toContain("<TicketRows jobs={jobs} showSite={false} />");
    expect(page).toContain("{seesOpportunitiesList(profile) && (");
    expect(page).toContain('{can("estimate") && <PropertyBids bids={d.bids} />}');
    expect(page).toContain("site={{ id: s.id, name: s.name }}");
    expect(page).toContain(
      '<AuditHistory entity="site" entityId={id} className="rounded-lg border p-4" />',
    );
    // No takeoffs: they link by customer and building, not property.
    expect(page).not.toContain("TakeoffsSection");
    expect(page).not.toContain("listAccountTakeoffs");
  });
  it("never shows a price to a technician: money is rendered in the Estimate-gated bids list only", () => {
    const page = read("src/components/property-page.tsx");
    const bidsAt = page.indexOf("function PropertyBids(");
    expect(bidsAt).toBeGreaterThan(0);
    const before = page.slice(0, bidsAt).replace(/^const money = [^]*?;\n/m, "");
    expect(before).not.toContain("money(");
    expect(before).not.toContain("grand_total");
    expect(page.slice(bidsAt)).toContain("{money(Number(b.grand_total) || 0)}");
    // The shared ticket rows carry no money either.
    const rows = read("src/components/crm/ticket-rows.tsx");
    expect(rows).not.toMatch(/money\(|grand_total|unit_price|bill_rate/);
    // And the server sends bids with Estimate access only.
    const fn = read("src/lib/crm.functions.ts");
    const gp = fn.slice(fn.indexOf("export const getProperty"), fn.indexOf("const defined ="));
    expect(gp).toContain('if (canAccess(p, "estimate")) {');
    expect(gp).toContain('.eq("site_id", data.id)');
  });
  it("a deleted property or customer: the same banner style as the customer page, read-only", () => {
    const page = read("src/components/property-page.tsx");
    expect(page).toContain("const deleted = !!s.deleted_at || !!d.account.deleted_at;");
    expect(page).toContain('data-banner="deleted"');
    expect(page).toContain("{deletedLine(s.deleted_at, null)}");
    expect(page).toContain("readOnly={deleted}");
    expect(page).toContain("{editing && !deleted ? (");
    expect(page).toContain("{!deleted && (");
  });
  it("History: the audit log's 'site' rows (crm_sites, and the property's sites and warranties under it)", () => {
    expect(src("src/components/audit-history.tsx")).toContain('| "bid" | "site";');
    const fns = src("src/lib/audit.functions.ts");
    expect(fns).toContain('"opportunity", "bid", "site", ]),');
    expect(fns).toContain('data.entity === "bid" || data.entity === "site" ) {');
    const mig = read("supabase/migrations/20261001080000_audit_triggers_stage_rule.sql");
    expect(mig).toContain("when 'crm_sites' then v_entity := 'site';");
    expect(read("supabase/migrations/20261006201000_audit_property_children.sql")).toContain(
      "logged as\n-- entity 'site' under their property",
    );
  });
});

describe("the ways in (source)", () => {
  it("the customer page's property card: the name opens the property, with its ticket count; Edit / Delete / New ticket stay buttons", () => {
    const page = read("src/components/customers-page.tsx");
    const card = page.slice(
      page.indexOf("function SitesSection("),
      page.indexOf("function TicketsSection("),
    );
    expect(card).toContain('to="/properties/$id"');
    expect(card).toContain("params={{ id: s.id }}");
    expect(card).toContain('title="Open this property"');
    expect(card).toContain("const ticketCounts = countBy(jobs, (j) => j.site_id);");
    expect(card.replace(/\s+/g, " ")).toContain(
      '{ticketCounts.get(s.id) ?? 0} ticket{ticketCounts.get(s.id) === 1 ? "" : "s"}',
    );
    expect(card).toContain("aria-label={`Edit ${s.name}`}");
    expect(card).toContain("aria-label={`Delete ${s.name}`}");
    expect(card).toContain(
      '<Link to="/service" search={{ new: 1, account: accountId, site: s.id }}>',
    );
    // The whole card is not a link, so the buttons never navigate.
    expect(card).not.toContain('role="link"');
    expect(page).toContain(
      "<SitesSection accountId={id} sites={d.sites} jobs={d.jobs} readOnly={deleted} />",
    );
  });
  it("the ticket page's Customer block links to the property when one is picked", () => {
    const page = src("src/components/service-page.tsx");
    expect(page).toContain(
      '{props.siteId && ( <Link to="/properties/$id" params={{ id: props.siteId }}',
    );
    expect(page).toContain("Open property </Link>");
  });
});
