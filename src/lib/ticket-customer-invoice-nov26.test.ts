/**
 * The audit of Nov 25, 2026, number 19 (owner: "go"): a ticket's customer and its invoice.
 *
 * An invoice keeps its own copy of whom it bills, the property and the tax rate. A ticket's
 * customer could be changed after the invoice was made and the invoice kept the old customer:
 * ticket 6100 for a tax-exempt customer, draft invoice 6100 at 1,000.00 with no tax; a manager
 * picks a taxable customer; the invoice page's heading read the new one while the PDF, the
 * Invoices list and the total stayed the old one's, 1,000.00 instead of 1,060.00.
 *
 * Now a final or paid invoice stops the change, a draft follows in the same save, and a
 * technician's notes save no longer writes the customer at all (a page opened before the
 * office changed the customer sent the old one back). Every name and number here is made up.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));
vi.mock("@/lib/service-crew.server", () => ({
  syncCrewLead: vi.fn(async () => {}),
  writeCrew: vi.fn(async () => 0),
  readCrew: vi.fn(async () => []),
}));

import { fieldNotesInput } from "@/lib/field-ticket-page";
import { saveServiceJob } from "@/lib/service.functions";
import {
  CUSTOMER_CHANGE_NEEDS_INVOICES,
  customerChangeWarnings,
  customerTakenOffMessage,
  draftFollowedLine,
  invoiceStopsCustomerChange,
  ticketCustomerChange,
} from "@/lib/ticket-form";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

const MANAGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const TECH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const A_SITE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const A_SITE2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";
const B_SITE = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const INV = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const INV2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const VENDOR = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const job = (over: Row = {}): Row => ({
  id: JOB,
  number: 6100,
  customer_name: "Made Up School Board",
  account_id: A,
  site_id: A_SITE,
  contact_id: null,
  site_name: "North school",
  site_address: "1 Made Up Rd, London, KY 40741",
  site_city: "London",
  site_state: "KY",
  description: "Leak over the gym",
  service_type: "repair",
  stage: "authorized",
  technician_id: TECH,
  scheduled_date: "2026-11-20",
  completed_at: "2026-11-20T18:00:00Z",
  field_status: null,
  helper_count: 0,
  invoice_id: INV,
  deleted_at: null,
  roof_care_visit_id: null,
  notes: "Gate code 12",
  notes_tech_visible: true,
  po_number: null,
  created_at: "2026-11-10T12:00:00Z",
  updated_at: "2026-11-10T12:00:00Z",
  ...over,
});

/** Draft invoice 6100: billed to the exempt customer A, 1,000.00 of taxable lines, no tax. */
const invoice = (over: Row = {}): Row => ({
  id: INV,
  service_job_id: JOB,
  bid_id: null,
  roof_care_plan_id: null,
  number: null,
  display_number: "6100",
  status: "draft",
  bill_to: { name: "Made Up School Board", address1: "9 Board St", external_id: "SCH01" },
  bill_to_vendor_id: null,
  property: { name: "North school", address: "1 Made Up Rd, London, KY 40741" },
  tax_rate: 0,
  subtotal: 1000,
  tax_amount: 0,
  total: 1000,
  cost_total: 410,
  care_allowance_choice: null,
  care_travel_choice: null,
  created_at: "2026-11-21T12:00:00Z",
  ...over,
});
const lines = (invoiceId = INV): Row[] => [
  {
    id: 1,
    invoice_id: invoiceId,
    sort: 0,
    kind: "labor",
    total: 600,
    cost_total: 250,
    taxable: true,
  },
  {
    id: 2,
    invoice_id: invoiceId,
    sort: 1,
    kind: "material",
    total: 400,
    cost_total: 160,
    taxable: true,
  },
];

