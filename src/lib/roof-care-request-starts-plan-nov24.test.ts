/**
 * A Roof Care request from the public page starts its plan with no second sign-up (owner,
 * Nov 24, of the opportunity a request makes: "if you click open the sign up after confirming
 * or not confriming if theyre an exisitng customer it pops up the sign up window again, it
 * should just ask us to confirm the roof size, then send the payment link and once paid the opp
 * should flip to won").
 *
 * With it, from the same message: "once i paid for the plan on the card via the email that the
 * office sent i had to manually refresh the customer page with the property to get it applied",
 * and "on the nav bar can we move my tickets to below work overview".
 *
 * The tests of the server's answers fail on the code of that afternoon: there was no such
 * function. Names and amounts are made up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const drive = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/roof-care.functions", () => ({
  officeOrigin: async () => ({ line: "1 Office Rd, London, KY", state: "KY" }),
  driveTo: (...a: unknown[]) => drive(...a),
}));

import {
  CARE_OPEN_SIGN_UP,
  CARE_START_AT_MATCH,
  CARE_START_BUTTON,
  CARE_START_FIRST_VISIT,
  CARE_START_NO_SIZE,
  CARE_START_NOT_A_PLAN,
  CARE_START_OLD_TERMS,
  careStartsItself,
  requestStepWords,
  type CareSignUpPrefill,
} from "@/lib/public-requests";
import {
  PLAN_PAID_TOAST,
  PLAN_WAITING_RELOAD_MS,
  ROOF_CARE_TERMS_VERSION,
  anyPlanWaits,
  plansJustPaid,
} from "@/lib/roof-care-plan";
import {
  CARE_START_NO_PRICE,
  startPlanFromRequest,
  type StartedFromRequest,
} from "@/lib/roof-care-plan.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TECH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITE = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const PLAN = "33333333-3333-4333-8333-333333333333";
const REQUEST = "77777777-7777-4777-8777-777777777777";

const prefill = (over: Partial<CareSignUpPrefill> = {}): CareSignUpPrefill => ({
  request_id: REQUEST,
  reference: "R-4077",
  plan: "care",
  sqft: 26000,
  pay_method: "card",
  agreed_by: "Pat Smith",
  referred_by: "",
  customer_email: "pat@example.com",
  shown_price: 210,
  terms_version: ROOF_CARE_TERMS_VERSION,
  ...over,
});

describe("when a request can become its plan with no sign-up window", () => {
  it("a typed roof size and the terms in use: yes", () => {
    expect(careStartsItself(prefill(), ROOF_CARE_TERMS_VERSION)).toEqual({ ok: true });
  });
  it("no size typed, a picked size range, or older terms: no, and why", () => {
    expect(careStartsItself(prefill({ sqft: null }), ROOF_CARE_TERMS_VERSION)).toEqual({
      ok: false,
      why: CARE_START_NO_SIZE,
    });
    expect(
      careStartsItself(
        prefill({ sqft: null, picked_range: { size: "10,000 to 25,000 sq ft", low: 1, high: 2 } }),
        ROOF_CARE_TERMS_VERSION,
      ),
    ).toEqual({ ok: false, why: CARE_START_NO_SIZE });
    expect(
      careStartsItself(prefill({ terms_version: "2026-11-23.1" }), ROOF_CARE_TERMS_VERSION),
    ).toEqual({ ok: false, why: CARE_START_OLD_TERMS });
    expect(careStartsItself(null, ROOF_CARE_TERMS_VERSION)).toEqual({
      ok: false,
      why: CARE_START_NOT_A_PLAN,
    });
  });
  it("the first inspection is the usual one, and the box says what happens next", () => {
    expect(CARE_START_FIRST_VISIT).toBe("window");
    expect(requestStepWords("sign_up", { kind: "care" })).toBe(
      "The customer picked a plan and ticked the terms on the page. Start the plan: it is made from what they picked. Then confirm the roof size and send the payment link. It starts when the payment is received.",
    );
    expect(requestStepWords("signed", { kind: "care" })).toContain(
      "Work down the steps below. This opportunity turns Won the day the payment is received.",
    );
  });
});

const people = [
  { id: ADMIN, role: "admin", access: [], technician: false, full_name: "Ann Admin", email: "a@x" },
  {
    id: TECH,
    role: "user",
    access: ["service"],
    technician: true,
    full_name: "Tom Tech",
    email: "t@x",
  },
];
const request = (over: Record<string, unknown> = {}) => ({
  id: REQUEST,
  reference: "R-4077",
  kind: "care",
  created_at: "2026-11-24T14:00:00Z",
  status: "matched",
  contact_name: "Pat Smith",
  company: "",
  phone: "6065550142",
  email: "pat@example.com",
  address: "100 Main St",
  city: "London",
  state: "KY",
  zip: "40741",
  building_name: "",
  referred_by: "",
  plan: "care",
  sqft: 26000,
  size_range: null,
  sqft_source: "typed",
  shown_price: 205,
  quote: null,
  pay_method: "card",
  terms_version: ROOF_CARE_TERMS_VERSION,
  agreed_by: "Pat Smith",
  several_buildings: false,
  notes: "",
  services: [],
  details: "",
  handled_at: null,
  handled_by_name: null,
  dismiss_reason: null,
  account_id: ACCOUNT,
  site_id: SITE,
  opportunity_id: null,
  roof_care_plan_id: null,
  ...over,
});
const priced = {
  ready: true,
  custom_quote: false,
  beyond_baseline: false,
  baseline_hours: 1,
  baseline_miles: 50,
  plans: [
    { plan: "watch", list: 100, travel: 10, price: 110, visit1: 55, visit2: 55, trips: 2 },
    { plan: "care", list: 200, travel: 10, price: 210, visit1: 105, visit2: 105, trips: 2 },
    { plan: "guard", list: 300, travel: 21, price: 321, visit1: 161, visit2: 160, trips: 4 },
  ],
};
type Rpcs = Record<string, (a: Record<string, unknown>) => unknown>;
const world = (req = request(), rpcs: Rpcs = {}) =>
  fakeSupabase(
    {
      profiles: people,
      crm_sites: [
        {
          id: SITE,
          account_id: ACCOUNT,
          name: "Plant 2",
          address1: "100 Main St",
          address2: null,
          city: "London",
          state: "KY",
          zip: "40741",
          lat: null,
          lng: null,
          map_roof_sqft: null,
          deleted_at: null,
        },
      ],
      public_requests: [req],
      // The plan the made-up database "saves", so it can be read back.
      roof_care_plans: [
        {
          id: PLAN,
          account_id: ACCOUNT,
          site_id: SITE,
          plan: "care",
          status: "awaiting_payment",
          pay_first: true,
          plan_number: 1077,
          first_visit: "window",
          signed_on: "2026-11-24",
          renews_on: "2027-11-24",
          roof_sqft: 26000,
          price: 210,
          agreed_by: "Pat Smith",
          pay_method: "card",
          size_unchecked: true,
          renewal_credit: 0,
          repair_allowance: 0,
          free_travel_calls: 0,
        },
      ],
      roof_care_visits: [],
      roof_care_no_access: [],
      roof_care_card_payments: [],
      invoices: [],
      invoice_lines: [],
      service_jobs: [],
    },
    {
      rpcs: {
        roof_care_price: () => priced,
        roof_care_sign_up_await_payment: () => PLAN,
        roof_care_set_email: () => null,
        public_request_handle: () => req,
        // The "signed, not paid" notice has nothing to tell in this made-up world.
        roof_care_pay_notice_claim: () => [],
        ...rpcs,
      },
    },
  );
type Env = ReturnType<typeof world>;
const call = <T>(env: Env, data: unknown, userId = ADMIN) =>
  (startPlanFromRequest as unknown as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const ASK = { request_id: REQUEST, site_id: SITE };

beforeEach(() => {
  drive.mockReset();
  drive.mockResolvedValue({
    hours: 1,
    miles: 50,
    source: "routed",
    note: "25 mi each way",
    placed_by: "building",
    place: null,
  });
});

describe("starting the plan from the request", () => {
  it("signs the plan with what the customer picked, at today's price, and nothing is asked again", async () => {
    const signed: Record<string, unknown>[] = [];
    const env = world(request(), {
      roof_care_sign_up_await_payment: (a) => {
        signed.push(a);
        return PLAN;
      },
    });
    const out = await call<StartedFromRequest>(env, ASK);
    expect(signed).toHaveLength(1);
    expect(signed[0]).toMatchObject({
      p_site: SITE,
      p_plan: "care",
      p_sqft: 26000,
      p_first: "window",
      p_pay_method: "card",
      p_agreed_by: "Pat Smith",
      p_terms: ROOF_CARE_TERMS_VERSION,
      // Today's price for that size, not the one the page showed that day.
      p_shown_price: 210,
      p_notes: "From the public Roof Care page, request R-4077.",
    });
    expect(out.plan.id).toBe(PLAN);
    expect(out.tied).toBe(true);
  });
  it("gives the plan the customer's email, and ties the request to the plan so the opportunity turns Won when it is paid", async () => {
    const env = world();
    await call<StartedFromRequest>(env, ASK);
    const fns = env.rpcCalls.map((c) => c.fn);
    expect(fns).toContain("roof_care_set_email");
    const email = env.rpcCalls.find((c) => c.fn === "roof_care_set_email")!;
    expect(email.args).toEqual({ p_plan: PLAN, p_email: "pat@example.com" });
    const tie = env.rpcCalls.find((c) => c.fn === "public_request_handle")!;
    expect(tie.args).toEqual({ p_id: REQUEST, p_status: "matched", p_site: SITE, p_plan: PLAN });
  });
  it("the plan stands when the request could not be tied to it, and the answer says so", async () => {
    const env = world(request(), {
      public_request_handle: () => {
        throw new Error("the request is locked");
      },
    });
    const out = await call<StartedFromRequest>(env, ASK);
    expect(out.plan.id).toBe(PLAN);
    expect(out.tied).toBe(false);
  });
  it("is refused in plain words, with nothing signed, when it cannot start by itself", async () => {
    for (const [req, why] of [
      [
        request({ sqft: null, sqft_source: "range", size_range: "10000-25000" }),
        CARE_START_NO_SIZE,
      ],
      [request({ terms_version: "2026-11-23.1" }), CARE_START_OLD_TERMS],
      [request({ kind: "service", plan: null }), CARE_START_NOT_A_PLAN],
      [request({ status: "dismissed" }), CARE_START_NOT_A_PLAN],
    ] as const) {
      const env = world(req);
      await expect(call(env, ASK)).rejects.toThrow(why);
      expect(env.rpcCalls.map((c) => c.fn)).not.toContain("roof_care_sign_up_await_payment");
    }
  });
  it("is refused when the office's prices have no plain price for that roof", async () => {
    const env = world(request(), {
      roof_care_price: () => ({ ready: true, custom_quote: true, plans: [] }),
    });
    await expect(call(env, ASK)).rejects.toThrow(CARE_START_NO_PRICE);
    expect(env.rpcCalls.map((c) => c.fn)).not.toContain("roof_care_sign_up_await_payment");
  });
  it("is the office's: a technician is refused", async () => {
    const env = world();
    await expect(call(env, ASK, TECH)).rejects.toThrow();
    expect(env.rpcCalls.map((c) => c.fn)).not.toContain("roof_care_sign_up_await_payment");
  });
  it("runs the same sign-up as the window does: one function for both", () => {
    const f = flat(read("src/lib/roof-care-plan.functions.ts"));
    expect(f).toContain(
      ".handler(({ data, context }): Promise<RoofCarePlan> => signUpPlan(context, data));",
    );
    expect(f).toContain("const plan = await signUpPlan(context, {");
  });
});

describe("the request box on the opportunity", () => {
  const strip = flat(read("src/components/opportunity-request-strip.tsx"));
  it("has one button that starts the plan, and still offers the window", () => {
    expect(CARE_START_BUTTON).toBe("Start the plan");
    expect(CARE_OPEN_SIGN_UP).toBe("Open the sign-up");
    expect(strip).toContain('data-action="request-start-plan"');
    expect(strip).toContain("onClick={() => start.mutate(opp.site_id!)}");
    expect(strip).toContain('data-action="request-open-sign-up"');
  });
  it("starts the plan by itself once the office has said whose it is, and says so first", () => {
    expect(strip).toContain("if (c.site_id && auto.ok) start.mutate(c.site_id);");
    expect(strip).toContain('{step === "who" && !readOnly && auto.ok && (');
    expect(strip).toContain("{CARE_START_AT_MATCH}");
    expect(CARE_START_AT_MATCH).toBe(
      "The plan they picked is started as soon as you say whose this is, and their agreement is emailed to them.",
    );
  });
  it("then shows the plan's own steps there: the roof size, the payment link", () => {
    expect(strip).toContain(
      '{step === "signed" && opp.site_id && ( <RoofCareCard siteId={opp.site_id} brief className="bg-background" /> )}',
    );
  });
  it("says why when a plan cannot start by itself, beside the button that opens the window", () => {
    expect(strip).toContain("data-request-start-why");
    expect(strip).toContain("setStartWhy(errText(e));");
  });
});

describe("the page finds the payment by itself", () => {
  it("only a plan that waits for its payment is read again, every ten seconds", () => {
    expect(PLAN_WAITING_RELOAD_MS).toBe(10_000);
    expect(anyPlanWaits([{ status: "active" }, { status: "ended" }])).toBe(false);
    expect(anyPlanWaits([{ status: "active" }, { status: "awaiting_payment" }])).toBe(true);
    expect(anyPlanWaits(null)).toBe(false);
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain(
      "refetchInterval: (query) => (anyPlanWaits(query.state.data) ? PLAN_WAITING_RELOAD_MS : false),",
    );
  });
  it("a plan that was waiting and is now in force was just paid: said once, and the page is read again", () => {
    const waiting = [{ id: "p1", status: "awaiting_payment" as const }];
    const active = (id: string) => [{ id, status: "active" as const }];
    expect(plansJustPaid(waiting, active("p1"))).toEqual(["p1"]);
    // First read of a paid plan, a plan still waiting, and one that was ended: nothing.
    expect(plansJustPaid(null, active("p1"))).toEqual([]);
    expect(plansJustPaid(waiting, waiting)).toEqual([]);
    expect(plansJustPaid(waiting, [{ id: "p1", status: "ended" as const }])).toEqual([]);
    expect(plansJustPaid(waiting, active("p2"))).toEqual([]);
    expect(PLAN_PAID_TOAST).toBe("The payment is in. The plan has started.");
    const card = flat(read("src/components/roof-care/plan-card.tsx"));
    expect(card).toContain("const paid = plansJustPaid(seen.current, now);");
    expect(card).toContain("void qc.invalidateQueries();");
  });
});

describe("the menu", () => {
  const nav = flat(read("src/components/app-sidebar.tsx"));
  it("My tickets sits right under Work Overview, above the groups", () => {
    const overview = nav.indexOf("<span>Work Overview</span>");
    const mine = nav.indexOf("{renderItems([myTicketsItem])}");
    const groups = nav.indexOf('id="customers"');
    expect(overview).toBeGreaterThan(0);
    expect(mine).toBeGreaterThan(overview);
    expect(groups).toBeGreaterThan(mine);
  });
  it("it is not listed a second time under Customers, and an empty heading is not drawn", () => {
    const list = nav.slice(nav.indexOf("const customerItems: ServiceItem[] = ["));
    expect(list.slice(0, list.indexOf("];"))).not.toContain('"My tickets"');
    expect(nav).toContain("{profile && customerRows.length > 0 && (");
  });
  it("it is still for the Technician tick only", () => {
    expect(nav).toContain(
      'const myTicketsItem: ServiceItem = { title: "My tickets", url: "/service/today", icon: CalendarCheck, page: "service", techOnly: true, };',
    );
  });
});
