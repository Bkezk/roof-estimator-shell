/**
 * The technician's clock on the server and the screens (owner, Oct 15, CenterPoint-style; the
 * rules are tech-clock.ts, tested on their own in tech-clock.test.ts). setFieldStatus moves the
 * one clock row (service_tech_clock) and writes the time entries it closes (source 'clock'):
 * travel → on site → leave; travel to B while on site at A; undo without an entry; Complete with
 * a clock (and still refusing a technician's incomplete close-out); saveTimeEntry with a start
 * and an end. Then the pins: My tickets' banner and buttons, the close-out's line, the time
 * editor's time boxes, myClock. The Oct 8 "no En route / On site buttons" pins are rewritten in
 * done-only-flow.test.ts (owner, Oct 15: the buttons are back as the clock).
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

import {
  TIME_END_BEFORE_START,
  TIME_HOURS_NEEDED,
  addJobNote,
  myClock,
  myDay,
  saveTimeEntry,
  setFieldStatus,
  type FieldStatusResult,
} from "@/lib/service-field.functions";
import { setServiceStage } from "@/lib/service.functions";
import { CLOCK_CLOSING_STAGES, clockStoppedNote } from "@/lib/clock-close.server";
import { MOVED_PRESS, pressLine } from "@/lib/tech-clock";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const A = "11111111-1111-4111-8111-111111111111";
const B = "11111111-1111-4111-8111-222222222222";
const TECH = "22222222-2222-4222-8222-222222222222";
const MATE = "22222222-2222-4222-8222-333333333333";
const STRANGER = "22222222-2222-4222-8222-444444444444";
const MANAGER = "33333333-3333-4333-8333-333333333333";
const DAY = "2026-10-15";
/** 8:00 am Eastern on Oct 15. */
const T0 = new Date("2026-10-15T12:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

const profile = (id: string, over: Row = {}): Row => ({
  id,
  role: "user",
  access: ["service"],
  technician: true,
  full_name: `Person ${id.slice(-1)}`,
  email: `${id.slice(-4)}@example.test`,
  ...over,
});
const profiles: Row[] = [
  profile(TECH, { full_name: "Ted Tech" }),
  profile(MATE, { full_name: "Mia Mate" }),
  profile(STRANGER, { full_name: "Sam Stranger" }),
  profile(MANAGER, { role: "manager", access: [], technician: false, full_name: "Mo Manager" }),
];
const job = (id: string, number: number, over: Row = {}): Row => ({
  id,
  number,
  customer_name: number === 6014 ? "Bell County" : "Acme",
  service_type: "leak",
  technician_id: TECH,
  stage: "scheduled",
  field_status: null,
  en_route_at: null,
  on_site_at: null,
  completed_at: null,
  signature_path: null,
  helper_count: 1,
  scheduled_date: DAY,
  account_id: null,
  from_opportunity_id: null,
  closing_notes: null,
  description: "Leak over gym",
  ...over,
});
/** A ticket whose close-out is whole (repairs with both photos, a signature); no typed time. */
const whole = (id: string) => ({
  service_job_repairs: [{ id: `r-${id}`, service_job_id: id, name: "Seam" }],
  service_job_photos: [
    { id: `p1-${id}`, service_job_id: id, repair_id: `r-${id}`, role: "before" },
    { id: `p2-${id}`, service_job_id: id, repair_id: `r-${id}`, role: "after" },
  ],
});

let env: ReturnType<typeof fakeSupabase>;
function setup(tables: Record<string, Row[]> = {}) {
  env = fakeSupabase({
    profiles,
    service_jobs: [job(A, 6014), job(B, 6012)],
    service_tech_clock: [],
    service_time_entries: [],
    service_job_events: [],
    service_job_crew: [],
    service_job_repairs: [],
    service_job_photos: [],
    crm_contact_log: [],
    ...tables,
  });
  return env;
}
// async, so a validator's throw (zod runs before the handler) is a rejection like any other.
const call = async <T = Row>(fn: unknown, data: Row, userId = TECH) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const press = (id: string, to: string, userId = TECH) =>
  call<FieldStatusResult>(setFieldStatus, { id, to, day: DAY }, userId);
const clocks = () => env.tables["service_tech_clock"]!;
const entries = () => env.tables["service_time_entries"]!;
const jobRow = (id: string) => env.tables["service_jobs"]!.find((j) => j["id"] === id)!;
const events = (id: string) =>
  env.tables["service_job_events"]!.filter((e) => e["service_job_id"] === id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("travel → on site → leave", () => {
  it("writes two entries with source 'clock', the real stamps and the quarter hours; the clock row follows", async () => {
    setup();
    await press(A, "en_route");
    expect(clocks()).toEqual([
      {
        id: expect.any(String),
        technician_id: TECH,
        service_job_id: A,
        kind: "travel",
        started_at: T0.toISOString(),
        helper_count: 1,
      },
    ]);
    expect(jobRow(A)).toMatchObject({ field_status: "en_route", en_route_at: T0.toISOString() });
    expect(entries()).toEqual([]);

    vi.setSystemTime(at(20));
    await press(A, "on_site");
    expect(clocks()).toHaveLength(1);
    expect(clocks()[0]).toMatchObject({ kind: "labor", started_at: at(20).toISOString() });
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({
      service_job_id: A,
      technician_id: TECH,
      kind: "travel",
      started_at: T0.toISOString(),
      ended_at: at(20).toISOString(),
      hours: 0.25,
      helper_count: 1,
      source: "clock",
      on_date: DAY,
      created_by: TECH,
    });
    expect(jobRow(A)).toMatchObject({ field_status: "on_site", on_site_at: at(20).toISOString() });

    vi.setSystemTime(at(95));
    const { row } = await press(A, "leave");
    expect(clocks()).toEqual([]);
    expect(entries()).toHaveLength(2);
    expect(entries()[1]).toMatchObject({
      kind: "labor",
      started_at: at(20).toISOString(),
      ended_at: at(95).toISOString(),
      hours: 1.25,
      source: "clock",
    });
    // Left: neither en route nor on site; the stamps stay for the record.
    expect(row["field_status"]).toBeNull();
    expect(jobRow(A)).toMatchObject({ field_status: null, on_site_at: at(20).toISOString() });
    expect(events(A).map((e) => [e["kind"], e["field_status"], e["note"]])).toEqual([
      ["field", "en_route", null],
      ["field", "on_site", null],
      ["field", null, "left site"],
    ]);
  });
  it("an Open ticket goes Scheduled on Start travel (as the old buttons did)", async () => {
    setup({ service_jobs: [job(A, 6014, { stage: "open" }), job(B, 6012)] });
    await press(A, "en_route");
    expect(jobRow(A)["stage"]).toBe("scheduled");
  });
  it("On site without travel first: labor opens, no travel entry", async () => {
    setup();
    await press(A, "on_site");
    expect(clocks()[0]).toMatchObject({ kind: "labor" });
    expect(entries()).toEqual([]);
    expect(jobRow(A)).toMatchObject({ field_status: "on_site", en_route_at: null });
  });
  it("a mistap — On site a few seconds after Start travel — writes no travel entry", async () => {
    setup();
    await press(A, "en_route");
    vi.setSystemTime(new Date(T0.getTime() + 20_000));
    await press(A, "on_site");
    expect(entries()).toEqual([]);
    expect(clocks()[0]).toMatchObject({ kind: "labor" });
  });
  it("pressing the same button twice changes nothing", async () => {
    setup();
    await press(A, "on_site");
    vi.setSystemTime(at(30));
    await press(A, "on_site");
    expect(clocks()).toHaveLength(1);
    expect(clocks()[0]).toMatchObject({ started_at: T0.toISOString() });
    expect(entries()).toEqual([]);
    expect(events(A)).toHaveLength(1);
  });
  it("the entry's day is the phone's day, moved back when the clock ran over midnight", async () => {
    // On site 10 pm Eastern Oct 14 (02:00Z Oct 15); left 1 am Eastern Oct 15 — the phone says Oct 15.
    vi.setSystemTime(new Date("2026-10-15T02:00:00Z"));
    setup();
    await press(A, "on_site");
    vi.setSystemTime(new Date("2026-10-15T05:00:00Z"));
    await press(A, "leave");
    expect(entries()[0]).toMatchObject({ hours: 3, on_date: "2026-10-14" });
  });
});

describe("travel to B while on site at A", () => {
  it("closes A's labor, clears A's field_status with a 'left site' row, and opens travel to B", async () => {
    setup();
    await press(A, "on_site");
    vi.setSystemTime(at(60));
    const b = (await press(B, "en_route")).row;
    expect(clocks()).toHaveLength(1);
    expect(clocks()[0]).toMatchObject({ service_job_id: B, kind: "travel" });
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({
      service_job_id: A,
      kind: "labor",
      hours: 1,
      source: "clock",
    });
    expect(jobRow(A)).toMatchObject({ field_status: null, on_site_at: T0.toISOString() });
    expect(events(A).at(-1)).toMatchObject({
      kind: "field",
      field_status: null,
      note: "left site",
    });
    expect(b).toMatchObject({ field_status: "en_route", en_route_at: at(60).toISOString() });
  });
  it("travelling to A, then Start travel to B: A's travel entry is written and A is no longer en route", async () => {
    setup();
    await press(A, "en_route");
    vi.setSystemTime(at(15));
    await press(B, "en_route");
    expect(entries()[0]).toMatchObject({ service_job_id: A, kind: "travel", hours: 0.25 });
    expect(jobRow(A)["field_status"]).toBeNull();
    expect(events(A).at(-1)).toMatchObject({ note: "stopped travelling" });
    expect(clocks()[0]).toMatchObject({ service_job_id: B, kind: "travel" });
  });
  it("Leave site on a ticket the clock is not on changes nothing on the clock", async () => {
    setup();
    await press(A, "on_site");
    vi.setSystemTime(at(30));
    await press(B, "leave");
    expect(clocks()[0]).toMatchObject({ service_job_id: A, kind: "labor" });
    expect(entries()).toEqual([]);
  });
});

describe("undo", () => {
  it("drops a running clock on this ticket without an entry; the ticket is back to neither", async () => {
    setup();
    await press(A, "en_route");
    vi.setSystemTime(at(10));
    const { row } = await press(A, "undo");
    expect(clocks()).toEqual([]);
    expect(entries()).toEqual([]);
    expect(row).toMatchObject({ field_status: null, en_route_at: null });
    expect(events(A).at(-1)).toMatchObject({ kind: "field", note: "undo" });
    // A labor clock the same way, dropping the On site stamp.
    await press(A, "on_site");
    await press(A, "undo");
    expect(clocks()).toEqual([]);
    expect(jobRow(A)).toMatchObject({ field_status: null, on_site_at: null });
  });
  it("a clock-completed ticket's undo deletes the 'clock' labor entry too and steps back to Scheduled", async () => {
    setup({ ...whole(A), service_jobs: [job(A, 6014, { signature_path: "s.png" }), job(B, 6012)] });
    await press(A, "on_site");
    vi.setSystemTime(at(120));
    await press(A, "done");
    expect(jobRow(A)).toMatchObject({ stage: "done", completed_at: at(120).toISOString() });
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ source: "clock", ended_at: at(120).toISOString() });
    vi.setSystemTime(at(125));
    await press(A, "undo");
    expect(jobRow(A)).toMatchObject({ stage: "scheduled", completed_at: null });
    expect(entries()).toEqual([]);
  });
});

