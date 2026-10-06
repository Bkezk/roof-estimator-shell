/**
 * Owner, Oct 2 — "We should probably require the customer name, address and one contact and site
 * for an opportunity as well. Don't replicate forms that already exist in Opportunities, just
 * take a look at how we can integrate that." And: marking an opportunity Won simply records the
 * win (no panel under the header); Start a ticket and Start a bid are header buttons, prefilled.
 *
 *  1. Customer required: the form, the rules and saveOpportunity ("Pick or add the customer");
 *     the picker's quick-add asks for the address too (QuickAddCustomerDialog requireAddress).
 *  2. Site required for every opportunity; a customer with none gets "Add site" in the site box,
 *     which opens the Customers page's own site form (moved to components/crm/site-form.tsx).
 *  3. Contact: the existing customer rule (hasContactMethod); an older customer without one gets
 *     the Customers page's warning and the server refuses the save.
 *  4. Start a ticket (managers / admins): the new-ticket form with the customer, site and
 *     description, the opportunity carried as service_jobs.from_opportunity_id; the ticket says
 *     "From opportunity: <title>", the opportunity lists "Ticket #6004".
 *  5. No "what happens next" panel.
 */
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));
vi.mock("@/lib/ticket-events.server", () => ({ afterTicketStage: vi.fn(async () => {}) }));
vi.mock("@/lib/service-crew.server", () => ({
  syncCrewLead: vi.fn(async () => {}),
  writeCrew: vi.fn(async () => 0),
  readCrew: vi.fn(async () => []),
}));

import * as form from "@/lib/opportunity-form";
import * as crmAccount from "@/lib/crm-account";
import * as opps from "@/lib/opportunities.functions";
import { saveServiceJob } from "@/lib/service.functions";
import { parseServiceSearch } from "@/lib/service-search";
import { siteRequiredMessage } from "@/lib/ticket-form";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");

const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACC = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1"; // one site, a phone
const ACC_NO_SITE = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2"; // an email, no site
const ACC_NO_CONTACT = "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3"; // a site, no way to reach them
const SITE = "51515151-5151-4515-8515-515151515151";
const SITE3 = "53535353-5353-4535-8535-535353535353";
const OPP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const JOB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const mgr = {
  id: MGR,
  role: "manager",
  access: [],
  technician: false,
  full_name: "Mo Manager",
  email: "mo@example.com",
};

let env: ReturnType<typeof fakeSupabase>;
function setup() {
  env = fakeSupabase({
    profiles: [mgr],
    crm_accounts: [
      { id: ACC, name: "Bell County Schools", phone: "606-555-0100", deleted_at: null },
      { id: ACC_NO_SITE, name: "Pineville Water", email: "office@pv.example", deleted_at: null },
      // Older data: saved before the contact rule (the constraint is NOT VALID).
      { id: ACC_NO_CONTACT, name: "Old Mill LLC", email: " ", phone: null, deleted_at: null },
    ],
    crm_sites: [
      { id: SITE, account_id: ACC, name: "Yellow Creek gym", deleted_at: null },
      { id: SITE3, account_id: ACC_NO_CONTACT, name: "Mill", deleted_at: null },
    ],
    crm_opportunities: [
      {
        id: OPP,
        title: "Reroof gym",
        account_id: ACC,
        site_id: SITE,
        bid_id: null,
        assignee_id: MGR,
        status: "open",
        expected_close: "2026-10-20",
        deleted_at: null,
      },
    ],
    crm_followups: [],
    crm_contact_log: [],
    bids: [],
    service_jobs: [],
    crm_settings: [
      { id: 1, opportunity_close_days: 30, opportunity_first_days: 3, opportunity_every_days: 7 },
    ],
  });
}
const call = <T = void>(fn: unknown, data: Row) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId: MGR },
  });
const oppWrites = () => env.writes.filter((w) => w.table === "crm_opportunities");

