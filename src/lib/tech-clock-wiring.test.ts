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
vi.mock("@/lib/ticket-events.server", () => ({ afterTicketStage: vi.fn(async () => {}) }));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));

import {
  TIME_END_BEFORE_START,
  TIME_HOURS_NEEDED,
  myClock,
  saveTimeEntry,
  setFieldStatus,
} from "@/lib/service-field.functions";
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
  call(setFieldStatus, { id, to, day: DAY }, userId);
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
    const row = await press(A, "leave");
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
    const b = await press(B, "en_route");
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
    const row = await press(A, "undo");
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
    const row = await press(A, "done");
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
    // (The fake gives every inserted row an id; the real select names its columns.)
    expect(await call(myClock, {})).toEqual({
      id: expect.any(String),
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
  it("a press sends the phone's day, re-reads the day, the clock and the time, and toasts pressLine; failures are loud", () => {
    expect(today).toContain("await statusFn({ data: { id: ticket.id, to, day: localYmd() } });");
    expect(today).toContain("toast.success(pressLine(before, to, ticket, at));");
    expect(flat(today)).toContain("fieldKeys.today, fieldKeys.clock, fieldKeys.time(ticket.id),");
    expect(today).toContain("fieldKeys.time(before.service_job_id),");
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
      'await statusFn({ data: { id: job.id, to: "leave", day: localYmd() } });',
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
    expect(fn).toContain(
      'import { clockTransition, durationHours, entryDay, type Clock } from "@/lib/tech-clock";',
    );
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
    expect(sections).toContain('"left site": "Left the site",');
    expect(sections).toContain('"stopped travelling": "Stopped travelling",');
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