describe("Complete with a clock", () => {
  it("writes the labor entry from the clock (source 'clock'), closes the clock, sets Done", async () => {
    setup({ ...whole(A), service_jobs: [job(A, 6014, { signature_path: "s.png" }), job(B, 6012)] });
    await press(A, "en_route");
    vi.setSystemTime(at(20));
    await press(A, "on_site");
    vi.setSystemTime(at(140));
    const { row } = await press(A, "done");
    expect(row).toMatchObject({
      stage: "done",
      field_status: null,
      completed_at: at(140).toISOString(),
    });
    expect(clocks()).toEqual([]);
    expect(entries().map((e) => [e["kind"], e["hours"], e["source"]])).toEqual([
      ["travel", 0.25, "clock"],
      ["labor", 2, "clock"],
    ]);
    expect(entries()[1]).toMatchObject({
      started_at: at(20).toISOString(),
      ended_at: at(140).toISOString(),
    });
    // The Service done timeline row still lands (owner, Oct 14).
    expect(env.tables["crm_contact_log"]).toHaveLength(1);
  });
  it("still refuses a technician's incomplete close-out — and leaves the clock running", async () => {
    setup();
    await press(A, "on_site");
    vi.setSystemTime(at(60));
    await expect(press(A, "done")).rejects.toThrow(
      "The close-out is not complete: No repairs recorded; No customer signature. Add what is missing, then press Complete again.",
    );
    expect(clocks()).toHaveLength(1);
    expect(entries()).toEqual([]);
    expect(jobRow(A)).toMatchObject({ stage: "scheduled", field_status: "on_site" });
  });
  it("the clock on this ticket stands in for the time (no typed entry needed); a travel clock does not", async () => {
    // Labor clock: no "No time logged" gap (above). Travel clock only: the gap stands.
    setup({ ...whole(A), service_jobs: [job(A, 6014, { signature_path: "s.png" }), job(B, 6012)] });
    await press(A, "en_route");
    vi.setSystemTime(at(60));
    await expect(press(A, "done")).rejects.toThrow("No time logged");
  });
  it("after Leave site, Complete adds no second labor from the On site stamp", async () => {
    setup({ ...whole(A), service_jobs: [job(A, 6014, { signature_path: "s.png" }), job(B, 6012)] });
    await press(A, "on_site");
    vi.setSystemTime(at(60));
    await press(A, "leave");
    vi.setSystemTime(at(90));
    await press(A, "done");
    expect(entries()).toHaveLength(1);
    expect(jobRow(A)["stage"]).toBe("done");
  });
  it("no clock, still 'on site' from the old buttons: the labor from on_site_at as before (source 'buttons')", async () => {
    setup({
      ...whole(A),
      service_jobs: [
        job(A, 6014, {
          signature_path: "s.png",
          field_status: "on_site",
          on_site_at: T0.toISOString(),
        }),
        job(B, 6012),
      ],
    });
    vi.setSystemTime(at(60));
    await press(A, "done");
    expect(entries()[0]).toMatchObject({ kind: "labor", hours: 1, source: "buttons" });
  });
  it("no clock, still 'en route' from the old buttons: On site writes the travel from en_route_at as before", async () => {
    setup({
      service_jobs: [
        job(A, 6014, { field_status: "en_route", en_route_at: T0.toISOString() }),
        job(B, 6012),
      ],
    });
    vi.setSystemTime(at(30));
    await press(A, "on_site");
    expect(entries()[0]).toMatchObject({ kind: "travel", hours: 0.5, source: "buttons" });
    expect(clocks()[0]).toMatchObject({ kind: "labor" });
  });
  it("the office completing for the technician closes the TECHNICIAN's clock", async () => {
    setup({ ...whole(A), service_jobs: [job(A, 6014, { signature_path: "s.png" }), job(B, 6012)] });
    await press(A, "on_site");
    vi.setSystemTime(at(60));
    await press(A, "done", MANAGER);
    expect(clocks()).toEqual([]);
    expect(entries()[0]).toMatchObject({
      technician_id: TECH,
      created_by: MANAGER,
      source: "clock",
    });
  });
});