const world = (j: Row, invoices: Row[], more: Row = {}) =>
  fakeSupabase({
    profiles: [
      { id: MANAGER, role: "manager", access: [], technician: false, full_name: "Mona Manager" },
      {
        id: OFFICE,
        role: "user",
        access: ["service", "customers"],
        technician: false,
        full_name: "Otto Office",
      },
      { id: TECH, role: "user", access: ["service"], technician: true, full_name: "Tia Tech" },
    ],
    service_jobs: [j],
    crm_accounts: [
      { id: A, name: "Made Up School Board", address1: "9 Board St", tax_exempt: true },
      {
        id: B,
        name: "Other Made Up Tires",
        address1: "40 Tire Way",
        city: "Corbin",
        tax_exempt: false,
      },
    ],
    crm_sites: [
      {
        id: A_SITE,
        account_id: A,
        name: "North school",
        address1: "1 Made Up Rd",
        city: "London",
        state: "KY",
      },
      {
        id: A_SITE2,
        account_id: A,
        name: "South school",
        address1: "2 Made Up Rd",
        city: "London",
        state: "KY",
      },
      {
        id: B_SITE,
        account_id: B,
        name: "Tire shop",
        address1: "40 Tire Way",
        city: "Corbin",
        state: "KY",
      },
    ],
    invoices,
    invoice_lines: invoices.flatMap((i) => (i["status"] === "void" ? [] : lines(String(i["id"])))),
    service_settings: [{ id: 1, tax_rate: 0.06, material_markup: 0.5, payment_terms: "Due" }],
    roof_care_plans: [],
    roof_care_no_access: [],
    service_job_events: [],
    crm_followups: [],
    crm_opportunities: [],
    crm_settings: [{ id: 1, ticket_first_days: 1, ticket_every_days: 3 }],
    ...more,
  });
type Env = ReturnType<typeof world>;
const save = (env: Env, data: Row, userId = MANAGER) =>
  (saveServiceJob as unknown as (a: { data: Row; context: unknown }) => Promise<Row>)({
    data: {
      id: JOB,
      description: "Leak over the gym",
      service_type: "repair",
      notes: "Gate code 12",
      ...data,
    },
    context: { supabase: env.db, userId },
  });
const ticketNow = (env: Env) => env.tables["service_jobs"]![0]!;
const invoiceNow = (env: Env, id = INV) => env.tables["invoices"]!.find((i) => i["id"] === id)!;
const writesTo = (env: Env, table: string) => env.writes.filter((w) => w.table === table);

beforeEach(() => vi.clearAllMocks());

describe("the rule", () => {
  it("tells another customer from another property of the same customer", () => {
    const saved = { account_id: A, site_id: A_SITE };
    expect(ticketCustomerChange(saved, { account_id: A, site_id: A_SITE })).toBeNull();
    expect(ticketCustomerChange(saved, { account_id: B, site_id: B_SITE })).toEqual({
      customer: true,
      property: true,
      hadCustomer: true,
    });
    expect(ticketCustomerChange(saved, { account_id: A, site_id: A_SITE2 })).toEqual({
      customer: false,
      property: true,
      hadCustomer: true,
    });
    // A ticket from before customer profiles, linked now: not a change of who is billed.
    expect(
      ticketCustomerChange({ account_id: null, site_id: null }, { account_id: B, site_id: null }),
    ).toEqual({ customer: true, property: false, hadCustomer: false });
  });
  it("a final or a paid invoice stops a change of customer, with its number", () => {
    const change = { customer: true, property: true, hadCustomer: true };
    expect(invoiceStopsCustomerChange(change, [{ label: "6100", status: "final" }])).toBe(
      "This ticket has an invoice that is already final (invoice 6100). Make the invoice void first, then change the customer.",
    );
    expect(invoiceStopsCustomerChange(change, [{ label: "6100", status: "paid" }])).toBe(
      "This ticket has an invoice that is already paid (invoice 6100). Make the invoice void first, then change the customer.",
    );
    expect(
      invoiceStopsCustomerChange(change, [
        { label: "6100", status: "final" },
        { label: "6100.2", status: "paid" },
        { label: "6100.3", status: "draft" },
      ]),
    ).toBe(
      "This ticket has invoices that are already final (invoice 6100 and 6100.2). Make them void first, then change the customer.",
    );
  });
  it("a draft, a void invoice or a change of property alone stops nothing", () => {
    const change = { customer: true, property: true, hadCustomer: true };
    expect(invoiceStopsCustomerChange(change, [{ label: "6100", status: "draft" }])).toBeNull();
    expect(invoiceStopsCustomerChange(change, [])).toBeNull();
    expect(
      invoiceStopsCustomerChange({ customer: false, property: true, hadCustomer: true }, [
        { label: "6100", status: "final" },
      ]),
    ).toBeNull();
    expect(
      invoiceStopsCustomerChange({ customer: true, property: false, hadCustomer: false }, [
        { label: "6100", status: "final" },
      ]),
    ).toBeNull();
  });
  it("the screen's warning before the save says what will happen to each invoice", () => {
    const customer = { customer: true, property: true, hadCustomer: true };
    expect(customerChangeWarnings(customer, [{ label: "6100", status: "draft" }])).toEqual([
      "Saving also changes draft invoice 6100: it will bill the new customer, with that customer's tax.",
    ]);
    expect(
      customerChangeWarnings({ customer: false, property: true, hadCustomer: true }, [
        { label: "6100", status: "final" },
        { label: "6100.2", status: "draft" },
        { label: "6100.3", status: "void" },
      ]),
    ).toEqual([
      "Saving also changes draft invoice 6100.2: it will show the new property.",
      "Invoice 6100 is already final and will not be changed: it keeps what it was sent with.",
    ]);
    expect(customerChangeWarnings(customer, [{ label: "6100", status: "final" }])).toEqual([
      invoiceStopsCustomerChange(customer, [{ label: "6100", status: "final" }]),
    ]);
    expect(customerChangeWarnings(null, [{ label: "6100", status: "draft" }])).toEqual([]);
    expect(customerChangeWarnings(customer, [{ label: "6100", status: "void" }])).toEqual([]);
  });
  it("the sentence after the save", () => {
    const base = { label: "6100", vendor: false, property: null, taxFrom: "0%", taxTo: "0%" };
    expect(draftFollowedLine({ ...base, billTo: "Other Made Up Tires", taxTo: "6%" })).toBe(
      "Draft invoice 6100 now bills Other Made Up Tires. Its tax went from 0% to 6%.",
    );
    expect(draftFollowedLine({ ...base, billTo: null, property: "South school" })).toBe(
      "Draft invoice 6100 now shows the property South school.",
    );
    expect(draftFollowedLine({ ...base, billTo: null, vendor: true, property: "Tire shop" })).toBe(
      "Draft invoice 6100 is billed to a vendor, so its Bill To was not changed. Its property now reads Tire shop.",
    );
  });
});

