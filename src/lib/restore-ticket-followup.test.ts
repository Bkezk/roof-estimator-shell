/**
 * Restoring a deleted ticket re-syncs its follow-up timer (owner, Oct 12, item 5). deleteServiceJob
 * closes the ticket's follow-ups ("deleted"); restoreServiceJob used to clear deleted_at and
 * nothing else, so a restored ticket came back without its timer (the technician was never
 * reminded again) and a restored Done ticket without its Authorize timer (it vanished from Needs
 * authorization). Now the restore runs the same syncTicketFollowup a save does, with the stage
 * unchanged and `quiet` (followups.server.ts SyncArgs): the technician never heard of the delete,
 * so no second "assigned" notice. The real server functions against the in-memory stand-in
 * (src/test/fake-supabase.ts); ticket-events.server.ts runs for real so the Authorize timer is seen
 * to come back through afterTicketStage.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const notify = vi.hoisted(() =>
  vi.fn<(ids: string[], msg: { kind: string; title: string }, sb: unknown) => Promise<number>>(
    async () => 1,
  ),
);
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify,
}));

import { shapeForKind } from "@/lib/access";
import { deleteServiceJob, restoreServiceJob } from "@/lib/service.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const MANAGER = "3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a";
const OFFICE = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const TECH = "7e7e7e7e-7e7e-47e7-87e7-7e7e7e7e7e7e";
const ACC = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const SCHEDULED = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
const DONE = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2";
const NOBODY = "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3";

const job = (over: Row): Row => ({
  number: 6010,
  account_id: ACC,
  site_id: null,
  customer_name: "Bell County Schools",
  description: "Leak over the gym",
  service_type: "leak",
  stage: "scheduled",
  technician_id: TECH,
  scheduled_date: "2026-10-20",
  helper_count: 0,
  deleted_at: null,
  created_by: OFFICE,
  created_at: "2026-10-01T12:00:00Z",
  updated_at: "2026-10-01T12:00:00Z",
  ...over,
});

let env: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  notify.mockClear();
  env = fakeSupabase({
    profiles: [
      { id: MANAGER, ...shapeForKind("manager", false), full_name: "Mia Manager", email: "m@x" },
      { id: OFFICE, ...shapeForKind("office", false), full_name: "Olive Office", email: "o@x" },
      { id: TECH, ...shapeForKind("technician", true), full_name: "Ted Tech", email: "t@x" },
    ],
    service_jobs: [
      job({ id: SCHEDULED }),
      job({
        id: DONE,
        number: 6011,
        stage: "done",
        completed_at: "2026-10-10T16:00:00Z",
        stage_changed_at: "2026-10-10T16:00:00Z",
      }),
      job({ id: NOBODY, number: 6012, stage: "open", technician_id: null, scheduled_date: null }),
    ],
    crm_followups: [
      {
        id: "f-ticket",
        kind: "ticket",
        item_id: SCHEDULED,
        account_id: ACC,
        assignee_id: TECH,
        title: "Ticket #6010 Bell County Schools — Leak over the gym",
        url: `/service?id=${SCHEDULED}`,
        status: "open",
        due_at: "2026-10-20T12:00:00Z",
        next_remind_at: "2026-10-20T12:00:00Z",
        every_days: 3,
        reminders_sent: 0,
        snoozed_until: null,
        created_by: OFFICE,
      },
      {
        id: "f-authorize",
        kind: "invoice",
        item_id: DONE,
        account_id: ACC,
        assignee_id: OFFICE,
        title: "Authorize Ticket #6011 Bell County Schools — Leak over the gym",
        url: `/service?id=${DONE}`,
        status: "open",
        due_at: "2026-10-11T12:00:00Z",
        next_remind_at: "2026-10-11T12:00:00Z",
        every_days: 3,
        reminders_sent: 0,
        snoozed_until: null,
        created_by: TECH,
      },
    ],
    crm_settings: [{ id: 1, ticket_first_days: 1, ticket_every_days: 3 }],
    service_job_events: [],
  });
});
const callAs = (fn: unknown, userId: string, data: Row) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<void>)({
    data,
    context: { supabase: env.db, userId },
  });
const followups = (itemId: string) =>
  (env.tables["crm_followups"] ?? []).filter((f) => f["item_id"] === itemId);
// A row syncFollowup inserts carries no status: the database defaults it to 'open'
// (20260927100000_crm_followups.sql); the stand-in applies no defaults.
const openOnes = (itemId: string) =>
  followups(itemId).filter((f) => (f["status"] ?? "open") === "open");
const jobRow = (id: string) => (env.tables["service_jobs"] ?? []).find((j) => j["id"] === id)!;

describe("a Scheduled ticket with a technician", () => {
  it("delete closes its timer; restore opens one again for the technician — quietly", async () => {
    await callAs(deleteServiceJob, MANAGER, { id: SCHEDULED });
    expect(jobRow(SCHEDULED)["deleted_at"]).toBeTruthy();
    expect(openOnes(SCHEDULED)).toEqual([]);
    expect(followups(SCHEDULED)[0]).toMatchObject({ status: "closed", closed_reason: "deleted" });

    await callAs(restoreServiceJob, MANAGER, { id: RESTORE_ID(SCHEDULED) });

    expect(jobRow(SCHEDULED)["deleted_at"]).toBeNull();
    expect(jobRow(SCHEDULED)["updated_by_name"]).toBe("Mia Manager");
    const open = openOnes(SCHEDULED);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      kind: "ticket",
      assignee_id: TECH,
      title: "Ticket #6010 Bell County Schools — Leak over the gym",
      due_at: "2026-10-20T12:00:00.000Z",
      every_days: 3,
    });
    // No "Ticket assigned to you" for a ticket that was theirs all along (SyncArgs.quiet).
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("a Done ticket", () => {
  it("restore brings its Authorize timer back (afterTicketStage, the stage unchanged: no fresh Done broadcast)", async () => {
    await callAs(deleteServiceJob, MANAGER, { id: DONE });
    expect(openOnes(DONE)).toEqual([]);
    expect(followups(DONE)[0]).toMatchObject({ status: "closed", closed_reason: "deleted" });

    await callAs(restoreServiceJob, MANAGER, { id: DONE });
    expect(jobRow(DONE)["deleted_at"]).toBeNull();
    const open = openOnes(DONE);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      kind: "invoice",
      assignee_id: OFFICE,
      title: "Authorize Ticket #6011 Bell County Schools — Leak over the gym",
    });
    // No ticket timer for a Done ticket (its technician's part is finished).
    expect(open.filter((f) => f["kind"] === "ticket")).toEqual([]);
    // The stage did not change, so nobody hears "is done — ready for your review" again; the one
    // authorizer the timer lands on is told it is theirs (the timer's own start notice).
    expect(notify.mock.calls.map((c) => c[1].kind)).toEqual(["assigned"]);
    expect(notify.mock.calls[0]![0]).toEqual([OFFICE]);
  });
});

describe("a ticket with no technician", () => {
  it("restore clears deleted_at and opens no timer", async () => {
    await callAs(deleteServiceJob, MANAGER, { id: NOBODY });
    await callAs(restoreServiceJob, MANAGER, { id: NOBODY });
    expect(jobRow(NOBODY)["deleted_at"]).toBeNull();
    expect(followups(NOBODY)).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
  it("only a manager restores (as before)", async () => {
    await expect(callAs(restoreServiceJob, OFFICE, { id: NOBODY })).rejects.toThrow(
      "Ask a manager to restore a ticket",
    );
  });
});

describe("source", () => {
  it("restoreServiceJob runs syncTicketFollowup with the stage unchanged and quiet; the option reaches syncFollowup", () => {
    const src = readFileSync("src/lib/service.functions.ts", "utf8");
    const fn = src.slice(src.indexOf("export const restoreServiceJob"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    expect(body).toContain(".update({ deleted_at: null, updated_by_name: nameOf(p) })");
    expect(body).toContain('.select("*")');
    expect(body.replace(/\s+/g, " ")).toContain(
      "syncTicketFollowup( row, { id: context.userId, name: nameOf(p) }, context.supabase, row.stage, undefined, { quiet: true }, )",
    );
    const sync = src.slice(src.indexOf("async function syncTicketFollowup"));
    expect(sync.slice(0, 1800)).toContain("opts: { quiet?: boolean } = {}");
    expect(sync.slice(0, 1800)).toContain("...(opts.quiet ? { quiet: true } : {})");
  });
});

/** The id as the route sends it (a uuid); here just the row's. */
function RESTORE_ID(id: string) {
  return id;
}