describe("who may clock", () => {
  it("a crew member (service_job_crew) clocks into the ticket on their OWN clock", async () => {
    setup({ service_job_crew: [{ id: "c1", service_job_id: A, technician_id: MATE, sort: 1 }] });
    await press(A, "on_site", MATE);
    expect(clocks()).toEqual([expect.objectContaining({ technician_id: MATE, service_job_id: A })]);
    vi.setSystemTime(at(60));
    await press(A, "leave", MATE);
    expect(entries()[0]).toMatchObject({ technician_id: MATE, created_by: MATE });
  });
  it("a technician not on the ticket is refused", async () => {
    setup();
    await expect(press(A, "on_site", STRANGER)).rejects.toThrow(
      "This ticket is assigned to someone else",
    );
    expect(clocks()).toEqual([]);
  });
  it("the office pressing for the technician moves the lead's clock", async () => {
    setup();
    await press(A, "en_route", MANAGER);
    expect(clocks()).toEqual([expect.objectContaining({ technician_id: TECH, service_job_id: A })]);
  });
  it("the crew view is read, never service_job_techs (a technician reads no rates)", () => {
    const fn = read("src/lib/service-field.functions.ts");
    expect(fn).toContain('.from("service_job_crew")');
    expect(fn).not.toContain('.from("service_job_techs")');
  });
});