describe("the audit's run: ticket 6100, exempt customer A, draft invoice 6100 at 1,000.00", () => {
  it("customer B (taxable, 6%) is picked: the draft bills B at 1,060.00 in the same save", async () => {
    const env = world(job(), [invoice()]);
    const out = await save(env, { account_id: B, site_id: B_SITE });
    expect(ticketNow(env)).toMatchObject({ account_id: B, customer_name: "Other Made Up Tires" });
    expect(invoiceNow(env)).toMatchObject({
      status: "draft",
      tax_rate: 0.06,
      subtotal: 1000,
      tax_amount: 60,
      total: 1060,
      cost_total: 410,
      updated_by_name: "Mona Manager",
    });
    expect(invoiceNow(env)["bill_to"]).toMatchObject({
      name: "Other Made Up Tires",
      address1: "40 Tire Way",
      city: "Corbin",
      // The old customer's Sage number is not carried to the new one.
      external_id: "",
    });
    expect(invoiceNow(env)["property"]).toEqual({
      name: "Tire shop",
      address: "40 Tire Way, Corbin, KY",
    });
    expect(out["invoice_notes"]).toEqual([
      "Draft invoice 6100 now bills Other Made Up Tires. Its tax went from 0% to 6%.",
    ]);
    expect(out["invoice_problem"]).toBeUndefined();
  });

  it("the other way: a taxable customer's draft given to the exempt one loses its tax", async () => {
    const env = world(
      job({ account_id: B, site_id: B_SITE, customer_name: "Other Made Up Tires" }),
      [
        invoice({
          bill_to: { name: "Other Made Up Tires" },
          tax_rate: 0.06,
          tax_amount: 60,
          total: 1060,
        }),
      ],
    );
    const out = await save(env, { account_id: A, site_id: A_SITE });
    expect(invoiceNow(env)).toMatchObject({ tax_rate: 0, tax_amount: 0, total: 1000 });
    expect(invoiceNow(env)["bill_to"]).toMatchObject({ name: "Made Up School Board" });
    expect(out["invoice_notes"]).toEqual([
      "Draft invoice 6100 now bills Made Up School Board. Its tax went from 6% to 0%.",
    ]);
  });

  it("the invoice is Final: the change is refused with its number, and nothing is written", async () => {
    const env = world(job(), [invoice({ status: "final" })]);
    await expect(save(env, { account_id: B, site_id: B_SITE })).rejects.toThrow(
      "This ticket has an invoice that is already final (invoice 6100). Make the invoice void first, then change the customer.",
    );
    expect(ticketNow(env)).toMatchObject({ account_id: A, site_id: A_SITE });
    expect(invoiceNow(env)).toMatchObject({ total: 1000, tax_rate: 0 });
    expect(env.writes).toEqual([]);
  });

  it("the invoice is Paid: refused the same way", async () => {
    const env = world(job(), [invoice({ status: "paid" })]);
    await expect(save(env, { account_id: B, site_id: B_SITE })).rejects.toThrow(
      "This ticket has an invoice that is already paid (invoice 6100). Make the invoice void first, then change the customer.",
    );
    expect(env.writes).toEqual([]);
  });

  it("a final invoice and a second draft: refused, the draft is not touched either", async () => {
    const env = world(job(), [
      invoice({ status: "final" }),
      invoice({ id: INV2, display_number: "6100.2" }),
    ]);
    await expect(save(env, { account_id: B, site_id: B_SITE })).rejects.toThrow(/invoice 6100\)/);
    expect(invoiceNow(env, INV2)).toMatchObject({ total: 1000 });
    expect(env.writes).toEqual([]);
  });

  it("a void invoice is nobody's business: the customer changes as before", async () => {
    const env = world(job({ invoice_id: null }), [invoice({ status: "void" })]);
    const out = await save(env, { account_id: B, site_id: B_SITE });
    expect(ticketNow(env)).toMatchObject({ account_id: B });
    expect(writesTo(env, "invoices")).toEqual([]);
    expect(out["invoice_notes"]).toBeUndefined();
  });

  it("no invoice at all: the customer changes as before, and nothing is said", async () => {
    const env = world(job({ invoice_id: null }), []);
    const out = await save(env, { account_id: B, site_id: B_SITE });
    expect(ticketNow(env)).toMatchObject({ account_id: B, site_id: B_SITE });
    expect(out["invoice_notes"]).toBeUndefined();
  });

  it("a save that changes neither the customer nor the property leaves the draft alone", async () => {
    // The office typed the draft's tax by hand; an ordinary ticket save must not undo that.
    const env = world(job(), [invoice({ tax_rate: 0.03, tax_amount: 30, total: 1030 })]);
    const out = await save(env, { account_id: A, site_id: A_SITE, description: "Edited" });
    expect(ticketNow(env)).toMatchObject({ description: "Edited" });
    expect(writesTo(env, "invoices")).toEqual([]);
    expect(out["invoice_notes"]).toBeUndefined();
  });

  it("a draft billed to a vendor keeps its Bill To and its tax, and takes the property", async () => {
    const env = world(job(), [
      invoice({
        bill_to: { name: "Made Up Roof Supply" },
        bill_to_vendor_id: VENDOR,
        tax_rate: 0.06,
        tax_amount: 60,
        total: 1060,
      }),
    ]);
    const out = await save(env, { account_id: B, site_id: B_SITE });
    expect(invoiceNow(env)).toMatchObject({ tax_rate: 0.06, total: 1060 });
    expect(invoiceNow(env)["bill_to"]).toEqual({ name: "Made Up Roof Supply" });
    expect(invoiceNow(env)["property"]).toMatchObject({ name: "Tire shop" });
    expect(out["invoice_notes"]).toEqual([
      "Draft invoice 6100 is billed to a vendor, so its Bill To was not changed. Its property now reads Tire shop.",
    ]);
  });
});

