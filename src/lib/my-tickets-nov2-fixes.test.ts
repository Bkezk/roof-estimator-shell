/**
 * My tickets, Nov 2 (the owner, after the audit in docs/qa/my-tickets-audit-2026-11-02.md):
 *
 *  1. "History here: 2 earlier tickets, last Nov 5 (… — coming up)": the history strip and the
 *     History fold counted every other live ticket at the property, a ticket booked three days
 *     ahead included. Migration 20261102170000 gives the two database functions one rule,
 *     ticket_is_history(stage, scheduled_date): a ticket is history unless it is still Open /
 *     Scheduled for today or later, or undated. Pinned here by the migration's text; the live
 *     proof is in the audit record.
 *  2. The stage on a clock press: Start travel and On site move an Open ticket to Scheduled (as
 *     the Oct 8 buttons did). Changed on Nov 2 on a misreading of the owner, and put back the same
 *     afternoon ("sorry misunderstood, start travel and on site should do that"): pinned here so it
 *     is not taken for a leftover again.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/ticket-events.server", () => ({
  afterTicketStage: vi.fn(async () => {}),
  afterTicketDispatch: vi.fn(async () => {}),
}));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));
vi.mock("@/lib/service-crew.server", () => ({
  syncCrewLead: vi.fn(async () => {}),
  writeCrew: vi.fn(async () => 0),
  readCrew: vi.fn(async () => []),
}));

import { setFieldStatus, type FieldStatusResult } from "@/lib/service-field.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");

describe("1. history at a property counts only what has happened (migration 20261102170000)", () => {
  const sql = (() => {
    try {
      return read("supabase/migrations/20261102170000_site_history_past_only.sql");
    } catch {
      return "";
    }
  })();
  it("one rule: not (Open / Scheduled and (undated or booked today or later)), on the office's day", () => {
    expect(sql).toContain(
      "create or replace function public.ticket_is_history(p_stage text, p_scheduled_date date)",
    );
    expect(sql.replace(/\s+/g, " ")).toContain(
      "select not ( p_stage in ('open', 'scheduled') and (p_scheduled_date is null or p_scheduled_date >= (now() at time zone 'America/New_York')::date) );",
    );
  });
  it("both functions carry it on every read of the site's other tickets: the fold's list, the count, the photo count, the last one", () => {
    const fold = sql.slice(
      sql.indexOf("create or replace function public.site_history("),
      sql.indexOf("create or replace function public.site_history_summary("),
    );
    const strip = sql.slice(sql.indexOf("create or replace function public.site_history_summary("));
    const rule = /and public\.ticket_is_history\(j\.stage, j\.scheduled_date\)/g;
    expect(fold.match(rule)).toHaveLength(1);
    expect(strip.match(rule)).toHaveLength(3);
    // Every where-clause over the site's tickets has it: none is left as it was.
    for (const part of [fold, strip])
      for (const m of part.matchAll(
        /where j\.site_id = v_site and j\.id <> p_job_id and j\.deleted_at is null([^;]*)/g,
      ))
        expect(m[1]).toContain("ticket_is_history");
  });
});

describe("2. a clock press on an Open ticket moves it to Scheduled (the owner, Nov 2: on purpose)", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "11111111-1111-4111-8111-222222222222";
  const TECH = "22222222-2222-4222-8222-222222222222";
  const T0 = new Date("2026-11-02T13:00:00Z");
  const job = (id: string, number: number, stage: string): Row => ({
    id,
    number,
    customer_name: "Acme",
    service_type: "leak",
    technician_id: TECH,
    stage,
    field_status: null,
    en_route_at: null,
    on_site_at: null,
    completed_at: null,
    signature_path: null,
    helper_count: 0,
    scheduled_date: null,
    account_id: null,
    from_opportunity_id: null,
    closing_notes: null,
    description: "No date yet",
  });
  let env: ReturnType<typeof fakeSupabase>;
  const press = (id: string, to: string) =>
    (
      setFieldStatus as unknown as (a: {
        data: Row;
        context: unknown;
      }) => Promise<FieldStatusResult>
    )({
      data: { id, to, day: "2026-11-02" },
      context: { supabase: env.db, userId: TECH },
    });
  const row = (id: string) => env.tables["service_jobs"]!.find((j) => j["id"] === id)!;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    env = fakeSupabase({
      profiles: [
        {
          id: TECH,
          role: "user",
          access: ["service"],
          technician: true,
          full_name: "Ted",
          email: "t@x.test",
        },
      ],
      service_jobs: [job(A, 6046, "open"), job(B, 6047, "open")],
      service_tech_clock: [],
      service_time_entries: [],
      service_job_events: [],
      service_job_crew: [],
      service_job_repairs: [],
      service_job_photos: [],
      crm_contact_log: [],
    });
  });
  afterEach(() => vi.useRealTimers());

  it("Start travel: en route stamped, the ticket Scheduled", async () => {
    const r = await press(A, "en_route");
    expect(r.row.stage).toBe("scheduled");
    expect(row(A)).toMatchObject({ stage: "scheduled", field_status: "en_route" });
  });
  it("On site straight away (no travel): on site stamped, the ticket Scheduled", async () => {
    const r = await press(B, "on_site");
    expect(r.row.stage).toBe("scheduled");
    expect(row(B)).toMatchObject({
      stage: "scheduled",
      field_status: "on_site",
      on_site_at: T0.toISOString(),
    });
  });
  it("the handler's two presses carry the flip; a Scheduled ticket stays Scheduled (the Done press sets Done)", () => {
    const src = read("src/lib/service-field.functions.ts");
    expect(src.split('stage: job.stage === "open" ? "scheduled" : job.stage')).toHaveLength(3);
    expect(src).toContain('{ field_status: null, completed_at: now, stage: "done" }');
  });
});
