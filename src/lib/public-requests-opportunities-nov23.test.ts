/**
 * Nov 23, the owner: "i like option A". A request sent from a public page (Roof Care plans, or
 * Request service) becomes an opportunity the moment it is sent, in the normal Opportunities
 * list, instead of waiting on a list of its own.
 *
 *  - The database makes the opportunity in the same step as the request: no customer on it,
 *    nobody assigned, the source "QR page", due the next day.
 *  - The notice and the Needs attention row open that opportunity.
 *  - On the opportunity a strip shows what the customer sent and offers the possible matches.
 *    Saying whose it is puts the customer on the opportunity (the database's own function).
 *  - A Roof Care request then opens the normal sign-up. When the plan is signed the opportunity
 *    is set to Won. No payment is taken on the public page.
 *  - The request follows its opportunity: deleted, restored, or a customer picked on the form.
 *
 * Names and figures are made up and match no plan price.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const told: [string[], { title: string; body: string; url: string; kind: string }][] = [];
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  notify: async (to: string[], n: { title: string; body: string; url: string; kind: string }) => {
    told.push([to, n]);
    return to.length;
  },
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => true,
  appUrl: () => "",
}));

import { fakeSupabase } from "@/test/fake-supabase";
import { attentionList, ATTENTION_DEFAULTS } from "@/lib/owner-attention";
import { dispatchPublicRequestNotices } from "@/lib/public-forms.server";
import {
  NO_CUSTOMER_YET,
  QR_LEAD_SOURCE,
  publicRequestNotice,
  requestOpportunityPath,
  requestStep,
  requestStepWords,
  requestStripTitle,
} from "@/lib/public-requests";
import { getOpportunityRequest, handlePublicRequest } from "@/lib/public-requests.functions";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const run = (fn: unknown, db: unknown, data: unknown, userId = "u1") =>
  (fn as (a: unknown) => Promise<unknown>)({ data, context: { supabase: db, userId } });

const REQ = "0b6a3c1e-1111-4222-8333-444455556666";
const OPP = "7c6a3c1e-1111-4222-8333-444455556666";
const ACC = "1a6a3c1e-1111-4222-8333-444455556666";
const SITE = "2b6a3c1e-1111-4222-8333-444455556666";
const PLAN = "3d6a3c1e-1111-4222-8333-444455556666";

const people = [
  {
    id: "u1",
    role: "user",
    access: ["customers"],
    technician: false,
    full_name: "Olga Office",
    email: "o@x",
  },
  {
    id: "u3",
    role: "user",
    access: ["service"],
    technician: true,
    full_name: "Tom Tech",
    email: "t@x",
  },
  { id: "a1", role: "admin", access: [], technician: false, full_name: "Ann Admin", email: "a@x" },
];

const request = (over: Record<string, unknown> = {}) => ({
  id: REQ,
  reference: "R-4010",
  kind: "care",
  created_at: "2026-11-23T15:00:00Z",
  status: "new",
  contact_name: "Pat Smith",
  company: "Smith Widgets",
  phone: "606-555-0142",
  email: "pat@example.com",
  address: "120 Mill St",
  city: "London",
  state: "KY",
  zip: "40741",
  building_name: "Main plant",
  referred_by: "Tom Tech",
  plan: "guard",
  sqft: 21400,
  size_range: null,
  sqft_source: "typed",
  shown_price: 1740,
  quote: { found: true, rough: false, place: null, custom_quote: false },
  pay_method: "card",
  terms_version: "2026-11-23.1",
  agreed_by: "Patricia Smith",
  several_buildings: false,
  notes: "",
  services: [],
  details: "",
  told_at: null,
  handled_at: null,
  handled_by_name: null,
  dismiss_reason: null,
  account_id: null,
  site_id: null,
  opportunity_id: OPP,
  roof_care_plan_id: null,
  ...over,
});

const opportunity = (over: Record<string, unknown> = {}) => ({
  id: OPP,
  title: "Smith Widgets: Roof Guard plan",
  status: "open",
  account_id: null,
  site_id: null,
  assignee_id: null,
  expected_close: "2026-11-24",
  deleted_at: null,
  updated_by_name: "Public page",
  ...over,
});

beforeEach(() => {
  told.length = 0;
});

describe("the database makes the opportunity when the request is sent", () => {
  const sql = read("supabase/migrations/20261123200000_public_requests_become_opportunities.sql");
  const one = flat(sql);
  it("in the same step as the request, with no customer and nobody on it", () => {
    expect(one).toContain("left(p_key, 80)) returning id into v_id;");
    expect(one).toContain(
      "insert into public.crm_opportunities ( title, description, status, lead_source, referred_by, est_value, expected_close, created_by, updated_by_name)",
    );
    // No account, no site and no assignee are written: the "nobody on it" mark is the
    // database's own (crm_opportunities_stamp_assigned), so the alert covers it.
    const insert = one.slice(
      one.indexOf("insert into public.crm_opportunities ("),
      one.indexOf("returning id into v_opp;"),
    );
    expect(insert).not.toContain("account_id");
    expect(insert).not.toContain("assignee_id");
    expect(insert).toContain(`'open', '${QR_LEAD_SOURCE}',`);
    // Its value is the price the page showed, for a Roof Care request that had one.
    expect(insert).toContain("case when v_kind = 'care' then v_shown end,");
    // Due the next day, by the office's clock: someone is waiting to hear back.
    expect(insert).toContain("(now() at time zone 'America/New_York')::date + 1,");
    expect(one).toContain(
      "update public.public_requests set opportunity_id = v_opp where id = v_id; return v_ref;",
    );
  });
  it("its title says what was asked for", () => {
    expect(one).toContain("v_title := v_from || ': Roof Care custom quote';");
    expect(one).toContain("v_title := v_from || ': ' || v_plan_name || ' plan';");
    expect(one).toContain(
      "then ' and ' || (array_length(v_services, 1) - 1) || ' more' else '' end;",
    );
    // Short enough for the opportunity's own form to save again.
    expect(one).toContain("left(v_title, 160), left(v_desc, 1900),");
  });
  it("only the site's own server may send one, as before", () => {
    expect(one).toContain(
      "revoke all on function public.public_request_submit(text, jsonb) from public, anon, authenticated; grant execute on function public.public_request_submit(text, jsonb) to service_role;",
    );
    expect(sql).not.toMatch(/grant [^;]* to anon/);
  });
  it("saying whose it is puts the customer and the property on the opportunity", () => {
    expect(one).toContain(
      "update public.crm_opportunities o set account_id = q.account_id, site_id = coalesce(q.site_id, o.site_id), updated_by_name = v_name where o.id = q.opportunity_id and o.deleted_at is null",
    );
  });
  it("the request follows its opportunity: deleted, restored, or a customer picked on the form", () => {
    expect(one).toContain(
      "create trigger crm_opportunities_request_follow after update of deleted_at, account_id, site_id on public.crm_opportunities",
    );
    expect(one).toContain(
      "set status = 'dismissed', dismiss_reason = 'Its opportunity was deleted', handled_at = now(), handled_by = auth.uid(), handled_by_name = new.updated_by_name where opportunity_id = new.id and status = 'new';",
    );
    expect(one).toContain(
      "where opportunity_id = new.id and status = 'dismissed' and dismiss_reason = 'Its opportunity was deleted';",
    );
    // A signed plan's request is never moved to another customer.
    expect(one).toContain("and roof_care_plan_id is null");
    expect(one).toContain(
      "revoke all on function public.crm_opportunities_request_follow() from public, anon, authenticated;",
    );
  });
});

describe("the notice and the Needs attention row open the opportunity", () => {
  it("the address", () => {
    expect(requestOpportunityPath(OPP)).toBe(`/opportunities?id=${OPP}`);
    expect(requestOpportunityPath(null)).toBe("/opportunities");
    expect(requestOpportunityPath(undefined)).toBe("/opportunities");
  });
  it("the notice says where it is and opens it", () => {
    const n = publicRequestNotice({ ...request(), opportunity_id: OPP } as never);
    expect(n.title).toBe("Roof Care request from the public page: Smith Widgets");
    expect(n.body).toBe(
      "Pat Smith in London, KY asked for Roof Guard. Reference R-4010. It is in Opportunities with nobody on it: open it to say whose it is.",
    );
    expect(n.url).toBe(`/opportunities?id=${OPP}`);
  });
  it("the admins and managers are told once, with the opportunity's address", async () => {
    const env = fakeSupabase({ public_requests: [request()], profiles: people });
    const out = await dispatchPublicRequestNotices(
      env.db as never,
      new Date("2026-11-23T15:01:00Z"),
    );
    expect(out).toMatchObject({ requests_checked: 1, requests_notified: 1, requests_errors: 0 });
    expect(told).toHaveLength(1);
    expect(told[0]![0]).toEqual(["a1"]);
    expect(told[0]![1].url).toBe(`/opportunities?id=${OPP}`);
    await dispatchPublicRequestNotices(env.db as never);
    expect(told).toHaveLength(1);
  });
  it("Needs attention opens the opportunity too", () => {
    const list = attentionList({
      today: "2026-11-25",
      now: "2026-11-25T15:00:00Z",
      limits: ATTENTION_DEFAULTS,
      tickets: [],
      untouched: [],
      opps: [],
      bids: [],
      invoices: [],
      followups: [],
      repairFrom: [],
      bidFrom: [],
      names: {},
      publicRequests: [
        {
          id: "r1",
          reference: "R-4010",
          from: "Smith Widgets",
          ask: "Roof Guard",
          kind: "care",
          sent_on: "2026-11-24",
          opportunity_id: OPP,
        },
      ],
    });
    const row = list.rows.find((r) => r.kind === "public_request")!;
    expect(row.href).toBe(`/opportunities?id=${OPP}`);
    expect(row.why).toContain("Open its opportunity, say whose it is, and call them.");
    expect(flat(read("src/lib/owner-attention.functions.ts"))).toContain(
      "several_buildings, shown_price, opportunity_id",
    );
  });
});

describe("the strip on the opportunity", () => {
  const care = { kind: "care", shown_price: 1740, plan: "guard", roof_care_plan_id: null } as const;
  it("its title says which page the request came from", () => {
    expect(requestStripTitle({ kind: "care", shown_price: 1740 })).toBe(
      "Sent from the Roof Care plans page",
    );
    expect(requestStripTitle({ kind: "care", shown_price: null })).toBe(
      "Sent from the Roof Care plans page: a custom quote",
    );
    expect(requestStripTitle({ kind: "service", shown_price: null })).toBe(
      "Sent from the Request service page",
    );
  });
  it("first, whose it is; then what the request needs next", () => {
    expect(requestStep(care, { account_id: null, site_id: null })).toBe("who");
    expect(requestStep(care, { account_id: ACC, site_id: SITE })).toBe("sign_up");
    // A customer picked on the form with no property yet: the sign-up needs the property.
    expect(requestStep(care, { account_id: ACC, site_id: null })).toBe("property");
    // No price was shown: nothing was signed, so no sign-up is ever offered.
    expect(requestStep({ ...care, shown_price: null }, { account_id: ACC, site_id: SITE })).toBe(
      "quote",
    );
    expect(
      requestStep({ ...care, roof_care_plan_id: PLAN }, { account_id: ACC, site_id: SITE }),
    ).toBe("signed");
    const service = { kind: "service", shown_price: null, plan: null, roof_care_plan_id: null };
    expect(requestStep(service as never, { account_id: null, site_id: null })).toBe("who");
    expect(requestStep(service as never, { account_id: ACC, site_id: SITE })).toBe("done");
  });
  it("the words say what to do, and that the plan starts with the payment", () => {
    expect(requestStepWords("who", { kind: "care" })).toBe(
      "Say whose this is. Nothing else on this opportunity is saved until it has a customer.",
    );
    expect(requestStepWords("sign_up", { kind: "care" })).toBe(
      "The customer picked a plan and ticked the terms on the page. Open the sign-up: it is filled in with what they picked, and the plan starts when the payment is received.",
    );
    expect(requestStepWords("quote", { kind: "care" })).toBe(
      "No price was shown on the page, so nothing was signed. Call them with a price.",
    );
    expect(requestStepWords("signed", { kind: "care" })).toBe(
      "The plan is signed. This opportunity was set to Won.",
    );
    expect(requestStepWords("done", { kind: "service" })).toBe(
      "The customer is on this opportunity. Call them, then start a ticket or a bid from here.",
    );
    expect(requestStepWords("property", { kind: "care" })).toBe(
      "Pick the property on this opportunity and save it. The sign-up opens from there.",
    );
  });
  it("the request is read from its opportunity, by Customers access only", async () => {
    const env = fakeSupabase(
      { profiles: people, public_requests: [request()] },
      { rpcs: { public_request_matches: () => [{ account_id: ACC, account_name: "Smith LLC" }] } },
    );
    const out = (await run(getOpportunityRequest, env.db, { opportunity_id: OPP })) as {
      request: { reference: string };
      matches: { account_id: string }[];
    };
    expect(out.request.reference).toBe("R-4010");
    expect(out.matches.map((m) => m.account_id)).toEqual([ACC]);
    // A technician assigned to the opportunity reads it, but not what the customer typed.
    expect(await run(getOpportunityRequest, env.db, { opportunity_id: OPP }, "u3")).toBeNull();
    expect(env.writes).toEqual([]);
  });
  it("once someone has said whose it is, no matches are looked for", async () => {
    const env = fakeSupabase(
      { profiles: people, public_requests: [request({ status: "matched", account_id: ACC })] },
      {
        rpcs: {
          public_request_matches: () => {
            throw new Error("not asked");
          },
        },
      },
    );
    const out = (await run(getOpportunityRequest, env.db, { opportunity_id: OPP })) as {
      matches: unknown[];
    };
    expect(out.matches).toEqual([]);
  });
  it("the page draws it on every opportunity, and a badge on the list while no customer is on it", () => {
    const page = flat(read("src/components/opportunities-page.tsx"));
    expect(page).toContain(
      "<OpportunityRequestStrip opp={{ id: opp.id, account_id: opp.account_id, site_id: opp.site_id }} readOnly={readOnly} onMatched={adoptCustomer} />",
    );
    expect(NO_CUSTOMER_YET).toBe("No customer yet");
    expect(page).toContain("{!o.account_id && isOpenOppStatus(status) && (");
    expect(page).toContain("{NO_CUSTOMER_YET}");
    // No bid and no ticket is started for an opportunity with no customer on it.
    expect(page).toContain(") : !opp.account_id ? null : (");
    expect(page).toContain(
      "{opp && !deleted && !!opp.account_id && dispatchesTickets(profile) && (",
    );
    // The customer the strip saved is shown in the form at once, and is not an unsaved change.
    expect(page).toContain("if (!dirty) setSavedKey(draftKey(next, !!opp));");
  });
  it("the site only offers a match: a person presses This is them or New customer", () => {
    const strip = flat(read("src/components/opportunity-request-strip.tsx"));
    expect(strip).toContain('const may = canAccess(profile, "customers");');
    expect(strip).toContain("enabled: !!session && may,");
    expect(strip).toContain("onClick={() => existing.mutate(m)}");
    expect(strip).toContain("This is {m.account_name}");
    expect(strip).toContain("onClick={() => fresh.mutate()}");
    expect(strip).toContain(
      'await handle({ data: { id: r.id, status: "matched", account_id: accountId, site_id: siteId } });',
    );
    // Nothing is matched by an effect or on load.
    expect(strip).not.toContain("useEffect");
    // A Roof Care request opens the normal sign-up, filled in from the request.
    expect(strip).toContain("search={{ [CARE_REQUEST_SEARCH]: r.id } as never}");
    expect(strip).toContain("Open the sign-up");
    // The office is told plainly that the page took no money.
    expect(strip).toContain("No payment was taken on");
  });
});

describe("a plan signed from a request sets its opportunity to Won", () => {
  const handled = (over: Record<string, unknown> = {}) =>
    request({
      status: "matched",
      account_id: ACC,
      site_id: SITE,
      roof_care_plan_id: PLAN,
      ...over,
    });
  const env = (opp: Record<string, unknown>, req = handled()) =>
    fakeSupabase(
      { profiles: people, crm_opportunities: [opportunity(opp)], crm_followups: [] },
      { rpcs: { public_request_handle: () => req } },
    );
  const ask = { id: REQ, status: "matched", site_id: SITE, plan_id: PLAN };
  it("an open one becomes Won, in the name of the person who signed the plan", async () => {
    const e = env({ account_id: ACC, site_id: SITE });
    const out = (await run(handlePublicRequest, e.db, ask)) as { opportunity_note?: string };
    expect(out.opportunity_note).toBeUndefined();
    const row = e.tables["crm_opportunities"]![0]!;
    expect(row["status"]).toBe("won");
    expect(row["updated_by_name"]).toBe("Olga Office");
    expect(e.rpcCalls.find((c) => c.fn === "public_request_handle")!.args).toMatchObject({
      p_id: REQ,
      p_status: "matched",
      p_site: SITE,
      p_plan: PLAN,
    });
  });
  it("one somebody already closed, or deleted, is left as it is", async () => {
    for (const over of [
      { status: "lost" },
      { status: "no_response" },
      { deleted_at: "2026-11-23T16:00:00Z" },
    ]) {
      const e = env({ account_id: ACC, site_id: SITE, ...over });
      await run(handlePublicRequest, e.db, ask);
      const row = e.tables["crm_opportunities"]![0]!;
      expect(row["status"], JSON.stringify(over)).toBe(over.status ?? "open");
      expect(e.writes.filter((w) => w.table === "crm_opportunities")).toEqual([]);
    }
  });
  it("saying whose it is, with no plan, does not close anything", async () => {
    const e = env({}, handled({ roof_care_plan_id: null }));
    await run(handlePublicRequest, e.db, { id: REQ, status: "matched", account_id: ACC });
    expect(e.tables["crm_opportunities"]![0]!["status"]).toBe("open");
  });
  it("the sign-up says so when the opportunity could not be set", () => {
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain("if (answered.opportunity_note)");
    expect(card).toContain(
      "Open the opportunity for request ${prefill.reference} and set it to Won.",
    );
    expect(card).not.toContain("Dismiss it on Opportunities, Public requests");
    expect(flat(read("src/lib/public-requests.functions.ts"))).toContain(
      "opportunity_note: `Its opportunity could not be set to Won: ${e instanceof Error ? e.message : String(e)}`,",
    );
  });
});