describe("another property of the same customer", () => {
  it("a draft's property follows; its Bill To and its typed tax stay", async () => {
    const env = world(job(), [invoice({ tax_rate: 0.03, tax_amount: 30, total: 1030 })]);
    const out = await save(env, { account_id: A, site_id: A_SITE2 });
    expect(ticketNow(env)).toMatchObject({ site_id: A_SITE2, site_name: "South school" });
    expect(invoiceNow(env)["property"]).toEqual({
      name: "South school",
      address: "2 Made Up Rd, London, KY",
    });
    expect(invoiceNow(env)).toMatchObject({ tax_rate: 0.03, tax_amount: 30, total: 1030 });
    expect(invoiceNow(env)["bill_to"]).toMatchObject({
      name: "Made Up School Board",
      external_id: "SCH01",
    });
    expect(out["invoice_notes"]).toEqual([
      "Draft invoice 6100 now shows the property South school.",
    ]);
  });
  it("a final invoice is left as it was sent, the ticket is saved, and the save says so", async () => {
    const env = world(job(), [invoice({ status: "final" })]);
    const out = await save(env, { account_id: A, site_id: A_SITE2 });
    expect(ticketNow(env)).toMatchObject({ site_id: A_SITE2 });
    expect(writesTo(env, "invoices")).toEqual([]);
    expect(out["invoice_notes"]).toEqual([
      "Invoice 6100 is already final and was not changed: it keeps what it was sent with.",
    ]);
  });
});