describe("myClock", () => {
  it("the caller's clock with the ticket's number and customer; null when none", async () => {
    setup();
    expect(await call(myClock, {})).toBeNull();
    await press(A, "on_site");
    // The columns the select names (Oct 20: the fake projects them, as PostgREST does; the
    // row's id is not among them, and MyClock has no id).
    expect(await call(myClock, {})).toEqual({
      technician_id: TECH,
      service_job_id: A,
      kind: "labor",
      started_at: T0.toISOString(),
      helper_count: 1,
      number: 6014,
      customer_name: "Bell County",
    });
    // Someone else's clock is not mine.
    expect(await call(myClock, {}, MATE)).toBeNull();
  });
});

describe("saveTimeEntry with a start and an end", () => {
  const base = { service_job_id: A, kind: "labor", helper_count: 0 };
  it("computes the hours from the times (a sent hours is ignored) and the day from the start when none is sent", async () => {
    setup();
    const row = await call(saveTimeEntry, {
      ...base,
      hours: 7,
      started_at: "2026-10-15T12:00:00.000Z",
      ended_at: "2026-10-15T13:40:00.000Z",
    });
    expect(row).toMatchObject({
      hours: 1.75,
      on_date: "2026-10-15",
      started_at: "2026-10-15T12:00:00.000Z",
      ended_at: "2026-10-15T13:40:00.000Z",
      source: "manual",
      service_job_id: A,
    });
  });
  it("rejects an end before (or at) the start, writing nothing", async () => {
    setup();
    await expect(
      call(saveTimeEntry, {
        ...base,
        started_at: "2026-10-15T13:00:00.000Z",
        ended_at: "2026-10-15T12:00:00.000Z",
      }),
    ).rejects.toThrow(TIME_END_BEFORE_START);
    await expect(
      call(saveTimeEntry, {
        ...base,
        started_at: "2026-10-15T13:00:00.000Z",
        ended_at: "2026-10-15T13:00:00.000Z",
      }),
    ).rejects.toThrow("End must be after start");
    expect(entries()).toEqual([]);
  });
  it("without times the hours and the day are required, as before", async () => {
    setup();
    await expect(call(saveTimeEntry, { ...base, on_date: DAY })).rejects.toThrow(TIME_HOURS_NEEDED);
    const row = await call(saveTimeEntry, { ...base, hours: 1.5, on_date: DAY });
    expect(row).toMatchObject({ hours: 1.5, on_date: DAY, source: "manual" });
  });
  it("editing a clock entry's times keeps its source 'clock' and recomputes the hours", async () => {
    setup();
    await press(A, "on_site");
    vi.setSystemTime(at(60));
    await press(A, "leave");
    const e = entries()[0]!;
    e["id"] = 7; // the fake's ids are strings; the table's are integers
    expect(e).toMatchObject({ source: "clock", hours: 1 });
    const row = await call(saveTimeEntry, {
      ...base,
      id: e["id"],
      on_date: DAY,
      started_at: T0.toISOString(),
      ended_at: at(135).toISOString(),
    });
    expect(row).toMatchObject({
      id: e["id"],
      hours: 2.25,
      source: "clock",
      ended_at: at(135).toISOString(),
    });
    expect(entries()).toHaveLength(1);
  });
  it("the technician edits their own entries' times (editableJob gates by stage, as before)", async () => {
    setup({ service_jobs: [job(A, 6014, { stage: "invoiced" }), job(B, 6012)] });
    await expect(
      call(saveTimeEntry, {
        ...base,
        started_at: "2026-10-15T12:00:00.000Z",
        ended_at: "2026-10-15T13:00:00.000Z",
      }),
    ).rejects.toThrow("This ticket is Invoiced");
  });
});

// ---------------------------------------------------------------------------------------------
// The screens.

describe("My tickets (today-page.tsx): the clock's banner and buttons", () => {
  const today = read("src/components/service/today-page.tsx");
  it("reads myClock and shows the running banner with the next buttons", () => {
    expect(today).toContain("queryKey: fieldKeys.clock,");
    expect(today).toContain('data-line="clock-banner"');
    expect(today).toContain("runningLabel(");
    expect(today).toMatch(/useTick\(30_000\)/);
    expect(today).toContain("const actions = cardActions(clock, j.id);");
  });
  it("the cards' buttons: Start travel and On site; Leave site and Complete live on the banner; Open ticket stays", () => {
    for (const label of ["Start travel", "On site", "Leave site", "Complete", "Open ticket"])
      expect(today).toContain(label);
    expect(today).toContain('press_.mutate("en_route")');
    expect(today).toContain('press_.mutate("on_site")');
    expect(today).toContain('press.mutate("leave")');
    // Owner, Oct 15 ("two On site buttons"): the card never repeats the banner's buttons.
    expect(today).not.toContain('press_.mutate("leave")');
    expect(today).not.toContain('actions.includes("complete")');
  });
  it("the banner is the one control (owner, Oct 15): coloured by state, says what to do next, Leave site vs Complete explained, a mistaken travel cancelled; the card points at it", () => {
    expect(today).toContain("data-clock={clock.kind}");
    expect(today).toContain('data-line="clock-next"');
    expect(today).toContain("When you arrive, tap On site");
    expect(today).toContain("Leave site stops the clock and keeps the ticket open");
    expect(today).toContain(">not done yet</span>");
    expect(today).toContain(">finish the ticket</span>");
    expect(today).toContain('onClick={() => press.mutate("undo")}');
    expect(today).toContain("— use the clock at the top");
  });
  it("a press sends the phone's day, re-reads the day, the clock and the time, and toasts pressLine from the server's report; failures are loud", () => {
    expect(today).toContain("statusFn({ data: { id: ticket.id, to, day: localYmd() } }),");
    expect(today).toContain("else toast.success(pressLine(transition, to, ticket));");
    expect(flat(today)).toContain("fieldKeys.today, fieldKeys.clock, fieldKeys.time(ticket.id),");
    expect(today).toContain("[fieldKeys.time(left), fieldKeys.job(left), fieldKeys.events(left)]");
    expect(today).toContain('onError: (e) => loudError("The clock did not move", e),');
  });
  it("the header says the Oct 8 one-button screen is superseded by the clock (Oct 15)", () => {
    expect(today).toContain("the buttons\n * are back as the clock, Oct 15");
    expect(today).not.toContain("each with ONE big button");
  });
});

