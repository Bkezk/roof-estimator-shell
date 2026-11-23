/**
 * The Care plans tab of the Customers page (owner, Nov 23: "Under customers currently there is
 * customers and vendors tab can you add a care plan tab that shows the customers that have a
 * plan, which plan they have, their reference number they get when they sign up, their price,
 * and any other pertinent details? This of course isn't viewed by techs as nothing on the
 * customer page is.").
 *
 * Every price here is made up and matches no plan price.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { pageForPath } from "@/lib/access";
import {
  CARE_PLANS_NONE,
  CARE_PLAN_SHOWS,
  carePlanCreditWords,
  carePlanRenewsWords,
  carePlanRow,
  carePlanState,
  carePlanTotals,
  carePlanTotalsWords,
  filterCarePlans,
  sortCarePlans,
  type CarePlanRow,
} from "@/lib/care-plan-list";
import { CARE_PLANS_NEED, carePlanRows, listCarePlans } from "@/lib/care-plan-list.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const ESTIMATOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac";
const TECH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACC_A = "22222222-2222-4222-8222-222222222221";
const ACC_B = "22222222-2222-4222-8222-222222222222";
const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "11111111-1111-4111-8111-111111111112";
const SITE_C = "11111111-1111-4111-8111-111111111113";
const P_ACTIVE = "33333333-3333-4333-8333-333333333331";
const P_WAIT = "33333333-3333-4333-8333-333333333332";
const P_EXPIRED = "33333333-3333-4333-8333-333333333333";
const V1 = "44444444-4444-4444-8444-444444444441";
const V2 = "44444444-4444-4444-8444-444444444442";
const JOB = "55555555-5555-4555-8555-555555555555";
const TODAY = "2027-01-10";

const planRow = (over: Record<string, unknown>) => ({
  account_id: ACC_A,
  site_id: SITE_A,
  plan: "care",
  status: "active",
  pay_first: true,
  plan_number: 1004,
  first_visit: "window",
  first_days: null,
  signed_on: "2026-11-20",
  starts_on: "2026-11-23",
  renews_on: "2027-11-23",
  roof_sqft: 21000,
  price: 2740,
  list_price: 2600,
  travel_price: 140,
  price_estimated: false,
  repair_allowance: 410,
  pay_method: "check",
  pay_note: null,
  agreed_by: "Pat Smith",
  sold_by_name: "Ann Admin",
  referred_by: "Tom Tech",
  notes: "",
  ended_on: null,
  ended_reason: null,
  renewed_from: null,
  created_at: "2026-11-20T15:00:00Z",
  ...over,
});
const visit = (id: string, kind: string, from: string, by: string) => ({
  id,
  plan_id: P_ACTIVE,
  kind,
  due_from: from,
  due_by: by,
  first_due_by: by,
  amount: 0,
  push_reason: null,
  pushed_by_name: null,
  customer_asked: false,
  lost_on: null,
});

const world = (over: Record<string, Record<string, unknown>[]> = {}) =>
  fakeSupabase({
    profiles: [
      {
        id: ADMIN,
        role: "admin",
        access: [],
        technician: false,
        full_name: "Ann Admin",
        email: "a",
      },
      {
        id: OFFICE,
        role: "user",
        access: ["customers"],
        technician: false,
        full_name: "Olive Office",
        email: "o",
      },
      {
        id: ESTIMATOR,
        role: "user",
        access: ["estimate"],
        technician: false,
        full_name: "Ed Estimator",
        email: "e",
      },
      {
        id: TECH,
        role: "user",
        access: ["service"],
        technician: true,
        full_name: "Tom Tech",
        email: "t",
      },
    ],
    crm_accounts: [
      { id: ACC_A, name: "Smith Widgets", deleted_at: null },
      { id: ACC_B, name: "Bell County Schools", deleted_at: null },
    ],
    crm_sites: [
      {
        id: SITE_A,
        account_id: ACC_A,
        name: "Main plant",
        address1: "120 Mill St",
        city: "London",
        state: "KY",
      },
      {
        id: SITE_B,
        account_id: ACC_B,
        name: "",
        address1: "45 School Rd",
        city: "Pineville",
        state: "KY",
      },
      {
        id: SITE_C,
        account_id: ACC_B,
        name: "Bus garage",
        address1: "9 Depot St",
        city: "Pineville",
        state: "KY",
      },
    ],
    roof_care_plans: [
      planRow({ id: P_ACTIVE }),
      planRow({
        id: P_WAIT,
        account_id: ACC_B,
        site_id: SITE_B,
        plan: "guard",
        status: "awaiting_payment",
        plan_number: 1006,
        signed_on: "2027-01-08",
        starts_on: null,
        renews_on: "2028-01-08",
        price: 4310,
        repair_allowance: 1270,
        pay_method: "card",
        sold_by_name: "",
        referred_by: "",
        created_at: "2027-01-08T15:00:00Z",
      }),
      planRow({
        id: P_EXPIRED,
        account_id: ACC_B,
        site_id: SITE_C,
        plan: "watch",
        status: "ended",
        plan_number: null,
        signed_on: "2025-12-01",
        starts_on: "2025-12-01",
        renews_on: "2026-12-01",
        ended_on: "2026-12-01",
        ended_reason: "Expired",
        price: 1380,
        repair_allowance: 0,
        referred_by: null,
        created_at: "2025-12-01T15:00:00Z",
      }),
    ],
    roof_care_visits: [
      visit(V1, "visit1", "2026-11-23", "2026-12-31"),
      visit(V2, "visit2", "2027-03-15", "2027-05-15"),
    ],
    service_jobs: [
      {
        id: JOB,
        number: 412,
        stage: "closed",
        scheduled_date: "2026-12-04",
        completed_at: "2026-12-04T18:00:00Z",
        invoice_id: null,
        roof_care_visit_id: V1,
        deleted_at: null,
      },
    ],
    invoices: [],
    invoice_lines: [],
    ...over,
  });
type Env = ReturnType<typeof world>;
type Sb = Parameters<typeof carePlanRows>[0];
const call = (env: Env, userId: string) =>
  (listCarePlans as unknown as (a: { data: unknown; context: unknown }) => Promise<CarePlanRow[]>)({
    data: undefined,
    context: { supabase: env.db, userId },
  });

describe("the list, as the server answers it", () => {
  it("one row for each plan: the customer, the property, the plan, its number and its price", async () => {
    const rows = await carePlanRows(world().db as unknown as Sb, TODAY);
    // Waiting for payment first, then active, then the ones that are over.
    expect(rows.map((r) => [r.state, r.account_name, r.number])).toEqual([
      ["waiting", "Bell County Schools", "RC-1006"],
      ["active", "Smith Widgets", "RC-1004"],
      ["expired", "Bell County Schools", ""],
    ]);
    const active = rows[1]!;
    expect(active).toMatchObject({
      account_id: ACC_A,
      site_id: SITE_A,
      site_name: "Main plant",
      site_place: "London, KY",
      plan: "care",
      price: 2740,
      roof_sqft: 21000,
      starts_on: "2026-11-23",
      renews_on: "2027-11-23",
      pay_method: "check",
      sold_by_name: "Ann Admin",
      referred_by: "Tom Tech",
      repair_allowance: 410,
      // Inspection 1's ticket is closed, so the next one is inspection 2.
      inspections_done: 1,
      next_inspection: "Due Mar 15 to May 15, 2027",
      next_late: false,
      renewal: false,
    });
    // A property with no name is listed by its street.
    expect(rows[0]).toMatchObject({ site_name: "45 School Rd", site_place: "Pineville, KY" });
    // A plan not paid yet, or over, has no next inspection to show.
    expect(rows[0]!.next_inspection).toBe("");
    expect(rows[2]!.next_inspection).toBe("");
  });
  it("never the parts of a price: no list price, no charge for the drive", async () => {
    const sent = JSON.stringify(await carePlanRows(world().db as unknown as Sb, TODAY));
    expect(sent).not.toMatch(/list_price|travel_price|2600|140\b/);
  });
  it("an inspection past its last day is marked late", async () => {
    const env = world({ service_jobs: [] });
    const rows = await carePlanRows(env.db as unknown as Sb, TODAY);
    const active = rows.find((r) => r.state === "active")!;
    expect(active).toMatchObject({
      inspections_done: 0,
      next_inspection: "Due Nov 23 to Dec 31, 2026",
      next_late: true,
    });
  });
  it("no plans at all is an empty list, not an error", async () => {
    expect(await carePlanRows(world({ roof_care_plans: [] }).db as unknown as Sb, TODAY)).toEqual(
      [],
    );
  });
});

describe("who may read it", () => {
  it("an admin and an office user with Customers access", async () => {
    expect((await call(world(), ADMIN)).length).toBe(3);
    expect((await call(world(), OFFICE)).length).toBe(3);
  });
  it("not a technician, and not someone without the Customers page", async () => {
    await expect(call(world(), TECH)).rejects.toThrow(CARE_PLANS_NEED);
    await expect(call(world(), ESTIMATOR)).rejects.toThrow(CARE_PLANS_NEED);
    await expect(call(world(), "99999999-9999-4999-8999-999999999999")).rejects.toThrow(
      CARE_PLANS_NEED,
    );
  });
  it("the tab is on the Customers page, which the central gate keeps to Customers access", () => {
    expect(pageForPath("/customers")).toBe("customers");
    const route = flat(read("src/routes/customers.tsx"));
    expect(route).toContain(
      'if (s["tab"] === "vendors" || s["tab"] === "care") out.tab = s["tab"];',
    );
  });
});

const row = (over: Partial<CarePlanRow> = {}): CarePlanRow => ({
  id: P_ACTIVE,
  account_id: ACC_A,
  account_name: "Smith Widgets",
  site_id: SITE_A,
  site_name: "Main plant",
  site_place: "London, KY",
  plan: "care",
  number: "RC-1004",
  state: "active",
  price: 2740,
  price_estimated: false,
  roof_sqft: 21000,
  signed_on: "2026-11-20",
  starts_on: "2026-11-23",
  renews_on: "2027-11-23",
  ended_on: null,
  ended_reason: null,
  pay_method: "check",
  sold_by_name: "Ann Admin",
  referred_by: "",
  repair_allowance: 410,
  inspections_done: 1,
  next_inspection: "Due Mar 15 to May 15, 2027",
  next_late: false,
  renewal: false,
  ...over,
});

describe("where a plan stands", () => {
  it("active, waiting for payment, expired, or ended", () => {
    expect(carePlanState({ status: "active" })).toBe("active");
    expect(carePlanState({ status: "awaiting_payment" })).toBe("waiting");
    expect(carePlanState({ status: "ended", ended_reason: "Expired" })).toBe("expired");
    expect(carePlanState({ status: "ended", ended_reason: "Sold the building" })).toBe("ended");
  });
  it("a renewal is marked as one", () => {
    const base = {
      visits: [],
      plan_number: 1009,
      status: "active",
      plan: "care",
      renewed_from: P_EXPIRED,
    } as unknown as Parameters<typeof carePlanRow>[0];
    const names = { account_name: "A", site_name: "S", site_place: "", referred_by: " Tom " };
    expect(carePlanRow(base, names, TODAY)).toMatchObject({
      renewal: true,
      number: "RC-1009",
      referred_by: "Tom",
    });
  });
});

describe("the chips and the search", () => {
  const rows = [
    row(),
    row({
      id: P_WAIT,
      state: "waiting",
      account_name: "Bell County Schools",
      number: "RC-1006",
      plan: "guard",
      site_name: "45 School Rd",
      site_place: "Pineville, KY",
    }),
    row({
      id: P_EXPIRED,
      state: "expired",
      account_name: "Bell County Schools",
      number: "",
      plan: "watch",
    }),
    row({ id: "x", state: "ended", account_name: "Old Mill", number: "RC-1001" }),
  ];
  const ids = (r: CarePlanRow[]) => r.map((x) => x.id);
  it("Current is every plan not over, and it is the first chip", () => {
    expect(CARE_PLAN_SHOWS[0]).toBe("current");
    expect(ids(filterCarePlans(rows, "current", ""))).toEqual([P_ACTIVE, P_WAIT]);
    expect(ids(filterCarePlans(rows, "active", ""))).toEqual([P_ACTIVE]);
    expect(ids(filterCarePlans(rows, "waiting", ""))).toEqual([P_WAIT]);
    expect(ids(filterCarePlans(rows, "over", ""))).toEqual([P_EXPIRED, "x"]);
    expect(filterCarePlans(rows, "all", "").length).toBe(4);
  });
  it("the search reads the customer, the property, its town, the plan and the number", () => {
    expect(ids(filterCarePlans(rows, "all", "bell guard"))).toEqual([P_WAIT]);
    expect(ids(filterCarePlans(rows, "all", "pineville"))).toEqual([P_WAIT]);
    expect(ids(filterCarePlans(rows, "all", "rc-1004"))).toEqual([P_ACTIVE]);
    expect(ids(filterCarePlans(rows, "all", "1004"))).toEqual([P_ACTIVE]);
    expect(ids(filterCarePlans(rows, "all", "roof watch"))).toEqual([P_EXPIRED]);
    expect(filterCarePlans(rows, "all", "nobody")).toEqual([]);
    // A chip and a search together.
    expect(filterCarePlans(rows, "current", "old mill")).toEqual([]);
  });
  it("active plans are in the order they renew, soonest first", () => {
    const sorted = sortCarePlans([
      row({ id: "late", renews_on: "2027-12-01" }),
      row({ id: "soon", renews_on: "2027-02-01" }),
      row({ id: "w", state: "waiting" }),
    ]);
    expect(ids(sorted)).toEqual(["w", "soon", "late"]);
  });
});

describe("the line over the list", () => {
  it("counts the active plans and what they bring in a year, and the ones waiting", () => {
    const rows = [
      row(),
      row({ id: "b", price: 4310 }),
      row({ id: "c", state: "waiting", price: 9999 }),
      row({ id: "d", state: "ended", price: 9999 }),
    ];
    expect(carePlanTotals(rows)).toEqual({ active: 2, waiting: 1, yearly: 7050 });
    expect(carePlanTotalsWords(rows)).toBe(
      "2 active plans, $7,050 a year. 1 plan waiting for payment.",
    );
    expect(carePlanTotalsWords([row()])).toBe("1 active plan, $2,740 a year.");
    expect(carePlanTotalsWords([row({ state: "waiting" })])).toBe(
      "No plan is active. 1 plan waiting for payment.",
    );
    expect(carePlanTotalsWords([row({ state: "ended" })])).toBe("No plan is active.");
  });
});

describe("the Renews column", () => {
  it("a day far off is only the day; inside 60 days it says how close", () => {
    expect(carePlanRenewsWords(row(), TODAY)).toEqual({ text: "Nov 23, 2027", soon: false });
    expect(carePlanRenewsWords(row({ renews_on: "2027-02-09" }), TODAY)).toEqual({
      text: "Feb 9, 2027, in 30 days",
      soon: true,
    });
    expect(carePlanRenewsWords(row({ renews_on: "2027-01-11" }), TODAY).text).toBe(
      "Jan 11, 2027, tomorrow",
    );
    expect(carePlanRenewsWords(row({ renews_on: TODAY }), TODAY).text).toBe("Jan 10, 2027, today");
    expect(carePlanRenewsWords(row({ renews_on: "2027-01-07" }), TODAY).text).toBe(
      "Jan 7, 2027, 3 days ago",
    );
  });
  it("a plan not paid has no year yet, and one that is over says when it stopped", () => {
    expect(carePlanRenewsWords(row({ state: "waiting" }), TODAY).text).toBe(
      "Starts when it is paid",
    );
    expect(carePlanRenewsWords(row({ state: "expired", ended_on: "2026-12-01" }), TODAY).text).toBe(
      "Expired Dec 1, 2026",
    );
    expect(carePlanRenewsWords(row({ state: "ended", ended_on: "2026-12-20" }), TODAY).text).toBe(
      "Ended Dec 20, 2026",
    );
  });
});

describe("who signed them up", () => {
  it("says who signed the customer up and who referred them, when known", () => {
    expect(carePlanCreditWords(row({ referred_by: "Tom Tech" }))).toBe(
      "Signed up by Ann Admin. Referred by Tom Tech.",
    );
    expect(carePlanCreditWords(row())).toBe("Signed up by Ann Admin.");
    expect(carePlanCreditWords(row({ sold_by_name: "" }))).toBe("");
  });
});

describe("the screen", () => {
  const page = flat(read("src/components/customers-page.tsx"));
  const section = flat(read("src/components/crm/care-plans-section.tsx"));
  it("a third tab beside Customers and Vendors", () => {
    expect(page).toContain('{ tab: "care", title: "Care plans", icon: ShieldCheck },');
    expect(page).toContain('if (tab === "care")');
    expect(page).toContain("<CarePlansSection />");
  });
  it("shows the number, the price and where the plan stands, and opens the customer and the property", () => {
    expect(section).toContain('{r.number || "None"}');
    expect(section).toContain("{priceWords(r)}");
    expect(section).toContain("<StateBadge state={r.state} />");
    expect(section).toContain('to="/customers/$id" params={{ id: r.account_id }}');
    expect(section).toContain('to="/properties/$id" params={{ id: r.site_id }}');
    expect(section).toContain("{carePlanTotalsWords(all)}");
  });
  it("a table on a computer and cards on a phone: nothing scrolls sideways", () => {
    expect(section).toContain('<div className="hidden rounded-lg border md:block">');
    expect(section).toContain('<ul className="space-y-2 md:hidden">');
    expect(section).not.toContain("overflow-x-auto");
  });
  it("changes nothing: it only reads", () => {
    expect(section).not.toMatch(/useMutation|method: "POST"/);
    expect(read("src/lib/care-plan-list.functions.ts")).not.toMatch(
      /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/,
    );
  });
  it("says so plainly while no customer has a plan", () => {
    expect(CARE_PLANS_NONE).toBe(
      "No customer has a Roof Care plan yet. A plan is signed from a property's page, with the Care Plan button.",
    );
    expect(section).toContain("{CARE_PLANS_NONE}");
  });
});
