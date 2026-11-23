/**
 * Nov 23, the owner: "3 go". Technicians did not have to answer every checklist row (Oct 26: a
 * row left blank reads as OK). The customer's Care plan report prints "Not checked" for a blank
 * row, so a row a technician looked at and did not mark told the customer nobody checked it.
 *
 * On a Roof Care plan's own inspection every row now needs its answer (OK, Issue or N/A) before
 * the ticket is finished: the database refuses the move (trigger service_jobs_checklist_rule),
 * the two server functions refuse before they touch a clock, the Checklist step waits, and
 * "Complete anyway" is not offered while a row is open. An ordinary inspection is unchanged.
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

import { parseInspection, type ChecklistItem } from "@/lib/inspection";
import {
  PLAN_ROWS_GO_FIRST,
  PLAN_ROWS_REQUIRED_NOTE,
  PLAN_ROWS_TAIL,
  PLAN_ROWS_WHY,
  ROW_NEEDS_ANSWER,
  isPlanInspection,
  planRowsGaps,
  planRowsLine,
  planRowsOpen,
  planRowsRefusal,
  planRowsStepMissing,
  planRowsUnchecked,
  planRowsWaiting,
  rowsToAnswer,
} from "@/lib/inspection-answers";
import { planRowsStop } from "@/lib/inspection-answers.server";
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

const checklist: ChecklistItem[] = [
  { id: "c1", label: "Seams", sort: 1 },
  { id: "c2", label: "Ponding", sort: 2 },
  { id: "c3", label: "Debris", sort: 3 },
  // The old row the screen hides: it is never asked and never counted.
  { id: "c9", label: "Recommend repairs", sort: 9 },
];
const saved = (statuses: (string | null)[]) => ({
  v: 1,
  items: checklist
    .slice(0, statuses.length)
    .map((c, i) => ({ id: c.id, label: c.label, status: statuses[i] ?? null, note: "" })),
  notes: "",
});

const TWO =
  'Not answered yet on the checklist: Ponding, Debris. This is a Roof Care plan inspection, and the customer\'s Care plan report prints "Not checked" for a row left blank. Press Open ticket, mark each row OK, Issue or N/A in the Checklist step, then finish the ticket.';

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
  scheduled_date: "2026-11-23",
  invoice_id: null,
  roof_care_visit_id: VISIT,
  inspection: saved(["ok", null, null]),
  deleted_at: null,
  ...over,
});
const tables = (o: { job?: Row; clock?: Row[] } = {}) => ({
  profiles,
  service_jobs: [job(o.job)],
  // Roof Watch: the plan asks no cleaning question, so only the rows are in play here.
  roof_care_visits: [{ id: VISIT, plan_id: PLAN, kind: "visit1" }],
  roof_care_plans: [{ id: PLAN, plan: "watch" }],
  service_job_events: [],
  service_job_repairs: [],
  service_job_photos: [],
  service_time_entries: [{ id: 1, service_job_id: JOB, kind: "labor", hours: 1 }],
  inspection_checklist_items: checklist as unknown as Row[],
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

describe("the rule", () => {
  it("is for a Roof Care plan's own inspection, and no other ticket", () => {
    expect(isPlanInspection({ service_type: "inspection", roof_care_visit_id: VISIT })).toBe(true);
    expect(isPlanInspection({ service_type: "inspection", roof_care_visit_id: null })).toBe(false);
    expect(isPlanInspection({ service_type: "repair", roof_care_visit_id: VISIT })).toBe(false);
    expect(isPlanInspection({})).toBe(false);
  });
  it("a row is answered by OK, Issue or N/A; a blank is not; the hidden row never counts", () => {
    expect(
      rowsToAnswer([
        { label: "Seams", status: "ok" },
        { label: "Ponding", status: "issue" },
        { label: "Debris", status: "na" },
        { label: "Sealants", status: null },
        { label: "Recommend repairs", status: null },
      ]),
    ).toEqual(["Sealants"]);
  });
  it("reads what the server holds: the saved answers, then any checklist row added since", () => {
    expect(planRowsOpen(parseInspection(saved(["ok", null, null])), checklist)).toEqual([
      "Ponding",
      "Debris",
    ]);
    // Saved before "Debris" was on the checklist: the new row is open.
    expect(planRowsOpen(parseInspection(saved(["ok", "na"])), checklist)).toEqual(["Debris"]);
    expect(planRowsOpen(parseInspection(saved(["ok", "issue", "na"])), checklist)).toEqual([]);
    // Never saved: every row is open.
    expect(planRowsOpen(null, checklist)).toEqual(["Seams", "Ponding", "Debris"]);
  });
  it("names each open row, says why, and says where to answer", () => {
    expect(planRowsRefusal(["Ponding", "Debris"])).toBe(TWO);
    expect(planRowsRefusal(["Seams"])).toBe(
      `Not answered yet on the checklist: Seams. ${PLAN_ROWS_TAIL}`,
    );
    expect(planRowsRefusal([])).toBeNull();
    expect(TWO).toContain('prints "Not checked" for a row left blank');
    expect(TWO).not.toMatch(/the office/i);
  });
});

describe("the server's check before anything is written", () => {
  it("a ticket that is not a plan's inspection is never read", async () => {
    const { db } = fakeSupabase({});
    expect(
      await planRowsStop(db as never, {
        id: JOB,
        service_type: "inspection",
        roof_care_visit_id: null,
      }),
    ).toBeNull();
    expect(
      await planRowsStop(db as never, {
        id: JOB,
        service_type: "repair",
        roof_care_visit_id: VISIT,
      }),
    ).toBeNull();
  });
  it("an open row stops it; every row answered, it does not", async () => {
    const ask = { id: JOB, service_type: "inspection", roof_care_visit_id: VISIT };
    expect(await planRowsStop(fakeSupabase(tables()).db as never, ask)).toBe(TWO);
    expect(
      await planRowsStop(
        fakeSupabase(tables({ job: { inspection: saved(["ok", "issue", "na"]) } })).db as never,
        ask,
      ),
    ).toBeNull();
    // A checklist never saved has every row open.
    expect(
      await planRowsStop(fakeSupabase(tables({ job: { inspection: null } })).db as never, ask),
    ).toBe(planRowsRefusal(["Seams", "Ponding", "Debris"]));
  });
  it("a checklist that could not be read is said plainly, never let through as answered", async () => {
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "offline" } }) }),
          then: (r: (v: unknown) => void) => r({ data: null, error: { message: "offline" } }),
        }),
      }),
    };
    const said = await planRowsStop(broken as never, {
      id: JOB,
      service_type: "inspection",
      roof_care_visit_id: VISIT,
    });
    expect(said).toBe(planRowsUnchecked("offline"));
    expect(said).toContain("Nothing was changed. Try again.");
  });
});

describe("Complete (setFieldStatus done)", () => {
  it("a manager's Complete is refused with a row open, and no clock is stopped", async () => {
    const clock = [
      {
        technician_id: TECH,
        service_job_id: JOB,
        kind: "labor",
        started_at: "2026-11-23T14:00:00Z",
        helper_count: 0,
      },
    ];
    for (const who of [MANAGER, ADMIN]) {
      const f = fakeSupabase(tables({ clock }));
      await expect(complete(f.db, who)).rejects.toThrow(TWO);
      expect(f.tables["service_jobs"]![0]!["stage"]).toBe("scheduled");
      expect(f.tables["service_tech_clock"]).toHaveLength(1);
      expect(f.tables["service_time_entries"]).toHaveLength(1);
    }
  });
  it("a technician's Complete is refused too, in the same words", async () => {
    await expect(complete(fakeSupabase(tables()).db, TECH)).rejects.toThrow(TWO);
  });
  it("every row answered, it completes: for the technician and for a manager", async () => {
    for (const who of [TECH, MANAGER]) {
      const f = fakeSupabase(tables({ job: { inspection: saved(["ok", "issue", "na"]) } }));
      expect((await complete(f.db, who))["stage"]).toBe("done");
    }
  });
  it("an ordinary inspection completes with rows left blank, as before", async () => {
    const f = fakeSupabase(tables({ job: { roof_care_visit_id: null } }));
    expect((await complete(f.db, TECH))["stage"]).toBe("done");
  });
  it("a ticket the office already finished is still stamped, rows open or not", async () => {
    const f = fakeSupabase(tables({ job: { stage: "authorized" } }));
    const row = await complete(f.db, MANAGER);
    expect(row["stage"]).toBe("authorized");
    expect(row["completed_at"]).toBeTruthy();
  });
});

describe("the ticket page's stage picker (setServiceStage)", () => {
  it("a manager cannot set Done or Authorized past an open row", async () => {
    for (const stage of ["done", "authorized"]) {
      const f = fakeSupabase(tables());
      await expect(setStage(f.db, MANAGER, stage)).rejects.toThrow(TWO);
      expect(f.tables["service_jobs"]![0]!["stage"]).toBe("scheduled");
      expect(f.writes.filter((w) => w.table === "service_jobs")).toHaveLength(0);
    }
  });
  it("every row answered, the same move goes through", async () => {
    const f = fakeSupabase(tables({ job: { inspection: saved(["ok", "ok", "na"]) } }));
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
  it("an ordinary inspection and a repair are untouched", async () => {
    const plain = fakeSupabase(tables({ job: { roof_care_visit_id: null } }));
    await setStage(plain.db, MANAGER, "done");
    expect(plain.tables["service_jobs"]![0]!["stage"]).toBe("done");
    const repair = fakeSupabase(
      tables({ job: { roof_care_visit_id: null, service_type: "repair" } }),
    );
    await setStage(repair.db, MANAGER, "done");
    expect(repair.tables["service_jobs"]![0]!["stage"]).toBe("done");
  });
});

describe("what the screens say", () => {
  const rows = [
    { label: "Seams", status: "ok" as const },
    { label: "Ponding", status: null },
    { label: "Debris", status: null },
  ];
  const planJob = { service_type: "inspection", roof_care_visit_id: VISIT };
  it("the rows the workflow waits for: a plan's inspection that is not finished, and no other", () => {
    expect(planRowsWaiting(planJob, rows, false)).toEqual(["Ponding", "Debris"]);
    expect(planRowsWaiting(planJob, rows, true)).toEqual([]);
    expect(planRowsWaiting({ ...planJob, roof_care_visit_id: null }, rows, false)).toEqual([]);
  });
  it("how many are left, by name", () => {
    expect(planRowsLine(["Ponding", "Debris"])).toBe(
      "2 rows still need an answer: Ponding, Debris.",
    );
    expect(planRowsLine(["Ponding"])).toBe("1 row still needs an answer: Ponding.");
    expect(planRowsLine([])).toBeNull();
  });
  it("the line under the Checklist step's Next names the rows; other steps keep their own", () => {
    expect(planRowsStepMissing("checklist", "Save the checklist", ["Ponding"])).toBe(
      "1 row still needs an answer: Ponding.",
    );
    expect(planRowsStepMissing("checklist", "Save the checklist", [])).toBe("Save the checklist");
    expect(planRowsStepMissing("checklist", null, [])).toBeNull();
    expect(planRowsStepMissing("time", "Log your time", ["Ponding"])).toBe("Log your time");
  });
  it("Before you finish lists each open row, and the note says where to go", () => {
    expect(planRowsGaps(["Ponding", "Debris"])).toEqual([
      "Checklist row not answered: Ponding",
      "Checklist row not answered: Debris",
    ]);
    expect(PLAN_ROWS_REQUIRED_NOTE).toContain("Checklist step");
    expect(PLAN_ROWS_WHY).toContain('prints "Not checked" for a row left blank');
    for (const words of [PLAN_ROWS_REQUIRED_NOTE, PLAN_ROWS_WHY, ROW_NEEDS_ANSWER])
      expect(words).not.toMatch(/the office|the app\b/i);
    expect(PLAN_ROWS_GO_FIRST).toBe("Go to the first one");
  });
});

describe("the workflow", () => {
  const s = flat("src/components/service/closeout.tsx");
  it("the Checklist step waits for the rows, and its line names them first", () => {
    expect(s).toContain(
      "const planRowsOpen = planRowsWaiting(job, insp.items, FINISHED.includes(job.stage));",
    );
    expect(s).toContain("if (planRowsOpen.length > 0) stepState.checklistSaved = false;");
    expect(s).toContain(
      "missing: planRowsStepMissing( id, cleaningStepMissing(id, stepMissing(id, stepState), checklistSaved, cleaning, finished), planRowsOpen, ),",
    );
  });
  it("Complete lists the open rows, says the note, and offers no Complete anyway", () => {
    expect(s).toContain("gaps: [...base.gaps, ...planRowsGaps(planRowsOpen), ...plan.gaps],");
    expect(s).toContain('data-line="plan-rows-required"');
    expect(s).toContain("{PLAN_ROWS_REQUIRED_NOTE}");
    expect(s).toContain(
      "{manager && !planQuestionsOpen && planRowsOpen.length === 0 && ( <AlertDialogAction",
    );
    expect(s).not.toContain("{manager && !planQuestionsOpen && ( <AlertDialogAction");
  });
  it("both screens mark the rows of a plan's inspection that is not finished yet", () => {
    const need = "needAnswers={isPlanInspection(job) && !inspectionComplete(job.stage)}";
    expect(flat("src/components/service/inspection-closeout.tsx")).toContain(need);
    expect(flat("src/components/service/inspection-section.tsx")).toContain(need);
  });
  it("a row with no answer is marked, and the notice goes to the first one", () => {
    const rows = flat("src/components/service/inspection-section.tsx");
    expect(rows).toContain("const open = needAnswers ? rowsToAnswer(items) : [];");
    expect(rows).toContain("const needsAnswer = needAnswers && item.status === null;");
    expect(rows).toContain('data-row-needs-answer={needsAnswer ? "yes" : undefined}');
    expect(rows).toContain("{ROW_NEEDS_ANSWER}");
    expect(rows).toContain("<p>{PLAN_ROWS_WHY}</p>");
    expect(rows).toContain('<span data-line="plan-rows-left">{planRowsLine(open)}</span>');
    expect(rows).toContain(
      'const row = rowsBox.current?.querySelector<HTMLElement>("[data-row-needs-answer]");',
    );
    expect(rows).toContain('row.scrollIntoView({ block: "center", behavior: "smooth" });');
    expect(rows).toContain("onClick={goFirst}");
    // Without the prop nothing of it is drawn: an ordinary inspection looks as it did.
    expect(rows).toContain("needAnswers = false,");
    expect(rows).toContain("{needAnswers && ( <div");
  });
});

describe("where it is enforced", () => {
  it("both server functions check before a clock is touched", () => {
    const field = flat("src/lib/service-field.functions.ts");
    const stop = field.indexOf("const rows = await planRowsStop(sb, job);");
    expect(stop).toBeGreaterThan(-1);
    // Before the manager's exemption from the other gaps, and before the clock moves.
    expect(stop).toBeLessThan(field.indexOf("if (!finished && !managesTickets(p)) {"));
    expect(stop).toBeLessThan(
      field.indexOf(
        'if ((await applyClock(t)) === "moved") return moved; transition = report(t); if (!t.changed && laborFromStamp)',
      ),
    );
    const stage = flat("src/lib/service.functions.ts");
    const at = stage.indexOf(
      "const rows = await planRowsStop(context.supabase, { id: data.id, ...prev });",
    );
    expect(at).toBeGreaterThan(stage.indexOf("if (completesTicket(prev.stage, data.stage)) {"));
    expect(at).toBeLessThan(stage.indexOf("? await stopClocksForOffice("));
  });
  it("the database refuses the move for everybody, in the same words", () => {
    const sql = read("supabase/migrations/20261124100000_roof_care_checklist_answers.sql");
    const one = sql.replace(/\s+/g, " ");
    expect(one).toContain(
      "create trigger service_jobs_checklist_rule before update of stage on public.service_jobs",
    );
    // Only a plan's own inspection, and only the move into Done or later.
    expect(one).toContain(
      "if new.roof_care_visit_id is null or new.service_type is distinct from 'inspection' or new.stage not in ('done', 'authorized', 'invoiced', 'closed') or coalesce(old.stage, '') in ('done', 'authorized', 'invoiced', 'closed') then return new; end if;",
    );
    // Nobody is exempt: the function never asks who is calling.
    expect(sql).not.toMatch(/is_admin|is_manager|auth\.uid|auth\.role|service_role/);
    // An answer is OK, Issue or N/A; the hidden row is never counted.
    expect(one).toContain("where coalesce(r.status, '') not in ('ok', 'issue', 'na')");
    expect(one).toContain("and lower(btrim(coalesce(r.label, ''))) <> 'recommend repairs';");
    // The sentence the server says, built from the same parts.
    const said = one.match(
      /raise exception '(Not answered yet on the checklist: %[^;]+)', v_open;/,
    );
    expect(said?.[1]).toBeTruthy();
    expect(said![1]!.replace("%", "Ponding, Debris").replace(/''/g, "'")).toBe(TWO);
    // It touches nothing but its own function and trigger.
    expect(sql).not.toMatch(/roof_care_start|public_request_|crm_opportunities/);
  });
});