describe("the close-out (closeout.tsx): the clock line and Complete", () => {
  const closeout = read("src/components/service/closeout.tsx");
  it("shows the running clock on THIS ticket near the top, with Leave site", () => {
    expect(closeout).toContain(
      "const clockHere = clockQ.data && clockQ.data.service_job_id === job.id ? clockQ.data : null;",
    );
    expect(closeout).toContain('data-line="closeout-clock"');
    expect(flat(closeout)).toContain("runningLabel( clockHere,");
    expect(closeout).toContain(
      'await statusFn({ data: { id: job.id, to: "leave", day: localYmd() } }),',
    );
    expect(closeout).toContain("Leave site");
  });
  it("Complete's gap check and the Time step count the clock's labor, never a stamp a closed clock left", () => {
    expect(flat(closeout)).toContain(
      'const onSiteAt = clockHere ? clockHere.kind === "labor" ? clockHere.started_at : null : job.field_status === "on_site" ? job.on_site_at : null;',
    );
    expect(closeout).toContain("on_site_at: onSiteAt,");
    expect(closeout).toContain("onSiteAt,\n");
    expect(closeout).toContain('data-line="labor-from-clock"');
    expect(closeout).toContain("is logged as labor when you press Complete");
    // Complete re-reads the clock too.
    expect(flat(closeout)).toContain("fieldKeys.today, fieldKeys.clock, fieldKeys.job(job.id),");
  });
  it("the header no longer says there are no En route / On site steps", () => {
    expect(closeout).not.toContain("no En route / On site steps before it");
    expect(closeout).toContain("the buttons are back as the clock on My\n * tickets");
  });
});

describe("the time editor (field-shared.tsx): the clock's entries edited as times", () => {
  const shared = read("src/components/service/field-shared.tsx");
  it("an entry with a start and an end shows two time boxes; the hours follow them, read only", () => {
    expect(shared).toContain('type="time"');
    expect(shared).toContain("data-time={label.toLowerCase()}");
    expect(shared).toContain('data-hours="from-times"');
    expect(shared).toContain("hours: durationHours(t.started_at, t.ended_at)");
    expect(shared).toContain("entryTimes(v.on_date, v.start, v.end)");
    // The save sends the times, not the hours, for a timed entry.
    expect(flat(shared)).toContain(
      "return { ...base, started_at: t.started_at, ended_at: t.ended_at };",
    );
  });
  it("a typed entry keeps the hours box and the Oct 5 grid; Add is the hours form", () => {
    expect(shared).toContain("sm:grid-cols-[110px_90px_1fr]");
    expect(shared).toContain("<NumberField");
    expect(flat(shared)).toContain('start: "", end: "", }));');
  });
  it("a clock entry wears a small clock tag", () => {
    expect(shared).toContain('data-tag="clock"');
    expect(shared).toContain('{entry.source === "clock" && <ClockTag />}');
    expect(shared).toContain('{r.source === "clock" && <ClockTag />}');
  });
  it("the server keeps the source on an edit (a clock entry stays 'clock'); only an insert is 'manual'", () => {
    const fn = read("src/lib/service-field.functions.ts");
    expect(flat(fn)).toContain('.insert({ ...row, service_job_id: job.id, source: "manual",');
    expect(fn).not.toContain('source: "manual" as const');
  });
});

describe("the server's shape", () => {
  const fn = read("src/lib/service-field.functions.ts");
  it("myClock and clockOnJob are exported; setFieldStatus takes leave", () => {
    expect(fn).toContain("export const myClock = createServerFn");
    expect(fn).toContain("export const clockOnJob = createServerFn");
    expect(fn).toContain('to: z.enum(["en_route", "on_site", "leave", "done", "undo"]),');
    expect(flat(fn)).toContain(
      'import { clockTransition, durationHours, MOVED_PRESS, pressReport, type Clock, type ClockPress, } from "@/lib/tech-clock";',
    );
    expect(fn).toContain('import { insertClockEntry } from "@/lib/clock-close.server";');
  });
  it("quarterHours is tech-clock's durationHours (one rounding rule)", () => {
    expect(flat(fn)).toContain(
      "export function quarterHours(from: string | Date, to: string | Date): number { return durationHours(from, to); }",
    );
  });
  it("the office ticket page shows the clock on the ticket; the timeline names the clock's leaving rows", () => {
    expect(read("src/components/service-page.tsx")).toContain(
      "{job && <JobClockLine jobId={job.id} />}",
    );
    const sections = read("src/components/service/ticket-field-sections.tsx");
    expect(sections).toContain("export function JobClockLine({ jobId }: { jobId: string })");
    // Oct 27: the stream's wording lives in lib/ticket-timeline.ts (the form's Activity block).
    const timeline = read("src/lib/ticket-timeline.ts");
    expect(timeline).toContain('"left site": "Left the site",');
    expect(timeline).toContain('"stopped travelling": "Stopped travelling",');
  });
  it("the Tech Board colours a Scheduled card by the clock again and its legend names the two colours", () => {
    const board = read("src/components/service/board-page.tsx");
    expect(flat(board)).toContain(
      'stages={[ "open", "scheduled", "en_route", "on_site", "done", "authorized", "invoiced", "closed", ]}',
    );
  });
});

