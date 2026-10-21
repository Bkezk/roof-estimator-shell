/**
 * Owner, Oct 21: "if managers move a ticket back to scheduled from done does it reappear on the
 * tech's My tickets list and can they edit it?" It does (myDay lists Open / Scheduled tickets of
 * theirs) and they can (their stages); but the stage picker left the first visit's close-out
 * stamp on the ticket, so the Close-out fold read "Done <date>" on a Scheduled ticket and the
 * second Complete never logged "Service done" again. Now a move back to Open / Scheduled clears
 * completed_at (ticket-stage.ts reopensTicket; setServiceStage), as the technician's Undo does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));
vi.mock("@/lib/ticket-events.server", () => ({
  afterTicketStage: vi.fn(async () => {}),
  afterTicketDispatch: vi.fn(async () => {}),
}));
vi.mock("@/lib/service-crew.server", () => ({
  syncCrewLead: vi.fn(async () => {}),
  writeCrew: vi.fn(async () => 0),
  readCrew: vi.fn(async () => []),
}));

import { setServiceStage } from "@/lib/service.functions";
import { reopensTicket } from "@/lib/ticket-stage";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const MGR = "3c3c3c3c-3c3c-43c3-83c3-3c3c3c3c3c3c";
const TECH = "7e7e7e7e-7e7e-47e7-87e7-7e7e7e7e7e7e";
const JOB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DONE_AT = "2026-10-15T20:10:00Z";

describe("reopensTicket: back to the working stages from Done or an office stage", () => {
  it("Done → Scheduled / Open reopens; Authorized → Scheduled too", () => {
    expect(reopensTicket("done", "scheduled")).toBe(true);
    expect(reopensTicket("done", "open")).toBe(true);
    expect(reopensTicket("authorized", "scheduled")).toBe(true);
    expect(reopensTicket("closed", "open")).toBe(true);
  });
  it("forward moves, office-to-office moves and Done itself do not", () => {
    expect(reopensTicket("scheduled", "done")).toBe(false);
    expect(reopensTicket("open", "scheduled")).toBe(false);
    expect(reopensTicket("done", "authorized")).toBe(false);
    expect(reopensTicket("invoiced", "authorized")).toBe(false);
    expect(reopensTicket("done", "done")).toBe(false);
    expect(reopensTicket(null, "scheduled")).toBe(false);
  });
});

describe("setServiceStage by a manager", () => {
  const setup = (stage: string) =>
    fakeSupabase({
      profiles: [
        { id: MGR, role: "manager", access: [], technician: false, full_name: "Mia", email: "m@x" },
        {
          id: TECH,
          role: "user",
          access: ["service"],
          technician: true,
          full_name: "Ted",
          email: "t@x",
        },
      ],
      service_jobs: [
        {
          id: JOB,
          number: 6010,
          customer_name: "Bell County Schools",
          description: "Leak over the gym",
          service_type: "leak",
          stage,
          technician_id: TECH,
          scheduled_date: "2026-10-15",
          completed_at: DONE_AT,
          field_status: null,
          helper_count: 0,
          account_id: null,
          deleted_at: null,
          created_at: "2026-10-01T12:00:00Z",
          updated_at: "2026-10-15T20:10:00Z",
        },
      ],
      service_job_events: [],
      crm_followups: [],
      crm_settings: [{ id: 1, ticket_first_days: 1, ticket_every_days: 3 }],
    });
  const call = (env: ReturnType<typeof fakeSupabase>, stage: string) =>
    (setServiceStage as unknown as (a: { data: Row; context: unknown }) => Promise<void>)({
      data: { id: JOB, stage },
      context: { supabase: env.db, userId: MGR },
    });

  it("Done → Scheduled: the stage moves and the close-out stamp is cleared", async () => {
    const env = setup("done");
    await call(env, "scheduled");
    const row = env.tables["service_jobs"]![0]!;
    expect(row["stage"]).toBe("scheduled");
    expect(row["completed_at"]).toBeNull();
    const write = env.writes.find((w) => w.table === "service_jobs");
    expect(write?.payload).toMatchObject({ stage: "scheduled", completed_at: null });
  });
  it("Done → Authorized: the stamp stays (the visit happened; the office is moving it on)", async () => {
    const env = setup("done");
    await call(env, "authorized");
    const row = env.tables["service_jobs"]![0]!;
    expect(row["stage"]).toBe("authorized");
    expect(row["completed_at"]).toBe(DONE_AT);
    const write = env.writes.find((w) => w.table === "service_jobs");
    expect(write?.payload).not.toHaveProperty("completed_at");
  });
  it("Authorized → Scheduled (a manager pulling it back for more work): cleared as well", async () => {
    const env = setup("authorized");
    await call(env, "scheduled");
    expect(env.tables["service_jobs"]![0]!["completed_at"]).toBeNull();
  });
});

describe("source", () => {
  it("setServiceStage clears the stamp through reopensTicket, in the same write as the stage", () => {
    const src = readFileSync("src/lib/service.functions.ts", "utf8");
    expect(src).toContain("const reopened = reopensTicket(prev?.stage, data.stage);");
    expect(src).toMatch(
      /\.update\(\{\s*stage: data\.stage,\s*updated_by_name: nameOf\(p\),\s*\.\.\.\(reopened \? \{ completed_at: null \} : \{\}\),\s*\}\)/,
    );
  });
  it("the technician's own Undo already clears it the same way (the twin this follows)", () => {
    const src = readFileSync("src/lib/service-field.functions.ts", "utf8");
    expect(src).toContain(
      'patch = { stage: "scheduled", field_status: "on_site", completed_at: null };',
    );
  });
});