describe("who may", () => {
  it("someone who cannot work with invoices does not change the customer of a ticket that has one", async () => {
    const env = world(job(), [invoice()]);
    await expect(save(env, { account_id: B, site_id: B_SITE }, OFFICE)).rejects.toThrow(
      CUSTOMER_CHANGE_NEEDS_INVOICES,
    );
    expect(env.writes).toEqual([]);
  });
  it("the same person still changes the customer of a ticket with no invoice", async () => {
    const env = world(job({ invoice_id: null, stage: "scheduled" }), []);
    await save(env, { account_id: B, site_id: B_SITE }, OFFICE);
    expect(ticketNow(env)).toMatchObject({ account_id: B });
  });
  it("and still saves a ticket that has an invoice when the customer stays", async () => {
    const env = world(job(), [invoice()]);
    await save(env, { account_id: A, site_id: A_SITE, description: "Edited" }, OFFICE);
    expect(ticketNow(env)).toMatchObject({ description: "Edited", account_id: A });
  });
});

describe("what Nov 25 decided is kept", () => {
  it("a customer is still never just taken off", async () => {
    const env = world(job(), [invoice()]);
    await expect(
      save(env, { account_id: null, site_id: null, customer_name: "Made Up School Board" }),
    ).rejects.toThrow(customerTakenOffMessage("Made Up School Board"));
    expect(env.writes).toEqual([]);
  });
  it("a plan inspection ticket still cannot move", async () => {
    const env = world(job({ roof_care_visit_id: "99999999-9999-4999-8999-999999999999" }), []);
    await expect(save(env, { account_id: B, site_id: B_SITE })).rejects.toThrow(
      "It cannot be moved to another property",
    );
  });
  it("a ticket from before customer profiles is linked, final invoice or not; a draft takes the profile", async () => {
    const old = () => job({ account_id: null, site_id: null, site_name: null, site_address: null });
    const sent = world(old(), [invoice({ status: "final" })]);
    const out = await save(sent, { account_id: B, site_id: B_SITE });
    expect(ticketNow(sent)).toMatchObject({ account_id: B });
    expect(writesTo(sent, "invoices")).toEqual([]);
    expect(out["invoice_notes"]).toEqual([
      "Invoice 6100 is already final and was not changed: it keeps what it was sent with.",
    ]);
    const draft = world(old(), [invoice({ bill_to: { name: "Made Up School Board" } })]);
    await save(draft, { account_id: B, site_id: B_SITE });
    expect(invoiceNow(draft)).toMatchObject({ tax_rate: 0.06, total: 1060 });
    expect(invoiceNow(draft)["bill_to"]).toMatchObject({ name: "Other Made Up Tires" });
  });
});