describe("tightened after the review (Oct 15)", () => {
  it("the clock table's write policy: own row or the office, never another technician's clock", () => {
    const sql = readFileSync(
      "supabase/migrations/20261015130000_tech_clock_write_policy.sql",
      "utf8",
    );
    expect(sql).toContain(
      "drop policy if exists service_tech_clock_write on public.service_tech_clock;",
    );
    expect(sql).toContain(
      "using (technician_id = auth.uid() or public.is_admin() or public.is_manager()",
    );
    expect(sql).toContain("or (public.has_access('service') and not public.is_technician()))");
  });
  it("leaving the other ticket clears its field status only for its lead or the office, and a refusal is loud", () => {
    const fns = readFileSync("src/lib/service-field.functions.ts", "utf8");
    expect(fns).toContain("if (other && (other.technician_id === tech || isOffice(p))) {");
    expect(fns).toContain("could not clear its field status after the clock left it");
  });
});

// ---------------------------------------------------------------------------------------------
// Oct 28 (the audit): the server reports what the press did; the swap is compare-and-swap; the
// office's closing stages stop the clock; a timeline write that fails is heard; My tickets' reads.

describe("the server reports what the press did (audit risk 3)", () => {
  const acme = { number: 6012, customer_name: "Acme" };
  const bell = { number: 6014, customer_name: "Bell County" };
  it("a move — on site at A, Start travel to B — reports A's labor closed with its hours and B's travel opened", async () => {
    setup();
    await press(A, "on_site");
    vi.setSystemTime(at(60));
    const r = await press(B, "en_route");
    expect(r.transition).toEqual({
      close: { jobId: A, jobNumber: 6014, customer: "Bell County", kind: "labor", hours: 1 },
      open: { jobNumber: 6012, kind: "travel" },
      note: null,
    });
    expect(r.warning).toBeUndefined();
    expect(pressLine(r.transition, "en_route", acme)).toBe(
      "Left #6014 Bell County · 1 h labor logged — travelling to #6012 Acme",
    );
  });
  it("the same button twice reports 'already': nothing closed, nothing opened, nothing written", async () => {
    setup();
    await press(A, "on_site");
    vi.setSystemTime(at(30));
    const r = await press(A, "on_site");
    expect(r.transition).toEqual({ close: null, open: null, note: "already" });
    expect(r.row).toMatchObject({ id: A });
    expect(entries()).toEqual([]);
    expect(clocks()).toHaveLength(1);
    expect(pressLine(r.transition, "on_site", bell)).toBe("Already on site at #6014 Bell County");
  });
  it("Leave site where no clock runs reports 'no clock on this ticket'; a mistap names the stopped clock with 0 hours", async () => {
    setup();
    const r = await press(A, "leave");
    expect(r.transition).toEqual({ close: null, open: null, note: "no clock on this ticket" });
    expect(pressLine(r.transition, "leave", bell)).toBe(
      "No clock was running at #6014 Bell County",
    );
    await press(A, "en_route");
    vi.setSystemTime(new Date(T0.getTime() + 30_000));
    const m = await press(A, "on_site");
    expect(m.transition).toEqual({
      close: { jobId: A, jobNumber: 6014, customer: "Bell County", kind: "travel", hours: 0 },
      open: { jobNumber: 6014, kind: "labor" },
      note: "mistap",
    });
    expect(entries()).toEqual([]);
  });
  it("the pages build the toast from the report, never from the clock the phone had cached", () => {
    const today = read("src/components/service/today-page.tsx");
    expect(today).not.toContain("qc.getQueryData<MyClock | null>(fieldKeys.clock)");
    expect(today).not.toContain("pressLine(before");
    expect(today).toContain("onSuccess: ({ transition, warning }, to) => {");
    expect(today).toContain("if (warning) toast.warning(warning);");
    const closeout = read("src/components/service/closeout.tsx");
    expect(closeout).not.toContain("closedLine(");
    expect(closeout).toContain('toast.success(pressLine(transition, "leave", job));');
    expect(closeout).toContain("if (r.warning) toast.warning(r.warning);");
    expect(closeout).toContain("return r.row;");
  });
});