beforeEach(() => setup());

// ---------------------------------------------------------------------------------------------

describe("1–3. the rules: customer, site and contact are required", () => {
  it("the customer: plain message, no customer = refused", () => {
    expect(form.OPP_CUSTOMER_REQUIRED).toBe("Pick or add the customer");
    expect(form.opportunityProblem({ account_id: null, site_id: null, siteCount: 0 })).toBe(
      "Pick or add the customer",
    );
    expect(form.opportunityProblem({ account_id: "", site_id: SITE, siteCount: 1 })).toBe(
      "Pick or add the customer",
    );
  });
  it("the site: every opportunity has one (no customer is no site either)", () => {
    expect(form.opportunitySiteProblem({ account_id: null, site_id: null, siteCount: 3 })).toBe(
      form.OPP_CUSTOMER_REQUIRED,
    );
    expect(form.OPP_SITE_NEEDED).toBe("Add a property to this customer first");
    expect(form.opportunitySiteProblem({ account_id: ACC, site_id: null, siteCount: 0 })).toBe(
      "Add a property to this customer first",
    );
    expect(form.opportunitySiteProblem({ account_id: ACC, site_id: null, siteCount: 2 })).toBe(
      siteRequiredMessage(2),
    );
    // One site is the one (the form and the server pick it); a picked site is fine.
    expect(form.opportunitySiteProblem({ account_id: ACC, site_id: null, siteCount: 1 })).toBe(
      null,
    );
    expect(form.opportunitySiteProblem({ account_id: ACC, site_id: SITE, siteCount: 0 })).toBe(
      null,
    );
  });
  it("the contact: the customer rule (hasContactMethod), unknown is not a problem", () => {
    expect(form.OPP_CUSTOMER_NO_CONTACT).toBe("This customer needs a phone or an email first");
    const base = { account_id: ACC, site_id: SITE, siteCount: 1 };
    expect(form.opportunityProblem({ ...base, hasContact: false })).toBe(
      form.OPP_CUSTOMER_NO_CONTACT,
    );
    expect(form.opportunityProblem({ ...base, hasContact: true })).toBeNull();
    expect(form.opportunityProblem({ ...base, hasContact: null })).toBeNull();
    const fns = read("src/lib/opportunities.functions.ts");
    expect(fns).toContain("hasContact: hasContactMethod(acc)");
  });
  it("no 'optional' customer left in the rules, the page or the server", () => {
    const rules = read("src/lib/opportunity-form.ts");
    expect(rules).not.toMatch(/customer stays optional/);
    expect(rules).not.toMatch(/a prospect may not be a customer yet/);
    const page = read("src/components/opportunities-page.tsx");
    expect(page).not.toContain("Search or add a customer (optional)");
    expect(page).not.toMatch(/Optional \(a prospect may not be a customer yet\)/);
    expect(page).not.toMatch(/a customer is optional/);
    const fns = read("src/lib/opportunities.functions.ts");
    expect(fns).not.toContain("without a customer there is no site");
  });
});

describe("1–3. saveOpportunity refuses; nothing written", () => {
  const base = { title: "New work", assignee_id: MGR };
  it("no customer", async () => {
    await expect(call(opps.saveOpportunity, base)).rejects.toThrow("Pick or add the customer");
    await expect(call(opps.saveOpportunity, { ...base, account_id: null })).rejects.toThrow(
      "Pick or add the customer",
    );
    expect(oppWrites()).toEqual([]);
  });
  it("an update may not clear the customer", async () => {
    await expect(
      call(opps.saveOpportunity, { id: OPP, ...base, account_id: null, site_id: null }),
    ).rejects.toThrow("Pick or add the customer");
    expect(oppWrites()).toEqual([]);
  });
  it("a customer with no site", async () => {
    await expect(call(opps.saveOpportunity, { ...base, account_id: ACC_NO_SITE })).rejects.toThrow(
      "Add a property to this customer first",
    );
    expect(oppWrites()).toEqual([]);
  });
  it("a customer nobody can reach (older data)", async () => {
    await expect(
      call(opps.saveOpportunity, { ...base, account_id: ACC_NO_CONTACT, site_id: SITE3 }),
    ).rejects.toThrow("This customer needs a phone or an email first");
    expect(oppWrites()).toEqual([]);
  });
  it("a customer with one site and a phone: saved with that site", async () => {
    const row = await call<Row>(opps.saveOpportunity, { ...base, account_id: ACC });
    expect(row).toMatchObject({ account_id: ACC, site_id: SITE, title: "New work" });
  });
});

