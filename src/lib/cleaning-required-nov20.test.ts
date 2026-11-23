/**
 * Owner, Nov 20: "those questions should be required". On a Roof Care plan's own inspection the
 * plan asks whether the drains and scuppers (Roof Care, Roof Guard) and the gutters (Roof Guard)
 * were cleaned. Only the ticket workflow asked. The server behind Complete checked nothing of
 * it, so a manager's Complete went through with the questions blank, and a manager who set Done
 * or Authorized from the ticket page's stage picker never met the questions at all.
 *
 * Now no ticket that is a plan's inspection moves into Done or later while a question is open:
 * the database refuses (trigger service_jobs_cleaning_rule), the two server functions refuse
 * before they touch a clock, and "Complete anyway" is not offered while a question is open.
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
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));
vi.mock("@/lib/service-crew.server", () => ({
  syncCrewLead: vi.fn(async () => {}),
  writeCrew: vi.fn(async () => 0),
  readCrew: vi.fn(async () => []),
}));

import {
  CLEANING_REQUIRED_NOTE,
  cleaningBlocksAnyway,
  cleaningGaps,
  type CleaningGate,
} from "@/components/service/cleaning-gate";
import {
  CLEANING_REQUIRED_TAIL,
  cleaningRefusal,
  cleaningRefusalOf,
  cleaningUnchecked,
  completesTicket,
} from "@/lib/cleaning-required";
import { cleaningStop } from "@/lib/cleaning-required.server";
import { cleaningAsked, type VisitCleaning } from "@/lib/roof-care-cleaning";
import { setFieldStatus } from "@/lib/service-field.functions";
import { setServiceStage } from "@/lib/service.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");

const JOB = "11111111-1111-4111-8111-111111111111";
const TECH = "22222222-2222-4222-8222-222222222222";
const MANAGER = "33333333-3333-4333-8333-333333333333";
const ADMIN = "44444444-4444-4444-8444-444444444444";
const VISIT = "55555555-5555-4555-8555-555555555555";
const PLAN = "66666666-6666-4666-8666-666666666666";

const BOTH =
  "Not answered yet: Were the drains and scuppers cleaned? Were the gutters cleaned? This is a Roof Care plan inspection. Press Open ticket, answer Yes or No in the Checklist step, then finish the ticket.";

const profiles: Row[] = [
  { id: TECH, role: "user", access: ["service"], technician: true, full_name: "Ted", email: "t@x" },
  { id: MANAGER, role: "manager", access: [], technician: false, full_name: "Mo", email: "m@x" },
  { id: ADMIN, role: "admin", access: [], technician: false, full_name: "Al", email: "a@x" },
];
const job = (over: Row = {}): Row => ({
  id: JOB,
  number: 6010,
  customer_name: "Acme",
  service_type: "inspection",
  technician_id: TECH,
  stage: "scheduled",
  field_status: null,
  en_route_at: null,
  on_site_at: null,
  completed_at: null,
  signature_path: null,
  helper_count: 0,
  scheduled_date: "2026-11-20",
  invoice_id: null,
  roof_care_visit_id: VISIT,
  inspection: { items: [] },
  deleted_at: null,
  ...over,
});
const visit = (over: Row = {}): Row => ({
  id: VISIT,
  plan_id: PLAN,
  kind: "visit1",
  drains_cleaned: null,
  gutters_cleaned: null,
  cleaning_note: null,
  cleaning_by_name: null,
  cleaning_at: null,
  ...over,
});
const tables = (o: { job?: Row; visit?: Row; plan?: string; clock?: Row[] } = {}) => ({
  profiles,
  service_jobs: [job(o.job)],
  roof_care_visits: [visit(o.visit)],
  roof_care_plans: [{ id: PLAN, plan: o.plan ?? "guard" }],
  service_job_events: [],
  service_job_repairs: [],
  service_job_photos: [],
  service_time_entries: [{ id: 1, service_job_id: JOB, kind: "labor", hours: 1 }],
  inspection_checklist_items: [],
  service_tech_clock: o.clock ?? [],
  service_job_techs: [],
  service_job_crew: [],
  followups: [],
  invoices: [],
});

const complete = (db: unknown, userId: string) =>
  (setFieldStatus as unknown as (a: { data: Row; context: unknown }) => Promise<{ row: Row }>)({
    data: { id: JOB, to: "done" },
    context: { supabase: db, userId },
  }).then((r) => r.row);
const setStage = (db: unknown, userId: string, stage: string) =>
  (setServiceStage as unknown as (a: { data: Row; context: unknown }) => Promise<void>)({
    data: { id: JOB, stage },
    context: { supabase: db, userId },
  });

const cleaning = (over: Partial<VisitCleaning> = {}): VisitCleaning => ({
  visit_id: VISIT,
  plan: "guard",
  kind: "visit1",
  asked: cleaningAsked("guard", "visit1"),
  drains: null,
  gutters: null,
  note: null,
  by_name: null,
  at: null,
  ...over,
});

describe("the rule", () => {
  it("watches only the move from before Done into Done or later", () => {
    expect(completesTicket("scheduled", "done")).toBe(true);
    expect(completesTicket("open", "authorized")).toBe(true);
    expect(completesTicket("scheduled", "closed")).toBe(true);
    expect(completesTicket("done", "authorized")).toBe(false);
    expect(completesTicket("authorized", "invoiced")).toBe(false);
    expect(completesTicket("done", "scheduled")).toBe(false);
    expect(completesTicket("open", "scheduled")).toBe(false);
    expect(completesTicket("done", "done")).toBe(false);
  });
  it("names each open question and says where to answer", () => {
    expect(cleaningRefusal(["drains", "gutters"])).toBe(BOTH);
    expect(cleaningRefusal(["gutters"])).toBe(
      `Not answered yet: Were the gutters cleaned? ${CLEANING_REQUIRED_TAIL}`,
    );
    expect(cleaningRefusal([])).toBeNull();
    expect(BOTH).not.toMatch(/the office/i);
  });
  it("reads an inspection's answers: a No is an answer, a blank is not", () => {
    expect(cleaningRefusalOf(cleaning())).toBe(BOTH);
    expect(cleaningRefusalOf(cleaning({ drains: true }))).toContain("Were the gutters cleaned?");
    expect(cleaningRefusalOf(cleaning({ drains: true }))).not.toContain("drains");
    expect(cleaningRefusalOf(cleaning({ drains: true, gutters: false, note: "No lift" }))).toBe(
      null,
    );
    // Roof Care is asked the drains only; Roof Watch and a storm inspection nothing.
    expect(
      cleaningRefusalOf(cleaning({ plan: "care", asked: cleaningAsked("care", "visit2") })),
    ).toBe(`Not answered yet: Were the drains and scuppers cleaned? ${CLEANING_REQUIRED_TAIL}`);
    expect(
      cleaningRefusalOf(cleaning({ plan: "watch", asked: cleaningAsked("watch", "visit1") })),
    ).toBeNull();
    expect(
      cleaningRefusalOf(cleaning({ kind: "storm", asked: cleaningAsked("guard", "storm") })),
    ).toBeNull();
    expect(cleaningRefusalOf(cleaning({ kind: "carried" as VisitCleaning["kind"] }))).toBe(BOTH);
    expect(cleaningRefusalOf(null)).toBeNull();
  });
});

describe("the server's check before anything is written", () => {
  it("a ticket that is not a plan's inspection is never read", async () => {
    const { db } = fakeSupabase({});
    expect(await cleaningStop(db as never, null)).toBeNull();
  });
  it("an open question stops it; answered, it does not", async () => {
    expect(await cleaningStop(fakeSupabase(tables()).db as never, VISIT)).toBe(BOTH);
    expect(
      await cleaningStop(
        fakeSupabase(tables({ visit: { drains_cleaned: true, gutters_cleaned: true } }))
          .db as never,
        VISIT,
      ),
    ).toBeNull();
  });
  it("a plan that could not be read is said plainly, never let through as answered", async () => {
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "offline" } }) }),
        }),
      }),
    };
    const said = await cleaningStop(broken as never, VISIT);
    expect(said).toBe(cleaningUnchecked("offline"));
    expect(said).toContain("Nothing was changed. Try again.");
  });
});

describe("Complete (setFieldStatus done)", () => {
  it("a manager's Complete is refused with a question open, and no clock is stopped", async () => {
    const clock = [
      {
        technician_id: TECH,
        service_job_id: JOB,
        kind: "labor",
        started_at: "2026-11-20T14:00:00Z",
        helper_count: 0,
      },
    ];
    for (const who of [MANAGER, ADMIN]) {
      const f = fakeSupabase(tables({ clock }));
      await expect(complete(f.db, who)).rejects.toThrow(BOTH);
      expect(f.tables["service_jobs"]![0]!["stage"]).toBe("scheduled");
      expect(f.tables["service_tech_clock"]).toHaveLength(1);
      expect(f.tables["service_time_entries"]).toHaveLength(1);
    }
  });
  it("a technician's Complete is refused too, in the same words", async () => {
    await expect(complete(fakeSupabase(tables()).db, TECH)).rejects.toThrow(BOTH);
  });
  it("answered, it completes: for the technician and for a manager", async () => {
    for (const who of [TECH, MANAGER]) {
      const f = fakeSupabase(
        tables({ visit: { drains_cleaned: true, gutters_cleaned: false, cleaning_note: "x" } }),
      );
      expect((await complete(f.db, who))["stage"]).toBe("done");
    }
  });
  it("Roof Watch, a storm inspection and a ticket with no plan complete as before", async () => {
    expect((await complete(fakeSupabase(tables({ plan: "watch" })).db, TECH))["stage"]).toBe(
      "done",
    );
    expect(
      (await complete(fakeSupabase(tables({ visit: { kind: "storm" } })).db, TECH))["stage"],
    ).toBe("done");
    expect(
      (await complete(fakeSupabase(tables({ job: { roof_care_visit_id: null } })).db, TECH))[
        "stage"
      ],
    ).toBe("done");
  });
  it("a ticket the office already finished is still stamped, questions open or not", async () => {
    const f = fakeSupabase(tables({ job: { stage: "authorized" } }));
    const row = await complete(f.db, MANAGER);
    expect(row["stage"]).toBe("authorized");
    expect(row["completed_at"]).toBeTruthy();
  });
});

describe("the ticket page's stage picker (setServiceStage)", () => {
  it("a manager cannot set Done, Authorized or Closed past an open question", async () => {
    for (const stage of ["done", "authorized"]) {
      const f = fakeSupabase(tables());
      await expect(setStage(f.db, MANAGER, stage)).rejects.toThrow(BOTH);
      expect(f.tables["service_jobs"]![0]!["stage"]).toBe("scheduled");
      expect(f.writes.filter((w) => w.table === "service_jobs")).toHaveLength(0);
    }
  });
  it("answered, the same move goes through", async () => {
    const f = fakeSupabase(tables({ visit: { drains_cleaned: true, gutters_cleaned: true } }));
    await setStage(f.db, MANAGER, "done");
    expect(f.tables["service_jobs"]![0]!["stage"]).toBe("done");
  });
  it("a ticket already Done moves on, and a move that is not into Done is not checked", async () => {
    const done = fakeSupabase(tables({ job: { stage: "done" } }));
    await setStage(done.db, MANAGER, "authorized");
    expect(done.tables["service_jobs"]![0]!["stage"]).toBe("authorized");
    const open = fakeSupabase(tables({ job: { stage: "open" } }));
    await setStage(open.db, MANAGER, "scheduled");
    expect(open.tables["service_jobs"]![0]!["stage"]).toBe("scheduled");
  });
  it("a plain repair ticket is untouched", async () => {
    const f = fakeSupabase(tables({ job: { roof_care_visit_id: null, service_type: "repair" } }));
    await setStage(f.db, MANAGER, "done");
    expect(f.tables["service_jobs"]![0]!["stage"]).toBe("done");
  });
});

describe("the workflow's Complete dialog", () => {
  const asked = (open: ("drains" | "gutters")[]): CleaningGate => ({
    kind: "asked",
    cleaning: cleaning(),
    open,
  });
  it("no Complete anyway while a question is open", () => {
    expect(cleaningBlocksAnyway(asked(["drains", "gutters"]), false)).toBe(true);
    expect(cleaningBlocksAnyway(asked(["gutters"]), false)).toBe(true);
    // Answered: a manager's Complete anyway skips the other gaps as before.
    expect(cleaningBlocksAnyway(asked([]), false)).toBe(false);
    expect(cleaningBlocksAnyway({ kind: "none" }, false)).toBe(false);
    // A finished ticket is only stamped.
    expect(cleaningBlocksAnyway(asked(["drains"]), true)).toBe(false);
    // A read that failed does not hide the button: the server reads the plan itself.
    expect(cleaningBlocksAnyway({ kind: "unread", message: "offline" }, false)).toBe(false);
    expect(cleaningBlocksAnyway({ kind: "loading" }, false)).toBe(false);
  });
  it("the open questions are still listed, with where to answer", () => {
    expect(cleaningGaps(asked(["drains", "gutters"]), false).gaps).toEqual([
      "Not answered: Were the drains and scuppers cleaned?",
      "Not answered: Were the gutters cleaned?",
    ]);
    expect(CLEANING_REQUIRED_NOTE).toContain("Checklist step");
    expect(CLEANING_REQUIRED_NOTE).not.toMatch(/the office/i);
  });
  it("closeout.tsx hides the button and says the note", () => {
    const s = flat("src/components/service/closeout.tsx");
    expect(s).toContain(
      "const planQuestionsOpen = cleaningBlocksAnyway(cleaning, FINISHED.includes(job.stage));",
    );
    // (Nov 23: the button is also held back while a checklist row of the plan's inspection has
    // no answer; inspection-answers-nov23.test.ts.)
    expect(s).toContain(
      "{manager && !planQuestionsOpen && planRowsOpen.length === 0 && ( <AlertDialogAction",
    );
    expect(s).toContain('data-line="plan-questions-required"');
    expect(s).not.toContain("{manager && ( <AlertDialogAction");
  });
});

describe("where it is enforced", () => {
  it("both server functions check before a clock is touched", () => {
    const field = flat("src/lib/service-field.functions.ts");
    const stop = field.indexOf("const stop = await cleaningStop(sb, job.roof_care_visit_id);");
    expect(stop).toBeGreaterThan(-1);
    // Before the manager's exemption from the other gaps, and before the clock moves.
    expect(stop).toBeLessThan(field.indexOf("if (!finished && !managesTickets(p)) {"));
    expect(stop).toBeLessThan(
      field.indexOf(
        'if ((await applyClock(t)) === "moved") return moved; transition = report(t); if (!t.changed && laborFromStamp)',
      ),
    );
    const stage = flat("src/lib/service.functions.ts");
    const at = stage.indexOf("if (completesTicket(prev.stage, data.stage)) {");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(stage.indexOf("? await stopClocksForOffice("));
    expect(stage).toContain('"stage, number, service_type, invoice_id, roof_care_visit_id"');
  });
  it("the database refuses the move for everybody, in the same words", () => {
    const sql = read("supabase/migrations/20261120100000_roof_care_cleaning_required.sql");
    const one = sql.replace(/\s+/g, " ");
    expect(one).toContain(
      "create trigger service_jobs_cleaning_rule before update of stage on public.service_jobs",
    );
    // Only the move: a ticket already Done or later is let through.
    expect(one).toContain(
      "or coalesce(old.stage, '') in ('done', 'authorized', 'invoiced', 'closed')",
    );
    // Nobody is exempt: the function never asks who is calling.
    expect(sql).not.toMatch(/is_admin|is_manager|auth\.uid|auth\.role|service_role/);
    // The sentence the server says, built from the same parts.
    const said = one.match(/raise exception '(Not answered yet:% [^']+)', v_open;/)?.[1];
    expect(said).toBeTruthy();
    const drains = one.match(/v_open := v_open \|\| '( Were the drains[^']+)'/)?.[1] ?? "";
    const gutters = one.match(/v_open := v_open \|\| '( Were the gutters[^']+)'/)?.[1] ?? "";
    expect(said!.replace("%", drains + gutters)).toBe(BOTH);
    // What each plan is asked, as roof_care_set_cleaning has it.
    expect(one).toContain("if v.kind = 'storm' then return new; end if;");
    expect(one).toContain("if v.plan in ('care', 'guard') and v.drains_cleaned is null then");
    expect(one).toContain("if v.plan = 'guard' and v.gutters_cleaned is null then");
  });
});