describe("a technician's notes save does not write the customer", () => {
  // The technician opened the ticket while it was customer A's. The office then changed it to
  // customer B. The technician's page still holds A and saves the notes.
  const stalePage = job();
  const officeChanged = () =>
    job({
      account_id: B,
      site_id: B_SITE,
      customer_name: "Other Made Up Tires",
      site_name: "Tire shop",
      site_address: "40 Tire Way, Corbin, KY",
      site_city: "Corbin",
      stage: "scheduled",
      invoice_id: null,
    });
  const techSave = (env: Env) =>
    save(env, fieldNotesInput(stalePage as never, "Gate code 12. Dog in the yard.") as Row, TECH);

  it("the ticket stays with customer B, and the notes are saved", async () => {
    const env = world(officeChanged(), []);
    await techSave(env);
    expect(ticketNow(env)).toMatchObject({
      account_id: B,
      site_id: B_SITE,
      customer_name: "Other Made Up Tires",
      site_name: "Tire shop",
      site_address: "40 Tire Way, Corbin, KY",
      site_city: "Corbin",
      notes: "Gate code 12. Dog in the yard.",
    });
    const write = writesTo(env, "service_jobs")[0]!;
    for (const column of [
      "account_id",
      "site_id",
      "contact_id",
      "customer_name",
      "site_name",
      "site_address",
      "site_city",
      "site_state",
      "location_id",
      "location_name",
    ])
      expect(write.payload).not.toHaveProperty(column);
  });
  it("and it never reaches the invoices", async () => {
    const env = world({ ...officeChanged(), invoice_id: INV }, [
      invoice({
        bill_to: { name: "Other Made Up Tires" },
        tax_rate: 0.06,
        tax_amount: 60,
        total: 1060,
      }),
    ]);
    const out = await techSave(env);
    expect(ticketNow(env)).toMatchObject({ account_id: B });
    expect(writesTo(env, "invoices")).toEqual([]);
    expect(out["invoice_notes"]).toBeUndefined();
  });
  it("a customer the technician can no longer read does not fail the notes save", async () => {
    // The page's old customer was deleted since: its id is not looked up at all.
    const env = world(officeChanged(), [], {
      crm_accounts: [{ id: B, name: "Other Made Up Tires", tax_exempt: false }],
    });
    await techSave(env);
    expect(ticketNow(env)).toMatchObject({
      account_id: B,
      notes: "Gate code 12. Dog in the yard.",
    });
  });
});

describe("the screen and the code", () => {
  const page = flat("src/components/service-page.tsx");
  const fn = flat("src/lib/service.functions.ts");
  const inv = flat("src/lib/invoices.functions.ts");

  it("the screen stops a change that a final invoice forbids, before the save is sent", () => {
    expect(page).toContain(
      "if (invoiceStop) { toast.error(invoiceStop, { duration: 15_000 }); return; }",
    );
    // After the customer-taken-off check of Nov 25, which stays.
    expect(page.indexOf("if (takenOff) {")).toBeLessThan(page.indexOf("if (invoiceStop) {"));
    expect(page.indexOf("if (invoiceStop) {")).toBeLessThan(page.indexOf("save.mutate();"));
  });
  it("the screen says under the customer what the save will do to each invoice", () => {
    expect(page).toContain("data-ticket-invoice-warning");
    expect(page).toContain("customerChangeWarnings(whomChange, liveTicketInvoices)");
    // Asked only once another customer or property is picked, from the invoice card's own list.
    expect(page).toContain('queryKey: ticketInvoicesKey(job?.id ?? "new"),');
    expect(page).toContain("enabled: !!session && !!job && worksInvoices && !!whomChange,");
  });
  it("the screen says what became of the invoice after the save", () => {
    expect(page).toContain(
      "for (const note of row.invoice_notes ?? []) toast.success(note, { duration: 15_000 });",
    );
    expect(page).toContain(
      "if (row.invoice_problem) toast.error(row.invoice_problem, { duration: 30_000 });",
    );
  });
  it("the server asks the rule before it writes anything", () => {
    const ask = fn.indexOf("await ticketCustomerOnInvoices(sb, {");
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(
      fn.indexOf('await saveOfficeInstructions(sb, id, instructions, "before"'),
    );
    expect(fn).toContain("has_invoice: !!cur.invoice_id,");
    expect(inv).toContain(
      "if (!seesInvoices(input.by)) { if (input.has_invoice) throw new Error(CUSTOMER_CHANGE_NEEDS_INVOICES); return { follow: async () => [] }; }",
    );
  });
  it("a new invoice and a followed draft take their copy from one place, and total with the invoice's own totals", () => {
    expect(inv.match(/customerCopy\(/g)).toHaveLength(3);
    expect(inv).toContain("...totals(lines, taxTo),");
    expect(inv).toContain("await syncPlanLines(sb, { ...inv, tax_rate: taxTo }, lines);");
    // Only a draft is ever written.
    expect(inv).toContain('.eq("id", inv.id) .eq("status", "draft")');
  });
});
