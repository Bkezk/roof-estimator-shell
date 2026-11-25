/**
 * A ticket keeps its customer (owner, Nov 25, 2026: "go with solution A on number 1").
 *
 * That morning a ticket was opened, "Change" was pressed beside its customer, nobody was picked
 * and Save was pressed. The form sent no customer with the old name as text, and the server
 * took it: the ticket lost its customer and its property and kept the name only as words. The
 * history showed "account … → —; property … → —".
 *
 * Now that save is refused on the screen and on the server, in the same words, and the screen
 * offers the ticket's own customer back. Changing to another customer is as it was, and so is a
 * ticket from before customer profiles that never had one.
 *
 * Every name here is made up.
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

import { saveServiceJob } from "@/lib/service.functions";
import {
  customerTakenOffMessage,
  customerTakenOffProblem,
  keepCustomerLabel,
} from "@/lib/ticket-form";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const SITE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_SITE = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";

const job = (over: Row = {}): Row => ({
  id: JOB,
  number: 6200,
  customer_name: "Made Up Holdings",
  account_id: ACCT,
  site_id: SITE,
  site_name: "North building",
  site_address: "1 Made Up Rd, London, KY 40741",
  description: "Roof check",
  service_type: "inspection",
  stage: "scheduled",
  technician_id: null,
  scheduled_date: "2026-11-30",
  completed_at: null,
  field_status: null,
  helper_count: 0,
  invoice_id: null,
  deleted_at: null,
  roof_care_visit_id: null,
  notes_tech_visible: false,
  created_at: "2026-11-10T12:00:00Z",
  updated_at: "2026-11-10T12:00:00Z",
  ...over,
});
const world = (j: Row) =>
  fakeSupabase({
    profiles: [{ id: ADMIN, role: "admin", access: [], technician: false, full_name: "Ann Admin" }],
    service_jobs: [j],
    crm_accounts: [
      { id: ACCT, name: "Made Up Holdings" },
      { id: OTHER, name: "Other Made Up Tires" },
    ],
    crm_sites: [
      { id: SITE, account_id: ACCT, name: "North building", city: "London", state: "KY" },
      { id: OTHER_SITE, account_id: OTHER, name: "Tire shop", city: "Corbin", state: "KY" },
    ],
    service_job_events: [],
    crm_followups: [],
    crm_opportunities: [],
    invoices: [],
    crm_settings: [{ id: 1, ticket_first_days: 1, ticket_every_days: 3 }],
  });
type Env = ReturnType<typeof world>;
const save = (env: Env, data: Row) =>
  (saveServiceJob as unknown as (a: { data: Row; context: unknown }) => Promise<Row>)({
    data: {
      id: JOB,
      description: "Roof check",
      service_type: "inspection",
      scheduled_date: "2026-11-30",
      ...data,
    },
    context: { supabase: env.db, userId: ADMIN },
  });
const ticketNow = (env: Env) => env.tables["service_jobs"]![0]!;

beforeEach(() => vi.clearAllMocks());

describe("the rule", () => {
  it("a linked ticket saved with no customer is a problem, and names who was taken off", () => {
    expect(
      customerTakenOffProblem(
        { account_id: ACCT, customer_name: "Made Up Holdings" },
        { account_id: null },
      ),
    ).toBe(
      "Pick a customer before saving. Made Up Holdings was taken off this ticket and no other customer was picked, so nothing was saved.",
    );
    expect(customerTakenOffProblem({ account_id: ACCT }, { account_id: undefined })).toBe(
      customerTakenOffMessage(null),
    );
  });
  it("changing to another customer, or keeping the same one, is fine", () => {
    expect(customerTakenOffProblem({ account_id: ACCT }, { account_id: OTHER })).toBeNull();
    expect(customerTakenOffProblem({ account_id: ACCT }, { account_id: ACCT })).toBeNull();
  });
  it("a ticket that never had a customer profile is as it was", () => {
    expect(customerTakenOffProblem({ account_id: null }, { account_id: null })).toBeNull();
    expect(customerTakenOffProblem({ account_id: null }, { account_id: OTHER })).toBeNull();
  });
  it("the way back names the customer", () => {
    expect(keepCustomerLabel("Made Up Holdings")).toBe("Keep Made Up Holdings");
    expect(keepCustomerLabel("  ")).toBe("Keep the customer it has");
  });
});

describe("the server", () => {
  it("refuses the save that took ticket 6069's customer off, and writes nothing", async () => {
    const env = world(job());
    // What the form sent that morning: no customer, the old name as text.
    await expect(
      save(env, { account_id: null, site_id: null, customer_name: "Made Up Holdings" }),
    ).rejects.toThrow(customerTakenOffMessage("Made Up Holdings"));
    expect(ticketNow(env)).toMatchObject({
      account_id: ACCT,
      site_id: SITE,
      site_name: "North building",
      customer_name: "Made Up Holdings",
    });
    expect(env.writes.filter((w) => w.table === "service_jobs")).toEqual([]);
  });
  it("still changes a ticket to another customer", async () => {
    const env = world(job());
    await save(env, { account_id: OTHER, site_id: OTHER_SITE });
    expect(ticketNow(env)).toMatchObject({
      account_id: OTHER,
      site_id: OTHER_SITE,
      customer_name: "Other Made Up Tires",
      site_name: "Tire shop",
    });
  });
  it("still saves a ticket from before customer profiles under its typed name", async () => {
    const env = world(
      job({ account_id: null, site_id: null, site_name: null, site_address: null }),
    );
    await save(env, { account_id: null, customer_name: "Made Up Holdings", description: "Edited" });
    expect(ticketNow(env)).toMatchObject({ account_id: null, description: "Edited" });
  });
});

describe("the screen", () => {
  const page = flat("src/components/service-page.tsx");
  it("does not send that save: it says why", () => {
    expect(page).toContain(
      "const takenOff = job ? customerTakenOffProblem(job, { account_id: draft.customer?.account_id ?? null }) : null; if (takenOff) { toast.error(takenOff, { duration: 15_000 }); return; }",
    );
  });
  it("offers the ticket's own customer back under the empty search box", () => {
    expect(page).toContain('data-action="ticket-keep-customer"');
    expect(page).toContain("{keepCustomerLabel(job.customer_name)}");
    expect(page).toContain("const back = draftFrom(job);");
  });
  it("the server asks the same rule, with the ticket as it is saved", () => {
    const fn = flat("src/lib/service.functions.ts");
    expect(fn).toContain(
      "const takenOff = customerTakenOffProblem(cur, patch); if (takenOff) throw new Error(takenOff);",
    );
  });
});