describe("1. the form: customer required, the quick-add asks for the address", () => {
  const page = read("src/components/opportunities-page.tsx");
  const editor = page.slice(
    page.indexOf("function OppEditor("),
    page.indexOf("function OppCustomerBlock("),
  );
  it("Create stays off until a customer is picked; the message under the box", () => {
    expect(editor).toContain("const customerMessage = opportunityProblem({");
    expect(editor).toContain("!!customerMessage ||");
    expect(editor).toMatch(
      /\{!draft\.customer && customerMessage && \(\s*<p className="text-xs text-destructive">\{customerMessage\}<\/p>/,
    );
    expect(editor).toContain('placeholder="Search or add a customer…"');
  });
  it("the opportunity's picker passes requireAddress; the ticket's does not", () => {
    expect(editor).toMatch(/<AccountPicker\s+id="opp-customer"[\s\S]*?requireAddress/);
    const ticket = read("src/components/service-page.tsx");
    expect(ticket).toContain("<AccountPicker");
    expect(ticket).not.toContain("requireAddress");
  });
  it("addressProblem: street, city, state and ZIP (a state alone is not an address)", () => {
    expect(crmAccount.ADDRESS_REQUIRED).toBe("Add the street address, city, state and ZIP");
    const blank = { address1: "", address2: "", city: "", state: "KY", zip: "" };
    expect(crmAccount.addressProblem(blank)).toBe(crmAccount.ADDRESS_REQUIRED);
    expect(crmAccount.addressProblem({ ...blank, address1: "1 Main St", city: "Pineville" })).toBe(
      crmAccount.ADDRESS_REQUIRED,
    );
    expect(
      crmAccount.addressProblem({
        address1: " 1 Main St ",
        address2: "",
        city: "Pineville",
        state: "KY",
        zip: "40977",
      }),
    ).toBeNull();
  });
  it("QuickAddCustomerDialog takes requireAddress (default off) and checks it on Save", () => {
    const picker = read("src/components/crm/account-picker.tsx");
    const dialog = picker.slice(picker.indexOf("export function QuickAddCustomerDialog("));
    expect(dialog).toContain("requireAddress?: boolean;");
    expect(dialog).toContain(
      "const addressMissing = props.requireAddress ? addressProblem(physical) : null;",
    );
    expect(dialog).toMatch(/if \(addressMissing\) \{\s*toast\.error\(addressMissing\);\s*return;/);
    // The AccountPicker hands it through.
    expect(picker).toContain("requireAddress={!!props.requireAddress}");
    // The Customers page's own "New customer" keeps the address optional.
    const customers = read("src/components/customers-page.tsx");
    expect(customers).toContain("<QuickAddCustomerDialog");
    expect(customers).not.toContain("requireAddress");
  });
});

describe("2. the site: SiteSelect's Add site opens the Customers page's site form", () => {
  it("SiteForm lives in components/crm/site-form.tsx, with its fields", () => {
    expect(existsSync("src/components/crm/site-form.tsx")).toBe(true);
    const src = read("src/components/crm/site-form.tsx");
    expect(src).toContain("export function SiteForm(");
    for (const part of [
      "<Label htmlFor={`site-${idp}-name`}>Property name</Label>",
      'aria-label="Address line 1"',
      'aria-label="City"',
      'aria-label="State"',
      'aria-label="Zip"',
      "<CountyCodePicker",
      "<Label htmlFor={`site-${idp}-tech`}>Technician instructions</Label>",
      "<Label htmlFor={`site-${idp}-notes`}>Notes</Label>",
      "saveFn({ data: sitePayload(props.accountId, props.site?.id ?? null, f) })",
    ])
      expect(src).toContain(part);
    // Inside another form (the opportunity's), its submit stays its own.
    expect(src).toContain("e.stopPropagation();");
    // The saved row goes back to the caller.
    expect(src).toContain("props.onDone(true, row);");
  });
  it("the Customers page imports it (moved, not copied)", () => {
    const page = read("src/components/customers-page.tsx");
    expect(page).toContain('import { SiteForm } from "@/components/crm/site-form";');
    expect(page).not.toContain("function SiteForm(");
    expect(page).not.toContain("const siteFields =");
    expect(page).toContain("<SiteForm");
  });
  it("SiteSelect: allowAdd (default off) offers Add site for a customer with none; the saved site is picked", () => {
    const src = read("src/components/crm/site-select.tsx");
    expect(src).toContain("allowAdd?: boolean;");
    expect(src).toContain('import { SiteForm } from "@/components/crm/site-form";');
    expect(src).toContain('const mayAdd = !!props.allowAdd && can("customers");');
    expect(src).toMatch(/\{mayAdd && \(/);
    expect(src).toContain("Add site");
    expect(src).toMatch(/onDone=\{\(changed, row\) => \{[\s\S]*?props\.onChange\(row\)/);
  });
  it("the opportunity's site box passes allowAdd and keeps the pick", () => {
    const page = read("src/components/opportunities-page.tsx");
    const block = page.slice(page.indexOf("function OppCustomerBlock("));
    expect(block).toMatch(/<SiteSelect\s+id="opp-site"[\s\S]*?allowAdd/);
    // The ticket's site box does not.
    expect(read("src/components/service-page.tsx")).not.toContain("allowAdd");
  });
});

describe("3. contact: the Customers page's warning on the opportunity", () => {
  it("one shared line", () => {
    expect(crmAccount.NO_CONTACT_ON_FILE).toBe(
      "Add an email or a phone number: this customer has no email or phone on file. Edit to add one.",
    );
    const customers = read("src/components/customers-page.tsx");
    expect(customers).toContain("{NO_CONTACT_ON_FILE}");
    const page = read("src/components/opportunities-page.tsx");
    const block = page.slice(page.indexOf("function OppCustomerBlock("));
    expect(block).toContain("{NO_CONTACT_ON_FILE}");
    expect(block).toContain("props.noContact &&");
  });
});

// ---------------------------------------------------------------------------------------------

describe("4. Start a ticket", () => {
  const opp = {
    id: OPP,
    title: "Reroof gym",
    description: "  TPO over the gym  ",
  };
  it("the link: a new ticket carrying the opportunity; /service keeps it", () => {
    const pf = form.ticketPrefillFromOpportunity(opp);
    expect(pf).toEqual({ new: 1, opportunity: OPP });
    expect(parseServiceSearch({ new: "1", opportunity: OPP })).toEqual({
      new: 1,
      opportunity: OPP,
    });
    expect(parseServiceSearch({ new: "1", opportunity: "nope" })).toEqual({ new: 1 });
    // Only with new=1.
    expect(parseServiceSearch({ opportunity: OPP })).toEqual({});
  });
  it("the seed: the description (else the title), at most 500, and the opportunity id", () => {
    expect(form.ticketSeedFromOpportunity(opp)).toEqual({
      description: "TPO over the gym",
      from_opportunity_id: OPP,
    });
    expect(form.ticketSeedFromOpportunity({ ...opp, description: " " }).description).toBe(
      "Reroof gym",
    );
    const long = "x".repeat(900);
    expect(form.ticketSeedFromOpportunity({ ...opp, description: long }).description).toHaveLength(
      500,
    );
  });
  it("a header button beside Start a bid, for those who create tickets, at every status", () => {
    const page = read("src/components/opportunities-page.tsx");
    const editor = page.slice(
      page.indexOf("function OppEditor("),
      page.indexOf("function OppCustomerBlock("),
    );
    const header = editor.slice(
      editor.indexOf("<BackToList />"),
      editor.indexOf("{opp?.deleted_at && ("),
    );
    expect(header).toContain("Start a ticket");
    expect(header).toContain("search={ticketPrefillFromOpportunity(opp)}");
    expect(header).toContain("managesTickets(profile)");
    expect(header.indexOf("Start a bid")).toBeLessThan(header.indexOf("Start a ticket"));
    expect(header).not.toMatch(/status === "won"[\s\S]{0,80}Start a ticket/);
    // "Ticket #6004" once one exists.
    expect(header).toContain("{ticketLinkLabel(t.number)}");
    expect(form.ticketLinkLabel(6004)).toBe("Ticket #6004");
  });
  it("the /service route opens the new ticket from the opportunity, prefilled", () => {
    expect(read("src/routes/service.tsx")).toContain("opportunity={search.opportunity}");
    const page = read("src/components/service-page.tsx");
    expect(page).toContain("if (opportunity) return <NewForOpportunity");
    expect(page).toContain("ticketSeedFromOpportunity(o)");
    expect(page).toMatch(
      /\.\.\.\(!job && seed\?\.from_opportunity_id\s*\?\s*\{ from_opportunity_id: seed\.from_opportunity_id \}\s*:\s*\{\}\),/,
    );
  });
  it("saveServiceJob writes from_opportunity_id on create, never on an update", async () => {
    const row = await call<Row>(saveServiceJob, {
      account_id: ACC,
      site_id: SITE,
      description: "TPO over the gym",
      service_type: "leak",
      scheduled_date: "2026-10-05",
      from_opportunity_id: OPP,
    });
    expect(row["from_opportunity_id"]).toBe(OPP);
    const ins = env.writes.find((w) => w.table === "service_jobs" && w.op === "insert");
    expect(ins?.payload).toMatchObject({ from_opportunity_id: OPP });
    env.tables["service_jobs"]!.push({
      id: JOB,
      number: 6004,
      stage: "open",
      account_id: ACC,
      site_id: SITE,
      technician_id: null,
      scheduled_date: "2026-10-05",
      deleted_at: null,
      from_opportunity_id: null,
    });
    await call(saveServiceJob, {
      id: JOB,
      account_id: ACC,
      site_id: SITE,
      description: "x",
      from_opportunity_id: OPP,
    });
    const upd = env.writes.filter((w) => w.table === "service_jobs" && w.op === "update");
    for (const u of upd) expect(u.payload).not.toHaveProperty("from_opportunity_id");
  });
  it("an opportunity that is not there is refused", async () => {
    await expect(
      call(saveServiceJob, {
        account_id: ACC,
        site_id: SITE,
        description: "x",
        scheduled_date: "2026-10-05",
        from_opportunity_id: "99999999-9999-4999-8999-999999999999",
      }),
    ).rejects.toThrow("Opportunity not found");
  });
  it("the opportunity lists its live tickets (listOpportunityTickets)", async () => {
    env.tables["service_jobs"]!.push(
      { id: JOB, number: 6004, from_opportunity_id: OPP, deleted_at: null },
      { id: "j2", number: 6005, from_opportunity_id: OPP, deleted_at: "2026-10-02T00:00:00Z" },
      { id: "j3", number: 6006, from_opportunity_id: null, deleted_at: null },
    );
    const list = await call<Row[]>(opps.listOpportunityTickets, { id: OPP });
    expect(list).toEqual([{ id: JOB, number: 6004 }]);
  });
  it("the ticket says where it came from", () => {
    expect(form.fromOpportunityLabel("Reroof gym")).toBe("From opportunity: Reroof gym");
    const page = read("src/components/service-page.tsx");
    const opened = page.indexOf('data-line="opened"');
    const note = page.indexOf("<FromOpportunityNote");
    expect(note).toBeGreaterThan(opened);
    expect(note - opened).toBeLessThan(400);
    expect(page).toContain("fromOpportunityLabel(q.data.title)");
  });
  it("the column: migration (idempotent, nullable, no backfill) and types", () => {
    const path = "supabase/migrations/20261002150000_opportunity_customer_required.sql";
    expect(existsSync(path)).toBe(true);
    const sql = read(path).replace(/--[^\n]*/g, "");
    expect(sql).toMatch(
      /alter table public\.service_jobs\s+add column if not exists from_opportunity_id uuid references public\.crm_opportunities\(id\) on delete set null;/,
    );
    expect(sql).toMatch(
      /create index if not exists service_jobs_from_opportunity_idx on public\.service_jobs \(from_opportunity_id\)\s+where from_opportunity_id is not null;/,
    );
    // No NOT NULL anywhere (older rows must still open), no constraint, no backfill.
    expect(sql).not.toMatch(/set not null|uuid not null|add constraint/i);
    expect(sql).not.toMatch(/\bupdate\s+public\./i);
    const types = read("src/integrations/supabase/types.ts");
    const jobs = types.slice(types.indexOf("      service_jobs: {"));
    const jobsEnd = jobs.indexOf("Relationships:");
    const block = jobs.slice(0, jobsEnd);
    expect(block).toContain("from_opportunity_id: string | null;");
    expect(block.match(/from_opportunity_id\?: string \| null;/g)).toHaveLength(2);
  });
});

describe("Est. value starts blank (owner: number boxes start blank, never a placeholder 0)", () => {
  const page = read("src/components/opportunities-page.tsx");
  const box = page.slice(
    page.indexOf('<Label htmlFor="opp-value">'),
    page.indexOf('htmlFor="opp-notes"'),
  );
  it("the box shows nothing for 0 / null: no value, no placeholder 0", async () => {
    const { numberFieldView } = await import("@/lib/number-field-view");
    expect(box).toMatch(/<NumberField[\s\S]*?placeholder=""/);
    expect(box).not.toContain("blankZero={false}");
    // What NumberField shows with the box's props: nothing.
    expect(numberFieldView({ value: 0, placeholder: "" })).toEqual({ text: "", placeholder: "" });
    expect(numberFieldView({ value: 1250, placeholder: "" })).toEqual({
      text: "1250",
      placeholder: "",
    });
    // The default the owner saw on the live page: a grey 0.
    // The default is blank too since Oct 2 (number-field-view.test.ts): no grey 0 anywhere.
    expect(numberFieldView({ value: 0 })).toEqual({ text: "", placeholder: undefined });
  });
  it("null loads as blank; blank saves as null", () => {
    expect(page).toContain("est_value: o.est_value ?? 0,");
    expect(page).toContain("est_value: draft.est_value > 0 ? draft.est_value : null,");
  });
});

describe("5. Won records the win: no panel", () => {
  it("nothing about what happens next, no Not now", () => {
    const page = read("src/components/opportunities-page.tsx");
    expect(page).not.toMatch(/what happens next/i);
    expect(page).not.toContain("Not now");
    expect(page).not.toMatch(/data-panel="won"|WonPanel|wonPanel/);
    // The status change is the status change: a toast, no dialog.
    const statusMut = page.slice(page.indexOf("const statusMut = useMutation({"));
    expect(statusMut.slice(0, statusMut.indexOf("});") + 3)).not.toMatch(/set\w*Open\(|Dialog/);
  });
});