describe("the clock swap is compare-and-swap (audit risk 2)", () => {
  /** The fake's service_tech_clock delete finds no row: the clock moved on another device. */
  function deleteFindsNothing() {
    const db = env.db as unknown as { from: (t: string) => Record<string, unknown> };
    const realFrom = db.from;
    db.from = (t: string) => {
      const b = realFrom(t) as Record<string, unknown> & {
        then: (res: (v: unknown) => unknown) => Promise<unknown>;
      };
      if (t === "service_tech_clock")
        b["delete"] = () => {
          b.then = (res) => Promise.resolve({ data: [], error: null, count: 0 }).then(res);
          return b;
        };
      return b;
    };
  }
  it("a delete that finds no row: no entry written, no new clock, note 'moved', the ticket untouched", async () => {
    setup();
    await press(A, "on_site");
    vi.setSystemTime(at(60));
    deleteFindsNothing();
    const r = await press(B, "en_route");
    expect(r.transition).toEqual(MOVED_PRESS);
    expect(r.transition.note).toBe("moved");
    expect(entries()).toEqual([]);
    expect(clocks()).toHaveLength(1);
    expect(clocks()[0]).toMatchObject({ service_job_id: A, kind: "labor" });
    expect(jobRow(B)).toMatchObject({ field_status: null, en_route_at: null });
    expect(jobRow(A)).toMatchObject({ field_status: "on_site" });
    expect(events(B)).toEqual([]);
    // Leave site and Complete hit the same wall.
    const l = await press(A, "leave");
    expect(l.transition).toEqual(MOVED_PRESS);
    expect(entries()).toEqual([]);
  });
  it("source: the delete names the started_at that was read, and the entry is written after the swap held", () => {
    const fn = read("src/lib/service-field.functions.ts");
    const swap = fn.slice(
      fn.indexOf("const applyClock = async ("),
      fn.indexOf('return "applied";'),
    );
    expect(flat(swap)).toContain(
      '.delete() .eq("technician_id", tech) .eq("started_at", open.started_at) .select("technician_id");',
    );
    expect(swap).toContain('if (!gone?.length) return "moved";');
    expect(swap.indexOf("insertClockEntry(")).toBeGreaterThan(swap.indexOf('return "moved"'));
    const today = read("src/components/service/today-page.tsx");
    expect(today).toContain('if (transition.note === "moved") toast.info(CLOCK_MOVED_LINE);');
  });
});

describe("the office closing a ticket stops the clock and writes its time (audit risk 4)", () => {
  const invoice = (id: string) => call(setServiceStage, { id, stage: "invoiced" }, MANAGER);
  it("a clock running on B, the office sets Invoiced: the labor entry, the clock gone, the timeline row, the stage", async () => {
    setup();
    await press(B, "on_site");
    vi.setSystemTime(at(90));
    await invoice(B);
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({
      service_job_id: B,
      technician_id: TECH,
      kind: "labor",
      hours: 1.5,
      source: "clock",
      started_at: T0.toISOString(),
      ended_at: at(90).toISOString(),
      on_date: DAY,
      created_by: MANAGER,
    });
    expect(clocks()).toEqual([]);
    expect(events(B).at(-1)).toMatchObject({
      kind: "field",
      field_status: null,
      note: "Clock stopped by the office — stage Invoiced",
      by_user: MANAGER,
    });
    expect(clockStoppedNote("invoiced")).toBe("Clock stopped by the office — stage Invoiced");
    expect(jobRow(B)).toMatchObject({ stage: "invoiced", field_status: null });
  });
  it("Done from the stage picker stops the clock too (owner, Oct 28); the technician's own pick reads without 'by the office'", async () => {
    setup();
    await press(B, "on_site");
    vi.setSystemTime(at(60));
    await call(setServiceStage, { id: B, stage: "done" }, MANAGER);
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({
      service_job_id: B,
      kind: "labor",
      hours: 1,
      source: "clock",
    });
    expect(clocks()).toEqual([]);
    expect(events(B).at(-1)).toMatchObject({
      note: "Clock stopped by the office — stage Done",
      by_user: MANAGER,
    });
    expect(jobRow(B)).toMatchObject({ stage: "done", field_status: null });
    expect(clockStoppedNote("done", true)).toBe("Clock stopped — stage Done");
    expect(CLOCK_CLOSING_STAGES).toContain("done");
    expect(CLOCK_CLOSING_STAGES).not.toContain("scheduled");
  });
  it("no clock: nothing extra is written", async () => {
    setup();
    await invoice(A);
    expect(entries()).toEqual([]);
    expect(events(A)).toEqual([]);
    expect(clocks()).toEqual([]);
    expect(jobRow(A)["stage"]).toBe("invoiced");
  });
  it("the technician's Leave after the office closed it: the friendly path, no RLS text, nothing written", async () => {
    setup();
    await press(B, "on_site");
    vi.setSystemTime(at(90));
    await invoice(B);
    vi.setSystemTime(at(100));
    const r = await press(B, "leave");
    expect(r.transition).toEqual({ close: null, open: null, note: "no clock on this ticket" });
    expect(pressLine(r.transition, "leave", { number: 6012, customer_name: "Acme" })).toBe(
      "No clock was running at #6012 Acme",
    );
    expect(entries()).toHaveLength(1);
    // And the banner is gone: myClock reads no clock (the row was deleted).
    expect(await call(myClock, {})).toBeNull();
  });
  it("a clock the office could not stop refuses the stage change (nothing half done)", async () => {
    setup();
    await press(B, "on_site");
    vi.setSystemTime(at(90));
    const db = env.db as unknown as { from: (t: string) => Record<string, unknown> };
    const realFrom = db.from;
    db.from = (t: string) => {
      const b = realFrom(t) as Record<string, unknown> & {
        then: (res: (v: unknown) => unknown) => Promise<unknown>;
      };
      if (t === "service_time_entries")
        b["insert"] = () => {
          b.then = (res) =>
            Promise.resolve({ data: null, error: { message: "no room" }, count: null }).then(res);
          return b;
        };
      return b;
    };
    await expect(invoice(B)).rejects.toThrow(
      /The time entry \(labor, .* – .*\) was not written: no room/,
    );
    expect(jobRow(B)["stage"]).toBe("scheduled");
  });
  it("withTicket drops a banner whose ticket is past Done (defensive): myClock is null on an Invoiced ticket", async () => {
    setup();
    await press(B, "on_site");
    // A clock that slipped past the office's stop (set the stage around the app).
    jobRow(B)["stage"] = "invoiced";
    expect(await call(myClock, {})).toBeNull();
    jobRow(B)["stage"] = "done";
    expect(await call(myClock, {})).toMatchObject({ service_job_id: B });
  });
  it("source: setServiceStage and the invoice's finalise stop the clocks BEFORE the stage write; the stages are the office's", () => {
    const svc = read("src/lib/service.functions.ts");
    const stage = svc.slice(
      svc.indexOf("export const setServiceStage"),
      svc.indexOf("export const assignServiceJob"),
    );
    expect(stage.indexOf("stopClocksForOffice(")).toBeGreaterThan(0);
    expect(stage.indexOf("stopClocksForOffice(")).toBeLessThan(stage.indexOf("stage: data.stage,"));
    expect(stage).toContain("...(stopped ? { field_status: null } : {}),");
    const inv = read("src/lib/invoices.functions.ts");
    const fin = inv.slice(
      inv.indexOf("async function finalizeDraft("),
      inv.indexOf("const pdfPath ="),
    );
    expect(fin.indexOf("stopClocksForOffice(")).toBeLessThan(
      fin.indexOf("ticketStageFromInvoice(sb,"),
    );
    const helper = read("src/lib/clock-close.server.ts");
    expect(helper).toContain(
      'export const CLOCK_CLOSING_STAGES: readonly string[] = ["done", ...OFFICE_STAGES];',
    );
    expect(helper).toContain(
      'clockTransition(open, "leave", job.id, now, open.helper_count, open.technician_id)',
    );
    expect(helper).toContain("if (t.close) await insertClockEntry(sb, t.close, day, actor.id);");
    // No SQL needed: the office passes ticket_open_for_tech at any stage (the function says so).
    const sql = readFileSync("supabase/migrations/20261006192000_field_edit_lock.sql", "utf8");
    expect(sql).toContain(
      "select not public.is_technician() or public.is_admin() or public.is_manager()",
    );
  });
});

