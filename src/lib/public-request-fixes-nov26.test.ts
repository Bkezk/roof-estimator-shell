/**
 * A public Roof Care request that starts its plan: the fixes from the audit of Nov 25, 2026
 * (owner, Nov 26: "go on ... 15, 17 (just ensure its not too strict to match at all), 18 ...
 * 28").
 *
 *  15. Two people answering the same request made two customers, two plans and two agreements.
 *      Now there is one answer: the request is taken in the database before anything is made,
 *      a second answer is refused, and a plan is signed and tied to its request in one step.
 *  17. A property whose address was only alike got the plan on one press. The list of possible
 *      matches is as generous as it was; the plan starts by itself only at the same building.
 *  18. A size a stranger typed was born "checked" however much larger than the map's. From a
 *      request it is checked only when a map agrees within 20% either way.
 *  28. A plan that was ended still read "signed and waits for its payment"; a plan that could
 *      not be read back was said to be "not started"; and a request the database turned down
 *      for a reason the visitor can fix used up one of their five an hour.
 *
 * Every test here fails on the code of Nov 25. Names, addresses and amounts are made up.
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

import { sendCare, sendService, type PublicDeps } from "@/lib/public-forms.functions";
import {
  CARE_ADDRESS_DIFFERS,
  CARE_SIGNED_NOT_READ,
  CARE_START_HERE_BUTTON,
  CARE_START_OTHER_ADDRESS,
  REQUEST_ALREADY_ANSWERED,
  REQUEST_HAS_PLAN,
  REQUEST_OTHER_PROPERTY,
  REQUEST_SAY_WHO_FIRST,
  requestStep,
  requestStepWords,
  sameBuilding,
  streetKey,
} from "@/lib/public-requests";
import {
  claimPublicRequest,
  getOpportunityRequest,
  handlePublicRequest,
  type OpportunityRequest,
} from "@/lib/public-requests.functions";
import { ROOF_CARE_TERMS_VERSION, planSizeWords } from "@/lib/roof-care-plan";
import {
  signUpRoofCare,
  startPlanFromRequest,
  type StartedFromRequest,
} from "@/lib/roof-care-plan.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const SQL = flat(read("supabase/migrations/20261125300000_public_request_fixes.sql"));
const STRIP = flat(read("src/components/opportunity-request-strip.tsx"));

/** One function of the migration, from its first line to the next function's. */
function fnBody(name: string): string {
  const from = SQL.indexOf(`create or replace function public.${name}(`);
  expect(from, name).toBeGreaterThan(-1);
  const next = SQL.indexOf("create or replace function public.", from + 10);
  return SQL.slice(from, next === -1 ? undefined : next);
}

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TECH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITE = "11111111-1111-4111-8111-111111111111";
const SITE2 = "11111111-1111-4111-8111-222222222222";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const ACCOUNT2 = "22222222-2222-4222-8222-333333333333";
const PLAN = "33333333-3333-4333-8333-333333333333";
const OTHER_PLAN = "33333333-3333-4333-8333-444444444444";
const REQUEST = "77777777-7777-4777-8777-777777777777";
const OPP = "88888888-8888-4888-8888-888888888888";

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
  created_at: "2026-11-25T14:00:00Z",
  status: "matched",
  contact_name: "Pat Smith",
  company: "",
  phone: "6065550142",
  email: "pat@example.com",
  address: "200 S Main St",
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
  opportunity_id: OPP,
  roof_care_plan_id: null,
  ...over,
});
const site = (over: Record<string, unknown> = {}) => ({
  id: SITE,
  account_id: ACCOUNT,
  name: "Plant 2",
  address1: "200 South Main Street",
  address2: null,
  city: "London",
  state: "KY",
  zip: "40741",
  lat: null,
  lng: null,
  map_roof_sqft: null,
  deleted_at: null,
  ...over,
});
const planRow = (over: Record<string, unknown> = {}) => ({
  id: PLAN,
  account_id: ACCOUNT,
  site_id: SITE,
  plan: "care",
  status: "awaiting_payment",
  pay_first: true,
  plan_number: 1077,
  first_visit: "window",
  signed_on: "2026-11-25",
  renews_on: "2027-11-25",
  roof_sqft: 26000,
  price: 210,
  agreed_by: "Pat Smith",
  pay_method: "card",
  size_unchecked: true,
  renewal_credit: 0,
  repair_allowance: 0,
  free_travel_calls: 0,
  notes: "",
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
/**
 * A made-up database. `plans`: the plans already there. The sign-up "saves" PLAN, which is
 * added to the table so it can be read back, unless `keep` is false.
 */
const world = (
  o: {
    req?: ReturnType<typeof request>;
    sites?: ReturnType<typeof site>[];
    plans?: ReturnType<typeof planRow>[];
    rpcs?: Rpcs;
    keep?: boolean;
  } = {},
) => {
  const plans: Record<string, unknown>[] = [...(o.plans ?? [])];
  return fakeSupabase(
    {
      profiles: people,
      crm_sites: o.sites ?? [site()],
      public_requests: [o.req ?? request()],
      roof_care_plans: plans,
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
        roof_care_sign_up_from_request: (a) => {
          if (o.keep !== false) plans.push(planRow({ site_id: a["p_site"] }));
          return PLAN;
        },
        roof_care_sign_up_await_payment: () => PLAN,
        roof_care_set_email: () => null,
        public_request_handle: () => o.req ?? request(),
        roof_care_pay_notice_claim: () => [],
        ...o.rpcs,
      },
    },
  );
};
type Env = ReturnType<typeof world>;
const start = (env: Env, data: unknown, userId = ADMIN) =>
  (
    startPlanFromRequest as unknown as (a: {
      data: unknown;
      context: unknown;
    }) => Promise<StartedFromRequest>
  )({ data, context: { supabase: env.db, userId } });
const run = <T>(fn: unknown, env: Env, data: unknown, userId = ADMIN) =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const ASK = { request_id: REQUEST, site_id: SITE };
const SIGN_UPS = ["roof_care_sign_up_await_payment", "roof_care_sign_up_from_request"];
const signUps = (env: Env) => env.rpcCalls.filter((c) => SIGN_UPS.includes(c.fn));

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

// ── 15. One answer ──────────────────────────────────────────────────────────────────────────

describe("15. a request is answered once", () => {
  it("a request that already has a plan waiting or in force starts no second plan", async () => {
    for (const status of ["awaiting_payment", "active"]) {
      const env = world({
        req: request({ roof_care_plan_id: OTHER_PLAN }),
        plans: [planRow({ id: OTHER_PLAN, status })],
      });
      await expect(start(env, ASK), status).rejects.toThrow(REQUEST_HAS_PLAN);
      expect(signUps(env), status).toEqual([]);
    }
    expect(REQUEST_HAS_PLAN).toBe("This request already has its plan. Reload the page to see it.");
  });
  it("a request whose plan was ended can be signed up again", async () => {
    const env = world({
      req: request({ roof_care_plan_id: OTHER_PLAN }),
      plans: [planRow({ id: OTHER_PLAN, status: "ended" })],
    });
    const out = await start(env, ASK);
    expect(out.plan?.id).toBe(PLAN);
    expect(signUps(env)).toHaveLength(1);
  });
  it("a plan is not started at another property than the one the request is on", async () => {
    // Somebody else said whose it is while this page sat open: their property, not this one.
    const env = world({
      req: request({ account_id: ACCOUNT2, site_id: SITE2 }),
      sites: [site(), site({ id: SITE2, account_id: ACCOUNT2 })],
    });
    await expect(start(env, ASK)).rejects.toThrow(REQUEST_OTHER_PROPERTY);
    expect(signUps(env)).toEqual([]);
    expect(REQUEST_OTHER_PROPERTY).toBe(
      "This request is not on this property. Reload the page to see whose it is.",
    );
  });
  it("nobody said whose it is yet: no plan", async () => {
    const env = world({ req: request({ status: "new", account_id: null, site_id: null }) });
    await expect(start(env, ASK)).rejects.toThrow(REQUEST_SAY_WHO_FIRST);
    expect(signUps(env)).toEqual([]);
  });
  it("the plan is signed and tied to its request in one step of the database", async () => {
    const env = world();
    const out = await start(env, ASK);
    expect(out).toMatchObject({ tied: true });
    expect(out.plan?.id).toBe(PLAN);
    const signed = signUps(env);
    expect(signed.map((c) => c.fn)).toEqual(["roof_care_sign_up_from_request"]);
    expect(signed[0]!.args).toMatchObject({ p_request: REQUEST, p_site: SITE, p_sqft: 26000 });
    // A manager's "the typed size is right" tick is never sent for a stranger's size.
    expect(signed[0]!.args).not.toHaveProperty("p_size_ok");
    // No second call that could fail and leave a plan the request does not know of.
    expect(env.rpcCalls.map((c) => c.fn)).not.toContain("public_request_handle");
  });
  it("the same person pressing again after a failure half way ties the plan, and signs nothing twice", async () => {
    const handled: Record<string, unknown>[] = [];
    const env = world({
      plans: [planRow({ notes: "From the public Roof Care page, request R-4077." })],
      rpcs: {
        public_request_handle: (a) => {
          handled.push(a);
          return request({ roof_care_plan_id: PLAN });
        },
      },
    });
    const out = await start(env, ASK);
    expect(out).toMatchObject({ tied: true });
    expect(out.plan?.id).toBe(PLAN);
    expect(signUps(env)).toEqual([]);
    expect(handled).toEqual([{ p_id: REQUEST, p_status: "matched", p_site: SITE, p_plan: PLAN }]);
    // Another request's plan at the same property is not taken for this one's.
    const other = world({
      plans: [planRow({ notes: "From the public Roof Care page, request R-407." })],
    });
    await start(other, ASK);
    expect(signUps(other)).toHaveLength(1);
  });

  it("the page takes the request in the database before it makes anything", async () => {
    const env = world({
      req: request({ status: "new", account_id: null, site_id: null }),
      rpcs: { public_request_claim: () => request() },
    });
    expect(await run(claimPublicRequest, env, { id: REQUEST })).toEqual({ ok: true });
    expect(env.rpcCalls).toEqual([{ fn: "public_request_claim", args: { p_id: REQUEST } }]);
    expect(env.writes).toEqual([]);
  });
  it("the one who loses is told in the database's own words, and a technician is not asked at all", async () => {
    const env = world({
      rpcs: {
        public_request_claim: () => {
          throw new Error(REQUEST_ALREADY_ANSWERED);
        },
      },
    });
    await expect(run(claimPublicRequest, env, { id: REQUEST })).rejects.toThrow(
      "Someone already said whose this request is. Reload the page to see it.",
    );
    const tech = world();
    await expect(run(claimPublicRequest, tech, { id: REQUEST }, TECH)).rejects.toThrow();
    expect(tech.rpcCalls).toEqual([]);
  });
  it("the box on the opportunity takes the request first, then makes the customer", () => {
    const fresh = STRIP.slice(STRIP.indexOf("const fresh = useMutation({"));
    const take = fresh.indexOf("await takeIt();");
    const make = fresh.indexOf("await newAccount({");
    expect(take).toBeGreaterThan(-1);
    expect(make).toBeGreaterThan(take);
    const existing = STRIP.slice(
      STRIP.indexOf("const existing = useMutation({"),
      STRIP.indexOf("const fresh = useMutation({"),
    );
    expect(existing.indexOf("await takeIt();")).toBeGreaterThan(-1);
    expect(existing.indexOf("return finish(")).toBeGreaterThan(existing.indexOf("await takeIt();"));
    expect(STRIP).toContain("await claim({ data: { id: r.id } });");
    // A customer made and not yet put on the request is used again, not made again.
    expect(STRIP).toContain(
      "const kept = madeHere.current?.request === r.id ? madeHere.current.hit : null;",
    );
    // After a refusal the request is read again, so the box shows who has it.
    expect(STRIP).toContain(
      "const fail = (e: unknown) => { // Somebody else may have answered it: the request is read again, so the box shows it. void qc.invalidateQueries({ queryKey: opportunityRequestKey(opp.id) });",
    );
  });

  describe("in the database", () => {
    it("taking a request refuses one already answered, and one another person holds", () => {
      const f = fnBody("public_request_claim");
      expect(f).toContain(
        "select * into q from public.public_requests where id = p_id for update;",
      );
      expect(f).toContain(
        "if (q.status = 'matched' or q.account_id is not null or q.roof_care_plan_id is not null) and not v_open_again then raise exception 'Someone already said whose this request is. Reload the page to see it.'",
      );
      // A wrong pick put right: the customer was taken off the request's opportunity again,
      // and no plan was made. Only then is an answered request open to a new answer.
      expect(f).toContain(
        "v_open_again := q.roof_care_plan_id is null and exists ( select 1 from public.crm_opportunities o where o.id = q.opportunity_id and o.deleted_at is null and o.account_id is null);",
      );
      expect(f).toContain(
        "if q.claimed_by is not null and q.claimed_by <> auth.uid() and q.claimed_at is not null and q.claimed_at > now() - interval '2 minutes' then raise exception '% is answering this request right now. Wait a minute, then reload the page.',",
      );
      expect(f).toContain("if auth.uid() is null or not public.has_access('customers') then");
      expect(SQL).toContain(
        "revoke all on function public.public_request_claim(uuid) from public, anon; grant execute on function public.public_request_claim(uuid) to authenticated;",
      );
      expect(SQL).toContain(
        "alter table public.public_requests add column if not exists claimed_by uuid;",
      );
    });
    it("a second answer that names another customer or property is refused, the same answer is taken", () => {
      const f = fnBody("public_request_handle");
      expect(f).toContain(
        "if (q.status = 'matched' or q.roof_care_plan_id is not null) and not v_open_again and ((p_account is not null and q.account_id is not null and p_account <> q.account_id) or (p_site is not null and q.site_id is not null and p_site <> q.site_id)) then raise exception 'Someone already said whose this request is. Reload the page to see it.'",
      );
      // An answer given while another person holds the request.
      expect(f).toContain(
        "if (q.status = 'new' or v_open_again) and q.claimed_by is not null and q.claimed_by <> auth.uid() and q.claimed_at is not null and q.claimed_at > now() - interval '2 minutes' then",
      );
      // The request's live plan is not swapped for another.
      expect(f).toContain(
        "if p_plan is not null and q.roof_care_plan_id is not null and q.roof_care_plan_id <> p_plan and exists (select 1 from public.roof_care_plans pl where pl.id = q.roof_care_plan_id and pl.status in ('awaiting_payment', 'active')) then raise exception 'This request already has its plan. Reload the page to see it.'",
      );
      // Everything it did before is still there.
      expect(f).toContain("perform public.roof_care_plan_wins_opportunity(q.roof_care_plan_id);");
      expect(f).toContain("raise exception 'That Roof Care plan is not this customer''s'");
      expect(SQL).toContain(
        "revoke all on function public.public_request_handle(uuid, text, uuid, uuid, uuid, uuid, text) from public, anon; grant execute on function public.public_request_handle(uuid, text, uuid, uuid, uuid, uuid, text) to authenticated;",
      );
    });
    it("the plan is signed with the request held, and the request points at it in the same step", () => {
      const f = fnBody("roof_care_sign_up_from_request");
      const hold = f.indexOf(
        "select * into q from public.public_requests where id = p_request for update;",
      );
      const has = f.indexOf(
        "raise exception 'This request already has its plan. Reload the page to see it.'",
      );
      const sign = f.indexOf("v_plan := public.roof_care_sign_up_await_payment(");
      const tie = f.indexOf("set roof_care_plan_id = v_plan,");
      expect(hold).toBeGreaterThan(-1);
      expect(has).toBeGreaterThan(hold);
      expect(sign).toBeGreaterThan(has);
      expect(tie).toBeGreaterThan(sign);
      expect(f).toContain("if not public.has_access('customers') then");
      expect(f).toContain(
        "if q.site_id is distinct from p_site or v_site_account is distinct from q.account_id then raise exception 'This request is not on this property. Reload the page to see whose it is.'",
      );
      expect(f).toContain(
        "raise exception 'Say whose this request is first. The plan is started after that.'",
      );
      // The sentences the page knows are the database's own.
      for (const said of [REQUEST_HAS_PLAN, REQUEST_OTHER_PROPERTY, REQUEST_SAY_WHO_FIRST])
        expect(f, said).toContain(`raise exception '${said}'`);
      expect(fnBody("public_request_handle")).toContain(
        `raise exception '${REQUEST_ALREADY_ANSWERED}'`,
      );
      expect(SQL).toContain(
        "text, numeric) from public, anon; grant execute on function public.roof_care_sign_up_from_request(",
      );
    });
  });
});

// ── 17. The same building ───────────────────────────────────────────────────────────────────

describe("17. the plan starts by itself only at the building they typed", () => {
  const same = (a: string, b: string, za = "40741", zb = "40741") =>
    sameBuilding({ street: a, zip: za }, { street: b, zip: zb });

  it("the audit's three: alike is not the same", () => {
    expect(same("120 N Maple", "120 Nelson Rd")).toBe(false);
    expect(same("120 N Maple", "120 North St")).toBe(false);
    expect(same("200 S Main St", "200 Sycamore St")).toBe(false);
  });
  it("honest ways of writing one address are the same building", () => {
    const pairs: [string, string][] = [
      ["120 N Maple St", "120 North Maple Street"],
      ["120 n. maple st.", "120 N MAPLE ST"],
      ["  120   N   Maple   St  ", "120 N Maple St"],
      ["200 S Main St", "200 South Main Street"],
      ["200 S Main St", "200 S. Main St."],
      ["200 S Main", "200 S Main St"],
      ["200 South Main", "200 S. Main Street"],
      ["200 S Main St Suite 4", "200 S Main St"],
      ["200 S Main St, Ste. 400", "200 South Main Street"],
      ["200 S Main St #4", "200 S Main St"],
      ["200 S Main St Unit B", "200 S Main Street"],
      ["200 S Main St Apt 4C", "200 S Main St"],
      ["200 S Main St, Bldg 2, Suite A-1", "200 S Main St"],
      ["200 S Main St Building C", "200 S Main St"],
      ["200 S Main St 2nd Floor", "200 S Main St"],
      ["45 Industrial Pkwy", "45 Industrial Parkway"],
      ["45 Industrial Blvd", "45 Industrial Boulevard"],
      ["9 Quarry Rd", "9 Quarry Road"],
      ["9 Quarry Ave", "9 Quarry Avenue"],
      ["9 Quarry Dr", "9 Quarry Drive"],
      ["9 Quarry Ln", "9 Quarry Lane"],
      ["9 Quarry Ct", "9 Quarry Court"],
      ["9 Quarry Pl", "9 Quarry Place"],
      ["9 Quarry Cir", "9 Quarry Circle"],
      ["9 Quarry Trl", "9 Quarry Trail"],
      ["9 Quarry Ter", "9 Quarry Terrace"],
      ["310 1st Ave", "310 First Avenue"],
      ["1201 W 5th St", "1201 West Fifth Street"],
      ["77 NE Depot St", "77 Northeast Depot Street"],
      ["12 E Dixie Hwy", "12 East Dixie Highway"],
      ["1500 US Hwy 25 E", "1500 U.S. Highway 25E"],
      ["1500 US 25 E", "1500 U S Hwy 25 East"],
      ["640 KY 80", "640 KY Route 80"],
      ["640 KY-80", "640 Ky Hwy 80"],
      ["88 O'Neil Ct", "88 ONeil Court"],
      ["77 Martin Luther King Jr Blvd", "77 Martin Luther King Jr. Boulevard"],
      ["120-B Mill St", "120B Mill Street"],
      ["500 Office Park Dr", "500 Office Park Drive"],
      ["14 St Charles Ave", "14 Saint Charles Avenue"],
      ["30 Mt Zion Rd", "30 Mount Zion Road"],
      ["30 Ft Sumter Way", "30 Fort Sumter Way"],
    ];
    for (const [a, b] of pairs) {
      expect(same(a, b), `${a} = ${b}`).toBe(true);
      expect(same(b, a), `${b} = ${a}`).toBe(true);
    }
  });
  it("another number, another side of town, another kind of street, another street: not the same", () => {
    const pairs: [string, string][] = [
      ["120 Main St", "122 Main St"],
      ["120 Main St", "1200 Main St"],
      ["120 N Main St", "120 S Main St"],
      ["120 Main St", "120 N Main St"],
      ["120 Main St", "120 Main Ave"],
      ["120 Main St", "120 Maine St"],
      ["120 Maple St", "120 Maple Ridge Rd"],
      ["120 Maple", "120 Maple Ridge"],
      ["500 Office Park Dr", "500 Park Dr"],
      ["1500 US 25 E", "1500 US 25 W"],
      ["640 KY 80", "640 KY 192"],
      ["", ""],
      ["120 Main St", ""],
    ];
    for (const [a, b] of pairs) expect(same(a, b), `${a} / ${b}`).toBe(false);
  });
  it("the zip decides when both have one; a missing zip or city never blocks", () => {
    expect(same("120 Main St", "120 Main Street", "40741", "40741-1234")).toBe(true);
    expect(same("120 Main St", "120 Main Street", "40741", "40701")).toBe(false);
    expect(same("120 Main St", "120 Main Street", "40741", "")).toBe(true);
    expect(same("120 Main St", "120 Main Street", "", "")).toBe(true);
    // With a zip missing, two different towns are two buildings.
    const a = { street: "120 Main St", city: "London", zip: "" };
    expect(sameBuilding(a, { street: "120 Main St", city: "Corbin", zip: "40701" })).toBe(false);
    expect(sameBuilding(a, { street: "120 Main St", city: "LONDON ", zip: "40741" })).toBe(true);
    expect(sameBuilding(a, { street: "120 Main St", city: null, zip: null })).toBe(true);
    // With both zips the same, how the town is written does not matter.
    expect(
      sameBuilding(
        { street: "120 Main St", city: "Ft Wright", zip: "41011" },
        { street: "120 Main St", city: "Fort Wright", zip: "41011" },
      ),
    ).toBe(true);
  });
  it("what a street line is read as", () => {
    expect(streetKey("120 N. Maple Street, Suite 4")).toBe("120 n maple st");
    expect(streetKey("1500 U.S. Highway 25E")).toBe("1500 us 25 e");
    expect(streetKey("500 Office Park Dr")).toBe("500 office park dr");
    expect(streetKey(null)).toBe("");
    // A line with no plain letter or digit is compared as typed: a property made from the
    // request's own address is always the same building.
    expect(sameBuilding({ street: "Улица Мира" }, { street: " улица  мира " })).toBe(true);
    expect(sameBuilding({ street: "Улица Мира" }, { street: "Улица Ленина" })).toBe(false);
  });

  it("the plan is not started at an address that is only alike, until a person says so", async () => {
    const alike = [site({ address1: "200 Sycamore St" })];
    const env = world({ sites: alike });
    await expect(start(env, ASK)).rejects.toThrow(CARE_START_OTHER_ADDRESS);
    expect(signUps(env)).toEqual([]);
    expect(CARE_START_OTHER_ADDRESS).toBe(
      "The property's address is not the one they typed. Check both addresses, then press Start the plan at this property.",
    );
    // One more press, on purpose.
    const pressed = world({ sites: alike });
    const out = await start(pressed, { ...ASK, address_ok: true });
    expect(out.plan?.id).toBe(PLAN);
    expect(signUps(pressed)).toHaveLength(1);
  });
  it("an honest match still starts by itself", async () => {
    for (const address1 of ["200 South Main Street", "200 S. MAIN ST, SUITE 4", "200 S Main"]) {
      const env = world({ sites: [site({ address1 })] });
      expect((await start(env, ASK)).plan?.id, address1).toBe(PLAN);
    }
  });

  it("the list of possible matches is as generous as before, and says which property is the same building", async () => {
    const matches = () => [
      // The database offered the customer's first alike property: Nelson Rd.
      {
        account_id: ACCOUNT,
        account_name: "Acme Mills",
        why: ["address"],
        site_id: "s-nelson",
        site_name: "Warehouse",
        site_address: "120 Nelson Rd, London",
      },
      {
        account_id: ACCOUNT2,
        account_name: "Baker Tool",
        why: ["address"],
        site_id: "s-north",
        site_name: "Shop",
        site_address: "120 North St, London",
      },
      { account_id: "acc-phone", account_name: "Pat Smith", why: ["phone"], site_id: null },
    ];
    const env = world({
      req: request({
        status: "new",
        account_id: null,
        site_id: null,
        address: "120 N Maple",
      }),
      sites: [
        site({ id: "s-nelson", name: "Warehouse", address1: "120 Nelson Rd" }),
        site({ id: "s-maple", name: "Mill", address1: "120 North Maple Street" }),
        site({ id: "s-north", account_id: ACCOUNT2, name: "Shop", address1: "120 North St" }),
        site({ id: "s-gone", name: "Old mill", address1: "120 N Maple", deleted_at: "2026-01-01" }),
      ],
      rpcs: { public_request_matches: matches },
    });
    const out = await run<OpportunityRequest>(getOpportunityRequest, env, { opportunity_id: OPP });
    // All three are still offered.
    expect(out.matches.map((m) => m.account_name)).toEqual([
      "Acme Mills",
      "Baker Tool",
      "Pat Smith",
    ]);
    // Acme has the very building: it is the one offered, and marked.
    expect(out.matches[0]).toMatchObject({
      site_id: "s-maple",
      site_name: "Mill",
      site_address: "120 North Maple Street, London, KY 40741",
      same_address: true,
    });
    // Baker's is only alike: offered as before, and not marked.
    expect(out.matches[1]).toMatchObject({ site_id: "s-north", same_address: false });
    expect(out.matches[1]!.site_address).toBe("120 North St, London, KY 40741");
    // A match by phone with no property: a new property is made from the request's address.
    expect(out.matches[2]).toMatchObject({ site_id: null, same_address: false });
  });
  it("once somebody said whose it is, the box is given the property's address and whether it is the same", async () => {
    const env = world({ sites: [site({ address1: "200 Sycamore St" })] });
    const out = await run<OpportunityRequest>(getOpportunityRequest, env, { opportunity_id: OPP });
    expect(out.site).toEqual({
      id: SITE,
      name: "Plant 2",
      address: "200 Sycamore St, London, KY 40741",
      same_address: false,
    });
    const honest = world();
    expect(
      (await run<OpportunityRequest>(getOpportunityRequest, honest, { opportunity_id: OPP })).site,
    ).toMatchObject({ same_address: true });
  });
  it("the box: one press only at the same building, both addresses and one more press anywhere else", () => {
    expect(CARE_START_HERE_BUTTON).toBe("Start the plan at this property");
    expect(STRIP).toContain(
      "if (c.site_id && auto.ok && c.same_address) start.mutate({ siteId: c.site_id });",
    );
    // A property this page just made holds the address they typed.
    expect(STRIP).toContain("same_address: siteIdIn ? sameAddress : true,");
    expect(STRIP).toContain(
      "return finish(m.account_id, m.site_id, m.account_name, m.same_address);",
    );
    expect(STRIP).toContain("{sameAddress ? CARE_START_BUTTON : CARE_START_HERE_BUTTON}");
    expect(STRIP).toContain(
      "onClick={() => start.mutate({ siteId: opp.site_id!, addressOk: !sameAddress })}",
    );
    expect(STRIP).toContain("data-request-addresses");
    expect(STRIP).toContain('<span className="font-medium">{requestAddress(r)}</span>');
    expect(STRIP).toContain("{CARE_ADDRESS_DIFFERS}");
    expect(CARE_ADDRESS_DIFFERS).toBe(
      "These are not the same address. Start the plan here only if this is the building they mean. If it is not, pick the right property on this opportunity and save it.",
    );
    // The server's refusal for the address turns the same box on, and does not take the button away.
    expect(STRIP).toContain(
      "if (errText(e).includes(CARE_START_OTHER_ADDRESS)) setAddressAsked(true); else setStartWhy(errText(e));",
    );
    // The request is read again when the customer or the property on the opportunity changes,
    // and what stays on the screen meanwhile is this opportunity's own request, never another's.
    expect(STRIP).toContain(
      "queryKey: [...opportunityRequestKey(opp.id), opp.account_id, opp.site_id],",
    );
    expect(STRIP).toContain(
      "placeholderData: (before, was) => (was?.queryKey[1] === opp.id ? before : undefined),",
    );
    // A match that is only alike says so before the press.
    expect(STRIP).toContain("{auto.ok && m.site_id && !m.same_address && (");
  });
});

// ── 18. A stranger's size ───────────────────────────────────────────────────────────────────

describe("18. a size from the public page is checked only when a map agrees with it", () => {
  const f = fnBody("roof_care_sign_up_from_request");
  it("checked only within 20% of a map size, smaller or larger; the map is the property's, else the page's own reading", () => {
    expect(f).toContain(
      "v_ref := coalesce(v_map, case when q.sqft_source = 'map' and q.sqft >= 500 then q.sqft end);",
    );
    expect(f).toContain(
      "set size_map_sqft = v_ref, size_unchecked = not coalesce( v_ref is not null and p_sqft >= v_ref * 0.8 and p_sqft <= v_ref * 1.2, false) where id = v_plan;",
    );
  });
  it("the sign-up itself runs unchanged, with no manager's tick, and staff's own sign-up is not rewritten", () => {
    expect(f).toContain(
      "v_plan := public.roof_care_sign_up_await_payment( p_site, p_plan, p_sqft, p_hours, p_miles, p_estimated, p_first, p_days, p_agreed_by, p_notes, p_terms, p_pay_method, p_pay_note, false, p_shown_price);",
    );
    expect(SQL).not.toContain("create or replace function public.roof_care_sign_up_await_payment(");
    expect(SQL).not.toContain("drop function");
    // The window still signs through the sign-up's own function, tick and all.
    const fns = flat(read("src/lib/roof-care-plan.functions.ts"));
    expect(fns).toContain(
      ': await sb.rpc("roof_care_sign_up_await_payment", { ...signing, ...(data.size_ok ? { p_size_ok: true } : {}), });',
    );
    expect(fns).toContain(
      "? await signFromRequest(sb, { p_request: from.request_id, ...signing })",
    );
  });
  it("the plan says the map's own number beside a size it does not agree with", () => {
    const size = (unchecked: boolean, map_sqft: number | null) =>
      planSizeWords({
        roof_sqft: 200000,
        size: { unchecked, map_sqft, confirmed: null, changes: [] } as never,
      });
    expect(size(true, 20040)).toBe(
      "Roof size 200,000 sq ft, typed on the public page. The map shows about 20,000 sq ft, so check it. A manager or an admin confirms it.",
    );
    // With no map size the words are what they were.
    expect(size(true, null)).toBe(
      "Roof size 200,000 sq ft: typed by hand, not checked against the map. A manager or an admin confirms it.",
    );
  });
});

// ── 28. Three smaller ones ──────────────────────────────────────────────────────────────────

describe("28. a plan that was ended, a plan not read back, a refusal that does not count", () => {
  it("(d) a request whose plan was ended says so, with the day", async () => {
    const care = { kind: "care", shown_price: 205, plan: "care", roof_care_plan_id: PLAN } as const;
    const opp = { account_id: ACCOUNT, site_id: SITE };
    expect(requestStep(care, opp, "ended")).toBe("ended");
    expect(requestStep(care, opp, "awaiting_payment")).toBe("signed");
    expect(requestStep(care, opp, "active")).toBe("paid");
    expect(requestStepWords("ended", care, { ended_on: "2026-11-25", paid: false })).toBe(
      "The plan made from this request was ended on Nov 25, 2026, before it was paid. Nothing waits here.",
    );
    expect(requestStepWords("ended", care, { ended_on: "2027-03-02", paid: true })).toBe(
      "The plan made from this request was ended on Mar 2, 2027. Nothing waits here.",
    );
    // The day is not known: said without one.
    expect(requestStepWords("ended", care)).toBe(
      "The plan made from this request was ended, before it was paid. Nothing waits here.",
    );
    const env = world({
      req: request({ roof_care_plan_id: PLAN }),
      plans: [planRow({ status: "ended", ended_on: "2026-11-25", paid_on: null })],
    });
    const out = await run<OpportunityRequest>(getOpportunityRequest, env, { opportunity_id: OPP });
    expect(out).toMatchObject({
      plan_status: "ended",
      plan_ended_on: "2026-11-25",
      plan_paid: false,
    });
    expect(STRIP).toContain(
      "{requestStepWords(step, r, { ended_on: q.data?.plan_ended_on, paid: q.data?.plan_paid, })}",
    );
    // The plan's waiting steps are for a plan that waits, not for one that was ended.
    expect(STRIP).toContain('{step === "signed" && opp.site_id && (');
  });

  it("(d2) a plan that is signed and cannot be read back is said as that, and its request is tied", async () => {
    // The made-up database signs the plan and then has no row to read back.
    const env = world({ keep: false });
    const out = await start(env, ASK);
    expect(out).toEqual({ plan: null, tied: true, unread: true });
    // Signed once, with its request, so the request points at the plan.
    expect(signUps(env).map((c) => c.args["p_request"])).toEqual([REQUEST]);
    expect(CARE_SIGNED_NOT_READ).toBe(
      "The plan is signed. The page could not read it back: reload.",
    );
    expect(STRIP).toContain(
      "if (made.unread) toast.warning(CARE_SIGNED_NOT_READ, { duration: 30_000 });",
    );
  });
  it("(d2) the sign-up window is told the same truth", async () => {
    const env = world({ keep: false });
    await expect(
      run(signUpRoofCare, env, {
        site_id: SITE,
        plan: "care",
        sqft: 26000,
        first: "window",
        pay_method: "check",
        agreed_by: "Pat Smith",
        terms_agreed: true,
        shown_price: 210,
      }),
    ).rejects.toThrow("The plan is signed. The page could not read it back: reload.");
  });

  const CARE = {
    address: "120 Mill St",
    city: "London",
    state: "KY",
    zip: "40741",
    contact_name: "Pat Smith",
    company: "",
    phone: "606-555-0142",
    email: "",
    building_name: "",
    referred_by: "",
    plan: "care",
    sqft: 21000,
    shown_price: 210,
    quote_token: "tok",
    pay_method: "check",
    agreed: true,
    terms_version: ROOF_CARE_TERMS_VERSION,
    agreed_by: "Pat Smith",
    several_buildings: false,
    notes: "",
    website: "",
    open_ms: 30_000,
  };
  const SERVICE = {
    address: "120 Mill St",
    city: "London",
    state: "KY",
    zip: "40741",
    contact_name: "Pat Smith",
    company: "",
    phone: "606-555-0142",
    email: "",
    building_name: "",
    referred_by: "",
    services: ["Roof inspection"],
    details: "",
    website: "",
    open_ms: 30_000,
  };
  function formDeps(submit: { data: unknown; error: { message: string; code?: string } | null }) {
    const calls: { fn: string; args: unknown }[] = [];
    const admin = {
      rpc: async (fn: string, args: unknown) => {
        calls.push({ fn, args });
        if (fn === "public_form_take2") return { data: { ok: true }, error: null };
        if (fn === "public_request_submit") return submit;
        if (fn === "public_form_give_back") return { data: true, error: null };
        return { data: null, error: { message: `no such function ${fn}` } };
      },
    };
    const deps: PublicDeps = {
      admin: admin as never,
      key: "k".repeat(40),
      sample: false,
      drive: async () => null,
      mapSize: async () => null,
      tell: async () => undefined,
    };
    return { deps, calls };
  }
  const PRICE_MOVED =
    "The price changed after it was shown. Press Show my prices again, then send.";
  const ADDRESS_MOVED =
    "The address changed after the prices were shown. Press Show my prices again, then send.";

  it("(e) a request turned down for a reason the visitor can fix is given back to their count", async () => {
    for (const [message, code] of [
      [PRICE_MOVED, "P0001"],
      [ADDRESS_MOVED, "P0001"],
      ["Type your name.", "22023"],
    ] as const) {
      const f = formDeps({ data: null, error: { message, code } });
      await expect(sendCare(CARE, f.deps), message).rejects.toThrow(message);
      expect(f.calls.map((c) => c.fn)).toEqual([
        "public_form_take2",
        "public_request_submit",
        "public_form_give_back",
      ]);
      expect(f.calls[2]!.args).toEqual({ p_kind: "request", p_key: "k".repeat(40) });
    }
    const s = formDeps({
      data: null,
      error: {
        message:
          "One of the services ticked is not on our list any more. Reload the page and try again.",
        code: "22023",
      },
    });
    await expect(sendService(SERVICE, s.deps)).rejects.toThrow("not on our list any more");
    expect(s.calls.map((c) => c.fn)).toContain("public_form_give_back");
  });
  it("(e) a request that was kept, and a fault of ours, are counted as before", async () => {
    const kept = formDeps({ data: "R-4321", error: null });
    expect(await sendCare(CARE, kept.deps)).toEqual({ reference: "R-4321" });
    expect(kept.calls.map((c) => c.fn)).not.toContain("public_form_give_back");
    const fault = formDeps({ data: null, error: { message: "deadlock detected", code: "40P01" } });
    await expect(sendCare(CARE, fault.deps)).rejects.toThrow();
    expect(fault.calls.map((c) => c.fn)).not.toContain("public_form_give_back");
    // A robot's form never reaches the count at all, as before.
    const robot = formDeps({ data: "R-4321", error: null });
    await sendCare({ ...CARE, website: "http://spam.example" }, robot.deps);
    expect(robot.calls.map((c) => c.fn)).not.toContain("public_form_take2");
  });
  it("(e) the visitor is told the same reason when the count could not be given back", async () => {
    const f = formDeps({ data: null, error: { message: PRICE_MOVED, code: "P0001" } });
    const rpc = (f.deps.admin as unknown as { rpc: (fn: string, a: unknown) => Promise<unknown> })
      .rpc;
    (f.deps.admin as unknown as { rpc: unknown }).rpc = async (fn: string, a: unknown) => {
      if (fn === "public_form_give_back") throw new Error("database away");
      return rpc(fn, a);
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(sendCare(CARE, f.deps)).rejects.toThrow(PRICE_MOVED);
    errors.mockRestore();
  });
  it("(e) in the database: the connection's own hour and day, at most 20 a day, never the day for everyone", () => {
    const f = fnBody("public_form_give_back");
    expect(f).toContain(
      "if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Only the site''s own server counts requests' using errcode = '42501';",
    );
    expect(f).toContain("if p_kind is distinct from 'request' then return false;");
    // Counted first, in one step, under the connection's own key.
    expect(f).toContain(
      "values ('request', left(p_key, 78) || ':b', v_day, 1) on conflict (kind, key, bucket) do update set n = public.public_form_hits.n + 1 returning n into v_back; if v_back > 20 then return false;",
    );
    expect(f).toContain(
      "update public.public_form_hits set n = n - 1 where kind = 'request' and key = p_key and bucket = v_hour and n > 0;",
    );
    expect(f).toContain(
      "update public.public_form_hits set n = n - 1 where kind = 'request' and key = left(p_key, 78) || ':d' and bucket = v_day and n > 0;",
    );
    // The day's count for everyone (the '*' row) is never written here.
    expect(f).not.toContain("and key = '*'");
    expect(f.match(/update public\.public_form_hits/g)).toHaveLength(2);
    expect(SQL).toContain(
      "revoke all on function public.public_form_give_back(text, text) from public, anon, authenticated; grant execute on function public.public_form_give_back(text, text) to service_role;",
    );
  });
});

describe("the migration", () => {
  it("runs twice, says how it is applied, and holds no real amount", () => {
    expect(SQL).toContain("Applied on the live database by hand (AGENTS.md).");
    expect(SQL).not.toMatch(/create (function|table|trigger) /);
    expect(SQL).toContain("notify pgrst, 'reload schema';");
    expect(SQL).not.toMatch(/\$\s?\d/);
  });
  it("the office's answer is still theirs alone", async () => {
    const env = world();
    await expect(
      run(handlePublicRequest, env, { id: REQUEST, status: "matched", site_id: SITE }, TECH),
    ).rejects.toThrow();
    expect(env.rpcCalls).toEqual([]);
  });
});