describe("a timeline write that fails is heard (audit nit)", () => {
  function eventsRefuse() {
    const db = env.db as unknown as { from: (t: string) => Record<string, unknown> };
    const realFrom = db.from;
    db.from = (t: string) => {
      const b = realFrom(t) as Record<string, unknown> & {
        then: (res: (v: unknown) => unknown) => Promise<unknown>;
      };
      if (t === "service_job_events")
        b["insert"] = () => {
          b.then = (res) =>
            Promise.resolve({ data: null, error: { message: "RLS says no" }, count: null }).then(
              res,
            );
          return b;
        };
      return b;
    };
  }
  it("a clock press stands and comes back with a warning the screen toasts (the clock moved)", async () => {
    setup();
    eventsRefuse();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await press(A, "on_site");
    spy.mockRestore();
    expect(r.row).toMatchObject({ field_status: "on_site" });
    expect(clocks()).toHaveLength(1);
    expect(r.warning).toBe(
      "The clock moved, but the ticket's timeline was not updated: The timeline row was not written: RLS says no",
    );
    expect(events(A)).toEqual([]);
  });
  it("a note IS the timeline row: the add fails loudly", async () => {
    setup();
    eventsRefuse();
    await expect(call(addJobNote, { id: A, note: "Gate code 4411" })).rejects.toThrow(
      "The timeline row was not written: RLS says no",
    );
  });
  it("source: logEvent throws; the photo, signature and crew sites say what already stands", () => {
    const fn = read("src/lib/service-field.functions.ts");
    expect(fn).toContain(
      'if (error)\n    throw new Error(\n      `${stands ? `${stands}, but the` : "The"} timeline row was not written: ${error.message}`,',
    );
    for (const stands of [
      '"The signature is saved"',
      '"The photo is saved"',
      '"The crew is saved"',
    ])
      expect(fn).toContain(stands);
  });
});

describe("myDay (Oct 28 audit): the columns it sends, and the roster only when a crew needs names", () => {
  const rpcCalls = () => env.rpcCalls.map((c) => c.fn);
  it("no crew rows: technician_options is not called", async () => {
    setup();
    const day = await call<Row[]>(myDay, {});
    expect(day).toHaveLength(2);
    expect(rpcCalls()).not.toContain("technician_options");
    expect(day[0]).toMatchObject({ crew_names: [] });
  });
  it("a crew row: the roster is read once", async () => {
    setup({ service_job_crew: [{ service_job_id: A, technician_id: MATE, sort: 1 }] });
    const day = await call<Row[]>(myDay, {});
    expect(rpcCalls().filter((f) => f === "technician_options")).toHaveLength(1);
    expect(day.find((j) => j["id"] === A)).toMatchObject({ crew_names: ["Mia Mate"] });
  });
  it("source: a named column list, no select('*'); the seed fills the rest", () => {
    const fn = read("src/lib/service-field.functions.ts");
    const day = fn.slice(fn.indexOf("export const myDay"), fn.indexOf("export interface MyClock"));
    expect(day).toContain(".select(TODAY_JOB_SELECT)");
    expect(day).not.toContain('.select("*")');
    expect(day).toContain(
      'const techs = crewRows?.length ? (await sb.rpc("technician_options")).data : [];',
    );
    expect(fn).toContain("export type TodayJobRow = Pick<ServiceJobRow, TodayJobColumn>;");
    expect(fn).toContain("export interface TodayJob extends TodayJobRow {");
    const cache = read("src/lib/job-cache.ts");
    expect(cache).toContain("const UNREAD_COLUMNS: Omit<ServiceJobRow, TodayJobColumn> = {");
    expect(cache).toContain("...UNREAD_COLUMNS,\n    ...row,");
  });
});
