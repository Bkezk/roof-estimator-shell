/**
 * The inspection close-out flow (owner, Oct 12). An Inspection ticket used to go through the
 * seven repair steps — "Before" / "The work" with a repair picker and "Inspection — no repairs"
 * summaries, nothing checking the checklist, a manual "Save inspection" lost on Complete, photos
 * needing a fake repair, two notes boxes, two recommend fields, the outcome never recorded. Now:
 *
 *   1. closeoutSteps("inspection") is six steps — crew, checklist, findings, materials, time,
 *      signature — and every helper takes the service type ("Step 2 of 6"); leak, warranty, scope
 *      and other keep the seven (closeout-steps.ts).
 *   2. The rules: checklist done when every visible item is answered AND saved; findings done
 *      with a note, a switch or Nothing to add; materials never block (Nothing used pre-set);
 *      time required; signature optional; photos optional everywhere.
 *   3. The gap list (closeout-check.ts) and the server's refusal (service-field.functions.ts
 *      setFieldStatus "done"): "N checklist items unanswered"; no photo / signature gap.
 *   4. The checklist autosaves (inspection-draft.ts) on both screens; "Recommend repairs" rides
 *      in the inspection JSON; the hidden "Recommend repairs" seed row.
 *   5. Photos per item (role "other", item_key) and the findings roll.
 *   6. The outcome: repair_ticket / bid / none recorded with who and when; Warranty repair type.
 *   7. The Done notice: "Inspection #N <customer> is done — N issues found, recommends … — ready
 *      for your review".
 *   8. The migration and the screens' markup.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.hoisted(() =>
  vi.fn<(ids: string[], msg: { kind: string; title: string }, sb: unknown) => Promise<number>>(
    async () => 1,
  ),
);
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify,
}));
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));

import {
  CLOSEOUT_STEPS,
  INSPECTION_STEPS,
  closeoutSteps,
  finishStepLabel,
  firstOpenStep,
  lockedLine,
  nextStep,
  nextStepLabel,
  shownOpenStep,
  stepCount,
  stepDone,
  stepHeadline,
  stepIndex,
  stepMissing,
  stepOf,
  stepStatuses,
  stepSummary,
  type StepId,
  type StepState,
} from "@/lib/closeout-steps";
import { closeoutGaps, completeGaps, missingForComplete } from "@/lib/closeout-check";
import {
  DEFAULT_CHECKLIST,
  INSPECTION_OUTCOMES,
  OUTCOME_LABELS,
  RECOMMEND_REPAIRS_LABEL,
  hiddenChecklistItem,
  inspectionDoneTitle,
  inspectionSchema,
  outcomeLine,
  parseInspection,
  recommendationText,
  unansweredCount,
  unansweredGap,
  unansweredItems,
  visibleChecklist,
  type ChecklistItem,
  type Inspection,
} from "@/lib/inspection";
import { setFieldStatus } from "@/lib/service-field.functions";
import {
  createRepairFromInspection,
  getTicketInspection,
  saveTicketInspection,
  setInspectionOutcome,
} from "@/lib/service-inspection.functions";
import { afterTicketStage, doneTitle } from "@/lib/ticket-events.server";
import { syncFollowup } from "@/lib/followups.server";
import type { Client } from "@/lib/notify.server";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const closeout = read("src/components/service/closeout.tsx");
const form = closeout.slice(
  closeout.indexOf("function CloseoutForm("),
  closeout.indexOf("// (b) Repairs"),
);
const inspectionBranch = form.slice(
  form.indexOf("{inspection ? ("),
  form.indexOf(") : (", form.indexOf("{inspection ? (")),
);
const cards = read("src/components/service/inspection-closeout.tsx");
const camera = read("src/components/service/inspection-camera.ts");
const section = read("src/components/service/inspection-section.tsx");
const draftHook = read("src/components/service/inspection-draft.ts");
const steps = read("src/lib/closeout-steps.ts");
const check = read("src/lib/closeout-check.ts");
const fieldFn = read("src/lib/service-field.functions.ts");
const inspFn = read("src/lib/service-inspection.functions.ts");
const migration = read("supabase/migrations/20261012190000_inspection_flow.sql");
const types = read("src/integrations/supabase/types.ts");

// ── 1. The steps ──────────────────────────────────────────────────────────────────────────

const IDS = (list: readonly { id: string }[]) => list.map((s) => s.id);

describe("1. closeoutSteps(serviceType): six for an inspection, the seven repair steps for the rest", () => {
  it("an inspection: crew → checklist → findings → materials → time → signature, numbered 1–6", () => {
    expect(IDS(closeoutSteps("inspection"))).toEqual([
      "crew",
      "checklist",
      "findings",
      "materials",
      "time",
      "signature",
    ]);
    expect(closeoutSteps("inspection")).toBe(INSPECTION_STEPS);
    expect(INSPECTION_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(INSPECTION_STEPS.map((s) => s.title)).toEqual([
      "Who is here",
      "Checklist",
      "Findings",
      "Materials",
      "Time",
      "Signature",
    ]);
    for (const s of INSPECTION_STEPS) expect(s.unlocks.length).toBeGreaterThan(0);
    expect(stepCount("inspection")).toBe(6);
  });
  it("leak, warranty, scope, other and no type: the seven repair steps, unchanged (scope stays on the repair flow)", () => {
    for (const t of ["leak", "warranty", "scope", "other", undefined, null])
      expect(closeoutSteps(t)).toBe(CLOSEOUT_STEPS);
    expect(IDS(CLOSEOUT_STEPS)).toEqual([
      "crew",
      "before",
      "work",
      "materials",
      "time",
      "notes",
      "signature",
    ]);
    expect(stepCount("scope")).toBe(7);
    expect(steps).toContain("SCOPE and other keep the seven repair steps");
    expect(closeout).toContain("SCOPE and other keep the seven repair steps");
  });
  it("stepOf / stepIndex / nextStep / nextStepLabel walk the flow of the type given", () => {
    expect(stepOf("signature", "inspection").n).toBe(6);
    expect(stepOf("signature").n).toBe(7);
    expect(stepIndex("materials", "inspection")).toBe(3);
    expect(stepIndex("time", "inspection")).toBe(4);
    expect(nextStep("crew", "inspection")).toBe("checklist");
    expect(nextStep("checklist", "inspection")).toBe("findings");
    expect(nextStep("findings", "inspection")).toBe("materials");
    expect(nextStep("materials", "inspection")).toBe("time");
    expect(nextStep("time", "inspection")).toBe("signature");
    expect(nextStep("signature", "inspection")).toBeNull();
    expect(nextStepLabel("checklist", "inspection")).toBe("Next step: Findings");
    expect(nextStepLabel("time", "inspection")).toBe("Next step: Signature");
    // The repair flow still goes Time → Notes.
    expect(nextStep("time")).toBe("notes");
    expect(nextStepLabel("time", "leak")).toBe("Next step: Notes");
    // A step the flow does not have is unknown to it.
    expect(() => stepOf("before", "inspection")).toThrow(/Unknown close-out step/);
    expect(() => stepOf("checklist")).toThrow(/Unknown close-out step/);
  });
  it('the headline says "Step n of 6" on an inspection, "of 7" on a repair; the locked and finish lines follow', () => {
    expect(stepHeadline("checklist", "inspection")).toBe("Step 2 of 6 · Checklist");
    expect(stepHeadline("signature", "inspection")).toBe("Step 6 of 6 · Signature");
    expect(stepHeadline(null, "inspection")).toBe("All 6 steps done — press Complete");
    expect(stepHeadline("work")).toBe("Step 3 of 7 · The work");
    expect(stepHeadline(null)).toBe("All 7 steps done — press Complete");
    expect(lockedLine("findings", "inspection")).toBe("Locked — finish step 3: Findings first");
    expect(finishStepLabel("time", "inspection")).toBe("Finish step 5: Time");
    expect(finishStepLabel("time")).toBe("Finish step 5: Time");
  });
  it("shownOpenStep compares positions within the flow given", () => {
    expect(shownOpenStep("checklist", "signature", "inspection")).toBe("checklist");
    expect(shownOpenStep("signature", "checklist", "inspection")).toBe("checklist");
    expect(shownOpenStep(null, "findings", "inspection")).toBe("findings");
  });
});

// ── 2. The rules ──────────────────────────────────────────────────────────────────────────

const answered = (status: "ok" | "issue" | "na" | null) => ({ status });
/** An inspection with everything answered and saved, findings written, time logged, unsigned. */
const whole: StepState = {
  finished: false,
  crewAnswered: true,
  serviceType: "inspection",
  repairs: [],
  photos: [],
  materialsTouched: false,
  timeHours: 1.5,
  onSiteAt: null,
  closingNotes: "Seams open along the north parapet; ponding at the east drain.",
  notesSkipped: false,
  signaturePath: null,
  crewOthers: 0,
  materialItems: 0,
  signedBy: "",
  checklist: [answered("ok"), answered("issue"), answered("na"), answered("ok")],
  checklistSaved: true,
  recommendRepairs: false,
  recommendNewRoof: false,
};
const statusList = (s: StepState, open?: StepId | null) =>
  stepStatuses(s, open === undefined ? firstOpenStep(s) : open).map((x) => x.status);

describe("2a. the checklist step: every visible item answered AND saved on the server", () => {
  it("done with every item answered and saved; the Next line counts what is left, then asks for the save", () => {
    expect(stepDone("checklist", whole)).toBe(true);
    expect(stepMissing("checklist", whole)).toBeNull();
    const two = { ...whole, checklist: [answered("ok"), answered(null), answered(null)] };
    expect(stepDone("checklist", two)).toBe(false);
    expect(stepMissing("checklist", two)).toBe("Answer every item (2 left)");
    const one = { ...whole, checklist: [answered("ok"), answered(null)] };
    expect(stepMissing("checklist", one)).toBe("Answer every item (1 left)");
    const unsaved = { ...whole, checklistSaved: false };
    expect(stepDone("checklist", unsaved)).toBe(false);
    expect(stepMissing("checklist", unsaved)).toBe("Save the checklist");
    // Nothing answered yet: the checklist is current, the rest locked.
    const fresh = {
      ...whole,
      checklist: [answered(null), answered(null)],
      closingNotes: "",
      timeHours: 0,
    };
    expect(firstOpenStep(fresh)).toBe("checklist");
    expect(statusList(fresh)).toEqual(["done", "current", "locked", "done", "locked", "done"]);
  });
  it("the summary is the inspection's counts", () => {
    expect(stepSummary("checklist", whole)).toBe("1 issue · 2 OK · 1 N/A");
    expect(
      stepSummary("checklist", { ...whole, checklist: [answered(null), answered("ok")] }),
    ).toBe("1 OK · 1 not checked");
    expect(stepSummary("checklist", { ...whole, checklist: [] })).toBe("nothing to check");
  });
});

describe("2b. the findings step: a note, a switch on, or Nothing to add", () => {
  const blank = { ...whole, closingNotes: "" };
  it("done by any of the three; otherwise the Next line names them", () => {
    expect(stepDone("findings", whole)).toBe(true);
    expect(stepDone("findings", blank)).toBe(false);
    expect(stepMissing("findings", blank)).toBe(
      "Write what you found, turn a switch on, or press Nothing to add",
    );
    expect(stepDone("findings", { ...blank, recommendRepairs: true })).toBe(true);
    expect(stepDone("findings", { ...blank, recommendNewRoof: true })).toBe(true);
    expect(stepDone("findings", { ...blank, notesSkipped: true })).toBe(true);
    expect(stepDone("findings", { ...blank, closingNotes: "   " })).toBe(false);
    expect(firstOpenStep(blank)).toBe("findings");
  });
  it("the summary: the note's first line, else what it recommends, else Nothing to add / No findings", () => {
    expect(stepSummary("findings", whole)).toBe(whole.closingNotes);
    const long = "Open seams along the north parapet wall near the drain. ".repeat(3);
    const out = stepSummary("findings", { ...whole, closingNotes: long });
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(81);
    expect(stepSummary("findings", { ...blank, recommendRepairs: true })).toBe(
      "Recommends repairs",
    );
    expect(stepSummary("findings", { ...blank, recommendNewRoof: true })).toBe(
      "Recommends a new roof",
    );
    expect(
      stepSummary("findings", { ...blank, recommendRepairs: true, recommendNewRoof: true }),
    ).toBe("Recommends repairs and a new roof");
    expect(stepSummary("findings", { ...blank, notesSkipped: true })).toBe("Nothing to add");
    expect(stepSummary("findings", blank)).toBe("No findings");
    // A note wins over the switches in the summary (the switches show on the card).
    expect(stepSummary("findings", { ...whole, recommendRepairs: true })).toBe(whole.closingNotes);
  });
});

describe("2c. materials never block an inspection; time is required; the signature is optional", () => {
  it("materials: done with nothing touched on an inspection (Nothing used pre-set), still done with rows", () => {
    expect(stepDone("materials", whole)).toBe(true);
    expect(stepMissing("materials", whole)).toBeNull();
    expect(stepSummary("materials", whole)).toBe("No materials");
    expect(stepSummary("materials", { ...whole, materialsTouched: true })).toBe("Nothing used");
    expect(stepSummary("materials", { ...whole, materialsTouched: true, materialItems: 2 })).toBe(
      "2 items logged",
    );
    // A repair ticket still waits.
    expect(stepDone("materials", { ...whole, serviceType: "leak" })).toBe(false);
  });
  it("time: hours above zero or an On site stamp, as on a repair", () => {
    expect(stepDone("time", whole)).toBe(true);
    const none = { ...whole, timeHours: 0 };
    expect(stepDone("time", none)).toBe(false);
    expect(stepMissing("time", none)).toBe("Add the time (Add travel, or Add time)");
    expect(firstOpenStep(none)).toBe("time");
    expect(stepDone("time", { ...none, onSiteAt: "2026-10-12T13:00:00Z" })).toBe(true);
  });
  it("signature: always done on an inspection, never missing; the summary still says Signed by / Not signed", () => {
    expect(stepDone("signature", whole)).toBe(true);
    expect(stepMissing("signature", whole)).toBeNull();
    expect(stepSummary("signature", whole)).toBe("Not signed");
    expect(
      stepSummary("signature", { ...whole, signaturePath: "x/sig.png", signedBy: "Pat Ortiz" }),
    ).toBe("Signed by Pat Ortiz");
    expect(stepSummary("signature", { ...whole, signaturePath: "x/sig.png" })).toBe("Signed");
    // Everything answered, written and timed: nothing open even without a signature.
    expect(firstOpenStep(whole)).toBeNull();
    expect(statusList(whole)).toEqual(Array<string>(6).fill("done"));
    // A repair ticket still needs it.
    expect(stepDone("signature", { ...whole, serviceType: "leak" })).toBe(false);
  });
  it("a finished inspection: every step done", () => {
    const s = { ...whole, finished: true, checklist: [answered(null)], timeHours: 0 };
    expect(statusList(s)).toEqual(Array<string>(6).fill("done"));
  });
});

// ── 3. The gaps ───────────────────────────────────────────────────────────────────────────

const ok = (label: string) => ({ label, status: "ok" as const });
const open = (label: string) => ({ label, status: null });
const reads = {
  repairs: { data: [], error: null },
  photos: { data: [], error: null },
  time: { data: [{ hours: 1 }], error: null },
};

describe("3. completeGaps / closeoutGaps on an inspection", () => {
  it("unanswered items are a gap, counted; answered and saved with time: none — no photo, no signature asked", () => {
    const base = {
      finished: false,
      service_type: "inspection",
      signature_path: null,
      on_site_at: null,
      ...reads,
      checklist_saved: true,
    };
    expect(
      completeGaps({ ...base, checklist: { data: [ok("Seams"), ok("Drains")], error: null } }),
    ).toEqual({ gaps: [], unread: false });
    expect(
      completeGaps({
        ...base,
        checklist: { data: [ok("Seams"), open("Drains"), open("Ponding")], error: null },
      }).gaps,
    ).toEqual(["2 checklist items unanswered"]);
    expect(
      completeGaps({ ...base, checklist: { data: [open("Drains")], error: null } }).gaps,
    ).toEqual(["1 checklist item unanswered"]);
    // The hidden "Recommend repairs" row never counts.
    expect(
      completeGaps({
        ...base,
        checklist: { data: [ok("Seams"), open("Recommend repairs")], error: null },
      }).gaps,
    ).toEqual([]);
  });
  it("an unsaved draft is a gap; no time is a gap; a checklist read with no rows is a line with Retry", () => {
    const base = {
      finished: false,
      service_type: "inspection",
      signature_path: null,
      on_site_at: null,
      ...reads,
      checklist: { data: [ok("Seams")], error: null },
    };
    expect(completeGaps({ ...base, checklist_saved: false }).gaps).toEqual([
      "The checklist is not saved yet",
    ]);
    expect(
      completeGaps({ ...base, checklist_saved: true, time: { data: [], error: null } }).gaps,
    ).toEqual(["No time logged"]);
    const loading = completeGaps({
      ...base,
      checklist_saved: true,
      checklist: { data: undefined, error: null },
    });
    expect(loading).toEqual({ gaps: ["Still loading the checklist"], unread: true });
    const failed = completeGaps({
      ...base,
      checklist_saved: true,
      checklist: { data: undefined, error: new Error("no signal") },
    });
    expect(failed.gaps[0]).toBe("Could not check the checklist — no signal (no signal)");
    // The repairs and photos reads are not judged on an inspection, even unanswered.
    expect(
      completeGaps({
        ...base,
        checklist_saved: true,
        repairs: { data: undefined, error: null },
        photos: { data: undefined, error: null },
      }),
    ).toEqual({ gaps: [], unread: false });
  });
  it("closeoutGaps (the server): the saved JSON merged with the live checklist; an item added since is unanswered", () => {
    const checklist: ChecklistItem[] = [
      { id: "c1", label: "Seams", sort: 10 },
      { id: "c2", label: "Drains", sort: 20 },
      { id: "c3", label: "Recommend repairs", sort: 30 },
    ];
    const saved: Inspection = {
      v: 1,
      items: [
        { id: "c1", label: "Seams", status: "issue", note: "open at NE" },
        { id: "c2", label: "Drains", status: "ok", note: "" },
      ],
      notes: "",
      recommend_repairs: true,
      saved_at: "2026-10-12T15:00:00Z",
      saved_by: "Ted",
      inspected_on: null,
      grade: null,
    };
    const rows = {
      service_type: "inspection",
      signature_path: null,
      on_site_at: null,
      repairs: [],
      photos: [],
      time: [{ hours: 0.5 }],
      inspection: saved,
      checklist,
    };
    expect(closeoutGaps(rows)).toEqual([]);
    expect(closeoutGaps({ ...rows, inspection: null })).toEqual(["2 checklist items unanswered"]);
    expect(
      closeoutGaps({
        ...rows,
        checklist: [...checklist, { id: "c4", label: "Ponding", sort: 40 }],
      }),
    ).toEqual(["1 checklist item unanswered"]);
    expect(closeoutGaps({ ...rows, time: [] })).toEqual(["No time logged"]);
    // A repair ticket's list is unchanged.
    expect(
      closeoutGaps({
        ...rows,
        service_type: "leak",
        repairs: [{ id: "r1", name: "Seam" }],
        photos: [{ repair_id: "r1", role: "before" }],
      }),
    ).toEqual(["Seam has no After photo", "No customer signature"]);
    // missingForComplete (the older helper) agrees: no signature gap on an inspection.
    expect(
      missingForComplete({
        service_type: "inspection",
        repairs: [],
        photos: [],
        signature_path: null,
      }),
    ).toEqual([]);
  });
  it("the pure helpers: hidden row, unanswered count, the gap's words", () => {
    expect(RECOMMEND_REPAIRS_LABEL).toBe("Recommend repairs");
    expect(hiddenChecklistItem(" recommend REPAIRS ")).toBe(true);
    expect(hiddenChecklistItem("Seams")).toBe(false);
    expect(visibleChecklist([ok("Seams"), open("Recommend repairs")])).toEqual([ok("Seams")]);
    expect(unansweredItems([ok("Seams"), open("Drains"), open("Recommend repairs")])).toEqual([
      open("Drains"),
    ]);
    const checklist: ChecklistItem[] = DEFAULT_CHECKLIST.map((label, i) => ({
      id: `c${i}`,
      label,
      sort: i,
    }));
    // Ten seeded rows, one hidden: nine to answer.
    expect(unansweredCount(null, checklist)).toBe(9);
    expect(unansweredGap(1)).toBe("1 checklist item unanswered");
    expect(unansweredGap(3)).toBe("3 checklist items unanswered");
    // The seed stays where it was: in the migration (the live table), mirrored in DEFAULT_CHECKLIST.
    expect(DEFAULT_CHECKLIST).toContain("Recommend repairs");
    expect(read("supabase/migrations/20260930092000_ticket_aerial_inspection.sql")).toContain(
      "('Recommend repairs', 100)",
    );
    expect(migration).not.toContain("delete from public.inspection_checklist_items");
  });
});

// ── 4. The server ─────────────────────────────────────────────────────────────────────────

const JOB = "11111111-1111-4111-8111-111111111111";
const TECH = "22222222-2222-4222-8222-222222222222";
const MANAGER = "33333333-3333-4333-8333-333333333333";
const OFFICE = "44444444-4444-4444-8444-444444444444";
const profiles: Row[] = [
  {
    id: TECH,
    role: "user",
    access: ["service"],
    technician: true,
    full_name: "Ted Tech",
    email: "ted@example.test",
  },
  {
    id: MANAGER,
    role: "manager",
    access: [],
    technician: false,
    full_name: "Mo Manager",
    email: "mo@example.test",
  },
  {
    id: OFFICE,
    role: "user",
    access: ["service"],
    technician: false,
    full_name: "Olive Office",
    email: "olive@example.test",
  },
];
const checklistRows: Row[] = [
  { id: "c1", label: "Seams", sort: 10 },
  { id: "c2", label: "Drains", sort: 20 },
  { id: "c3", label: "Recommend repairs", sort: 30 },
];
const savedJson = (over: Partial<Inspection> = {}): Inspection => ({
  v: 1,
  items: [
    { id: "c1", label: "Seams", status: "issue", note: "open at NE" },
    { id: "c2", label: "Drains", status: "ok", note: "" },
  ],
  notes: "",
  recommend_repairs: false,
  saved_at: "2026-10-12T15:00:00Z",
  saved_by: "Ted Tech",
  inspected_on: null,
  grade: null,
  ...over,
});
const job = (over: Row = {}): Row => ({
  id: JOB,
  number: 6012,
  customer_name: "Acme",
  description: "Annual inspection",
  service_type: "inspection",
  technician_id: TECH,
  stage: "scheduled",
  field_status: null,
  en_route_at: null,
  on_site_at: null,
  completed_at: null,
  signature_path: null,
  helper_count: 0,
  scheduled_date: "2026-10-12",
  inspection: null,
  closing_notes: null,
  recommend_new_roof: false,
  account_id: null,
  site_id: null,
  contact_id: null,
  site_name: null,
  site_address: null,
  labor_rate_kind: "standard",
  po_number: null,
  deleted_at: null,
  from_job_id: null,
  inspection_outcome: null,
  inspection_outcome_at: null,
  inspection_outcome_by: null,
  ...over,
});
type Fn = (a: { data: Row; context: unknown }) => Promise<unknown>;
const call = <T>(fn: unknown, data: Row, tables: Record<string, Row[]>, userId: string) =>
  (fn as Fn)({
    data,
    context: { supabase: fakeSupabase({ profiles, service_job_events: [], ...tables }).db, userId },
  }) as Promise<T>;
const envWith = (jobRow: Row) => ({
  service_job_events: [] as Row[],
  service_jobs: [jobRow],
  service_job_repairs: [] as Row[],
  service_job_photos: [] as Row[],
  service_time_entries: [{ id: 1, service_job_id: JOB, kind: "labor", hours: 1 }] as Row[],
  inspection_checklist_items: checklistRows.map((r) => ({ ...r })),
});

describe("4a. setFieldStatus 'done' on an inspection", () => {
  it("refuses a technician while a checklist item is unanswered (the saved JSON merged with the live checklist); nothing written", async () => {
    const tables = envWith(job({ inspection: savedJson({ items: [savedJson().items[0]!] }) }));
    await expect(call(setFieldStatus, { id: JOB, to: "done" }, tables, TECH)).rejects.toThrow(
      "The close-out is not complete: 1 checklist item unanswered. Add what is missing, then press Complete again.",
    );
    expect(tables.service_jobs[0]).toMatchObject({ stage: "scheduled", completed_at: null });
    // Never saved at all: both visible items are unanswered (the hidden row is not counted).
    const none = envWith(job());
    await expect(call(setFieldStatus, { id: JOB, to: "done" }, none, TECH)).rejects.toThrow(
      "2 checklist items unanswered",
    );
  });
  it("lets a technician through with every item answered and time logged — no photo, no signature", async () => {
    const tables = envWith(job({ inspection: savedJson() }));
    const row = await call<Row>(setFieldStatus, { id: JOB, to: "done" }, tables, TECH);
    expect(row["stage"]).toBe("done");
    expect(tables.service_job_photos).toEqual([]);
  });
  it("no time is still a gap; a manager completes anyway", async () => {
    const tables = { ...envWith(job({ inspection: savedJson() })), service_time_entries: [] };
    await expect(call(setFieldStatus, { id: JOB, to: "done" }, tables, TECH)).rejects.toThrow(
      "The close-out is not complete: No time logged.",
    );
    const asManager = envWith(job());
    const row = await call<Row>(setFieldStatus, { id: JOB, to: "done" }, asManager, MANAGER);
    expect(row["stage"]).toBe("done");
  });
  it("reads the live checklist only on an inspection and hands the JSON to closeoutGaps", () => {
    expect(fieldFn).toContain('const inspection = job.service_type === "inspection";');
    expect(fieldFn).toMatch(
      /inspection\s*\?\s*sb\.from\("inspection_checklist_items"\)\.select\("id, label, sort"\)\s*:\s*Promise\.resolve\(\{ data: \[\], error: null \}\)/,
    );
    expect(fieldFn).toMatch(/inspection: job\.inspection,\s*checklist: checklist\.data \?\? \[\],/);
    expect(check).toContain("export function closeoutGaps(rows: CloseoutRows): string[] {");
  });
});

describe("4b. saveTicketInspection carries the switch; the outcome; Warranty", () => {
  it("saves recommend_repairs with the items and keeps the older notes when the close-out leaves them out", async () => {
    const tables = envWith(job({ inspection: savedJson({ notes: "Old notes" }) }));
    const ins = await call<Inspection>(
      saveTicketInspection,
      {
        id: JOB,
        inspection: { items: savedJson().items, recommend_repairs: true },
      },
      tables,
      TECH,
    );
    expect(ins.recommend_repairs).toBe(true);
    expect(ins.notes).toBe("Old notes");
    expect(ins.saved_by).toBe("Ted Tech");
    expect(parseInspection(tables.service_jobs[0]!["inspection"])?.recommend_repairs).toBe(true);
    // The schema reads an older save (no flag) as false.
    expect(inspectionSchema.parse({ v: 1, items: [], notes: "" }).recommend_repairs).toBe(false);
  });
  it("createRepairFromInspection takes Warranty, prefills from the closing notes when the JSON has none, and records the outcome", async () => {
    const tables = envWith(
      job({
        stage: "done",
        inspection: savedJson(),
        closing_notes: "Roof is tired; two open seams.",
      }),
    );
    const made = await call<{ id: string; number: number; existing: boolean }>(
      createRepairFromInspection,
      { id: JOB, service_type: "warranty", scheduled_date: "2026-10-20" },
      tables,
      MANAGER,
    );
    expect(made.existing).toBe(false);
    const repair = tables.service_jobs.find((j) => j["from_job_id"] === JOB)!;
    expect(repair["service_type"]).toBe("warranty");
    expect(String(repair["notes"])).toContain("Inspection notes:\nRoof is tired; two open seams.");
    expect(tables.service_jobs[0]).toMatchObject({
      inspection_outcome: "repair_ticket",
      inspection_outcome_by: MANAGER,
    });
    expect(typeof tables.service_jobs[0]!["inspection_outcome_at"]).toBe("string");
    expect(inspFn).toContain('service_type: z.enum(["leak", "warranty", "other"]),');
  });
  it("setInspectionOutcome 'none' / 'bid': the office or a manager on a Done inspection; a technician is refused", async () => {
    const tables = envWith(job({ stage: "done", inspection: savedJson() }));
    const rec = await call<{ outcome: string; at: string; by: string | null }>(
      setInspectionOutcome,
      { id: JOB, outcome: "none" },
      tables,
      OFFICE,
    );
    expect(rec).toMatchObject({ outcome: "none", by: "Olive Office" });
    expect(tables.service_jobs[0]).toMatchObject({
      inspection_outcome: "none",
      inspection_outcome_by: OFFICE,
    });
    expect(tables.service_job_events[0]).toMatchObject({
      kind: "note",
      note: "Inspection outcome: no action needed",
    });
    await expect(
      call(setInspectionOutcome, { id: JOB, outcome: "bid" }, tables, TECH),
    ).rejects.toThrow("Only the office or a manager records the inspection's outcome");
    const notDone = envWith(job({ inspection: savedJson() }));
    await expect(
      call(setInspectionOutcome, { id: JOB, outcome: "none" }, notDone, MANAGER),
    ).rejects.toThrow("The inspection is not done yet; mark it Done first");
    // Only bid and none from here; a repair ticket records itself (the validator refuses it).
    await expect(
      Promise.resolve().then(() =>
        call(setInspectionOutcome, { id: JOB, outcome: "repair_ticket" }, tables, MANAGER),
      ),
    ).rejects.toThrow();
  });
  it("getTicketInspection returns the outcome with who and when", async () => {
    const tables = envWith(
      job({
        stage: "done",
        inspection: savedJson(),
        inspection_outcome: "none",
        inspection_outcome_at: "2026-10-12T16:00:00Z",
        inspection_outcome_by: MANAGER,
      }),
    );
    const got = await call<{ outcome: Row | null }>(getTicketInspection, { id: JOB }, tables, TECH);
    expect(got.outcome).toEqual({ outcome: "none", at: "2026-10-12T16:00:00Z", by: "Mo Manager" });
    const none = await call<{ outcome: Row | null }>(
      getTicketInspection,
      { id: JOB },
      envWith(job()),
      TECH,
    );
    expect(none.outcome).toBeNull();
  });
  it("the outcome's words", () => {
    expect(INSPECTION_OUTCOMES).toEqual(["repair_ticket", "bid", "none"]);
    expect(OUTCOME_LABELS).toEqual({
      repair_ticket: "Repair ticket",
      bid: "Bid",
      none: "No action needed",
    });
    expect(
      outcomeLine({ outcome: "repair_ticket", detail: "#6013", by: "Mo Manager", when: "Oct 12" }),
    ).toBe("Outcome: Repair ticket #6013 — by Mo Manager, Oct 12");
    expect(
      outcomeLine({ outcome: "bid", detail: "Acme — Main St", by: "Olive", when: "Oct 12" }),
    ).toBe("Outcome: Bid Acme — Main St — by Olive, Oct 12");
    expect(outcomeLine({ outcome: "none", by: "Olive Office", when: "Oct 12" })).toBe(
      "Outcome: No action needed — by Olive Office, Oct 12",
    );
    expect(outcomeLine({ outcome: "none" })).toBe("Outcome: No action needed");
  });
});

// ── 5. The Done notice ────────────────────────────────────────────────────────────────────

describe("5. the Done notice for an inspection", () => {
  let errorLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorLog.mockRestore());
  const base = {
    id: "job-1",
    number: 6012,
    customer_name: "Acme",
    description: "Annual inspection",
    stage: "done",
    account_id: null,
    technician_id: TECH,
    created_by: OFFICE,
    deleted_at: null,
  };
  it("counts the issues and names the recommendation from the row; without a saved checklist, the short form", () => {
    expect(inspectionDoneTitle(6012, "Acme", savedJson(), false)).toBe(
      "Inspection #6012 Acme is done — 1 issue found — ready for your review",
    );
    expect(
      inspectionDoneTitle(
        6012,
        "Acme",
        savedJson({
          items: [...savedJson().items, { id: "c4", label: "Ponding", status: "issue", note: "" }],
          recommend_repairs: true,
        }),
        false,
      ),
    ).toBe(
      "Inspection #6012 Acme is done — 2 issues found, recommends repairs — ready for your review",
    );
    expect(inspectionDoneTitle(6012, "Acme", savedJson({ recommend_repairs: true }), true)).toBe(
      "Inspection #6012 Acme is done — 1 issue found, recommends repairs and a new roof — ready for your review",
    );
    expect(inspectionDoneTitle(6012, "Acme", savedJson(), true)).toBe(
      "Inspection #6012 Acme is done — 1 issue found, recommends a new roof — ready for your review",
    );
    expect(inspectionDoneTitle(6012, "Acme", null, false)).toBe(
      "Inspection #6012 Acme is done — ready for your review",
    );
    expect(recommendationText({ recommend_repairs: false, recommend_new_roof: false })).toBeNull();
    // doneTitle picks by service_type; a ticket keeps its wording.
    expect(doneTitle({ ...base, service_type: "inspection", inspection: savedJson() })).toBe(
      "Inspection #6012 Acme is done — 1 issue found — ready for your review",
    );
    expect(doneTitle({ ...base, service_type: "inspection", inspection: "garbage" })).toBe(
      "Inspection #6012 Acme is done — ready for your review",
    );
    expect(doneTitle({ ...base, service_type: "leak" })).toBe(
      "Ticket #6012 Acme — Annual inspection is done — ready for your review",
    );
    expect(doneTitle(base)).toBe(
      "Ticket #6012 Acme — Annual inspection is done — ready for your review",
    );
  });
  it("afterTicketStage sends it once, as ticket_done, to the authorizers; the Authorize follow-up still says Ticket", async () => {
    const tables: Record<string, Row[]> = {
      profiles,
      crm_followups: [],
      crm_settings: [
        {
          id: 1,
          opportunity_close_days: 30,
          opportunity_first_days: 3,
          opportunity_every_days: 7,
          ticket_first_days: 1,
          ticket_every_days: 3,
        },
      ],
    };
    const sb = fakeSupabase(tables, { rpcs: { ticket_authorizers: () => [MANAGER] } }).db as Client;
    await afterTicketStage(
      {
        ...base,
        service_type: "inspection",
        inspection: savedJson({ recommend_repairs: true }),
        recommend_new_roof: false,
      },
      "scheduled",
      { id: TECH, name: "Ted Tech" },
      sb,
    );
    expect(notify).toHaveBeenCalledTimes(1);
    const [ids, msg] = notify.mock.calls[0]!;
    expect(ids).toEqual([MANAGER]);
    expect(msg.kind).toBe("ticket_done");
    expect(msg.title).toBe(
      "Inspection #6012 Acme is done — 1 issue found, recommends repairs — ready for your review",
    );
    // The Authorize follow-up (syncFollowup is stubbed here) keeps the ticket title and the
    // single-notice rule (quiet on the step the ticket became Done).
    expect(vi.mocked(syncFollowup)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(syncFollowup).mock.calls[0]![0]).toMatchObject({
      kind: "invoice",
      itemId: "job-1",
      assigneeId: MANAGER,
      title: "Authorize Ticket #6012 Acme — Annual inspection",
      quiet: true,
    });
  });
});

// ── 6. The screens ────────────────────────────────────────────────────────────────────────

describe("6a. the close-out renders the inspection flow with the same mechanics", () => {
  it("the form branches on the type: the checklist and findings cards in place of Before / The work; no repair picker on an inspection", () => {
    expect(form).toContain("const inspection = isInspection(job.service_type);");
    expect(form).toContain("const insp = useInspectionDraft(job, { enabled: inspection });");
    expect(form).toContain("const inspCamera = useInspectionCamera(job.id);");
    expect(inspectionBranch).toContain('{...card("checklist")}');
    expect(inspectionBranch).toContain('{...card("findings")}');
    expect(inspectionBranch).toContain("<InspectionChecklistStep");
    expect(inspectionBranch).toContain("<InspectionFindingsStep");
    expect(inspectionBranch).not.toContain("<RepairsSection");
    expect(inspectionBranch).not.toContain("<TicketExtras");
    expect(inspectionBranch).not.toContain('card("before")');
    expect(inspectionBranch).not.toContain('card("work")');
    // The Aerial fold once, plain, inside the checklist card (no box in a box).
    expect(cards).toContain("<AerialSection job={job} canEdit plain />");
    expect(cards).not.toContain("TicketExtras");
    expect(read("src/components/service/aerial-markup.tsx")).toContain("plain={plain}");
    // The strip and the cards take the type: "Step n of 6".
    expect(form).toContain(
      "<StepStrip statuses={statuses} open={shownOpen} serviceType={job.service_type} />",
    );
    expect(form).toContain("serviceType: job.service_type,");
    expect(closeout).toContain("{stepHeadline(open, serviceType)}");
    expect(closeout).toContain("const nextLabel = nextStepLabel(id, serviceType);");
    expect(closeout).toContain("{lockedLine(open, serviceType)}");
    expect(closeout).toContain(
      "aria-label={`Step ${step.n} of ${statuses.length}: ${step.title}${",
    );
    expect(closeout).not.toContain("STEP_COUNT");
  });
  it("the step state carries the checklist, its saved flag and the two switches; the reads wait for the checklist", () => {
    expect(form).toContain("checklist: insp.items,");
    expect(form).toContain("checklistSaved: insp.saved,");
    expect(form).toContain("recommendRepairs: insp.recommendRepairs,");
    expect(form).toContain("recommendNewRoof: draft.recommend_new_roof,");
    expect(form).toContain("&& !insp.loading;");
    // Complete flushes the checklist first and clears its phone draft after.
    expect(form).toMatch(/if \(inspection\) await insp\.saveNow\(\);\s*const row = await saveFn/);
    expect(form).toContain("clearInspectionDraft(job.id);");
    // The gap dialog judges the checklist on an inspection.
    expect(form).toMatch(
      /checklist: \{ data: insp\.data \? insp\.items : undefined, error: insp\.error \},\s*checklist_saved: insp\.saved,/,
    );
  });
  it("one notes box: the Findings card holds closing_notes; step 6's card is not rendered on an inspection", () => {
    expect(inspectionBranch).toContain("notes={draft.closing_notes}");
    expect(inspectionBranch).toContain("onNotes={(v) => update({ closing_notes: v })}");
    expect(form).toMatch(/\{!inspection && \(\s*<StepCard \{\.\.\.card\("notes"\)\}/);
    expect(cards).toContain('<Label htmlFor="co-findings">Findings</Label>');
    expect(cards.match(/<Textarea/g)).toHaveLength(1);
  });
  it("two switches on the Findings card: Recommend repairs (the inspection JSON) and Recommend a new roof (the ticket column)", () => {
    expect(cards).toContain('<span className="font-medium">Recommend repairs</span>');
    expect(cards).toContain('<span className="font-medium">Recommend a new roof</span>');
    expect(cards.match(/<Switch/g)).toHaveLength(2);
    expect(inspectionBranch).toContain("recommendRepairs={insp.recommendRepairs}");
    expect(inspectionBranch).toContain("onRecommendRepairs={insp.setRecommendRepairs}");
    expect(inspectionBranch).toContain(
      "onRecommendNewRoof={(v) => update({ recommend_new_roof: v })}",
    );
    // "Nothing to add" is the same mark as step 6's Skip.
    expect(inspectionBranch).toContain("skipped={notesSkipped}");
    expect(inspectionBranch).toContain("onSkip={markNotesSkipped}");
    expect(cards.match(/Nothing to add/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it("the signature card says Optional for an inspection; Nothing used is pre-set on the materials card", () => {
    expect(form).toContain('data-line="signature-optional"');
    expect(form).toContain("Optional for an inspection");
    expect(form).toMatch(/inspection \? \(\s*<span>Optional<\/span>/);
    expect(form).toContain("(nothingUsed || inspection ? (");
    expect(form).toContain("pre-set for an inspection");
    expect(form).toMatch(/\{!inspection && \(\s*<Button[\s\S]*?Undo/);
    // The bar still completes from the signature step; the headline comes from the flow.
    expect(form).toContain(
      'const stepToFinish = open === null || open === "signature" ? null : open;',
    );
    expect(form).toContain("finishStepLabel(stepToFinish, job.service_type)");
  });
  it("no 'the office fixes it' for technicians anywhere new", () => {
    for (const s of [cards, camera, draftHook, steps, check])
      expect(s.toLowerCase()).not.toContain("the office fixes");
  });
});

describe("6b. the checklist saves as you go, on both screens; the manual button is gone", () => {
  it("inspection-draft.ts: useAutosave on the inspection JSON through saveTicketInspection, a per-ticket localStorage draft, Save now on a dropped signal", () => {
    expect(draftHook).toContain("const autosave = useAutosave<InspectionDraft>(");
    expect(draftHook).toContain("const ins = await saveFn({");
    expect(draftHook).toContain('{ what: "The checklist" },');
    expect(draftHook).toContain(
      "const draftKey = (id: string) => `bid-o-matic:closeout-inspection:${id}`;",
    );
    expect(draftHook).toContain("export function clearInspectionDraft(id: string) {");
    expect(draftHook).toContain(
      'toast.info("Restored the checklist answers you gave here before; saving them now.");',
    );
    expect(draftHook).toContain(
      "saved: draft !== null && snapshot !== null && sameDraft(draft, snapshot),",
    );
    expect(draftHook).toContain("saveNow: autosave.flush,");
    // The ticket row's cache carries the saved JSON (the header, the office's actions, the notice).
    expect(draftHook).toContain("qc.setQueryData<ServiceJobRow>(fieldKeys.job(job.id), (old) =>");
  });
  it("the ticket page and the close-out both use the hook; neither has Save inspection or the Inspection notes box", () => {
    expect(section).toContain("useInspectionDraft(job, { enabled: true, readOnly: !canEdit })");
    expect(section).not.toContain("Save inspection");
    expect(section).not.toContain("useMutation({\n    mutationFn: () =>\n      saveFn(");
    expect(section).not.toContain("<Label htmlFor={`inspection-notes-${job.id}`}>");
    expect(section).toContain("<ChecklistSavedLine draft={draft} canEdit={canEdit} />");
    expect(section).toContain("Save now");
    expect(cards).toContain("<ChecklistSavedLine draft={draft} canEdit />");
    expect(closeout).not.toContain("Save inspection");
    // The hidden seed row: both screens render the visible list the hook holds.
    expect(draftHook).toContain(
      "items: visibleChecklist(mergeChecklist(data.inspection, data.checklist)),",
    );
    expect(section).toContain("inspectionSummary(visibleChecklist(saved.items))");
  });
});

describe("6c. photos: per checklist item and the findings roll, role 'other', no repair", () => {
  it("one camera for the flow, aimed at an item (item_key) or the roll (null); the server takes item_key", () => {
    expect(camera).toContain(
      "export function useInspectionCamera(jobId: string): InspectionCamera {",
    );
    expect(camera).toMatch(/repair_id: null,\s*role: "other",\s*item_key: itemKey,/);
    expect(camera).toContain('"data-camera": "inspection",');
    expect(cards).toContain("camera={camera.controls(item.id)}");
    expect(cards).toContain("camera={camera.controls(null)}");
    expect(cards).toContain(
      'photos.filter((p) => p.role === "other" && !p.repair_id && (p.item_key ?? null) === itemKey);',
    );
    expect(cards.match(/<PhotoRoll/g)).toHaveLength(2);
    expect(cards).toContain('<span className="text-xs text-muted-foreground">Optional</span>');
    expect(fieldFn).toContain("item_key: z.string().min(1).max(60).nullable().optional(),");
    expect(fieldFn).toContain("item_key: data.item_key ?? null,");
    expect(types).toContain("item_key: string | null;");
    // The ticket page lists every non-signature photo; loose ones under "Other photos".
    const page = read("src/components/service/ticket-field-sections.tsx");
    expect(page).toContain(
      'const pics = (photos.data ?? []).filter((p) => p.role !== "signature");',
    );
    expect(page).toContain("Other photos");
    // The shared shrink lives where both cameras reach it.
    expect(read("src/components/service/field-utils.ts")).toContain(
      "export async function shrinkPhoto(file: File)",
    );
    expect(closeout).not.toContain("async function shrinkPhoto(");
  });
});

describe("6d. the office's After the inspection panel", () => {
  it("offers Leak / Warranty / Other, Create bid, and No action needed; shows the recorded outcome", () => {
    expect(section).toContain('<SelectItem value="warranty">Warranty</SelectItem>');
    expect(section).toContain("No action needed");
    expect(section).toContain('onClick={() => record.mutate("none")}');
    expect(section).toContain('onClick={() => record.mutate("bid")}');
    expect(section).toContain('data-line="inspection-outcome"');
    expect(section).toContain("outcomeLine({");
    expect(section).toMatch(/type RepairType = "leak" \| "warranty" \| "other";/);
    // The existing guards stay.
    expect(section).toContain("disabled={dirty || create.isPending || !date}");
    expect(section).toContain("if (inFlight.current || create.isPending) return;");
    // The findings note feeds the bid when the JSON has no notes of its own.
    expect(section).toContain('notes: ins.notes.trim() || (job.closing_notes ?? "")');
    expect(inspFn).toContain('notes: ins.notes.trim() || (job.closing_notes ?? ""),');
  });
});

// ── 7. The migration and the types ────────────────────────────────────────────────────────

describe("7. migration 20261012190000_inspection_flow.sql", () => {
  const flat = migration.replace(/\s+/g, " ");
  it("adds the outcome columns with a check and comments, item_key on photos, idempotently; touches nothing else", () => {
    expect(flat).toContain(
      "alter table public.service_jobs add column if not exists inspection_outcome text, add column if not exists inspection_outcome_at timestamptz, add column if not exists inspection_outcome_by uuid references public.profiles(id) on delete set null;",
    );
    expect(flat).toContain(
      "alter table public.service_jobs drop constraint if exists service_jobs_inspection_outcome_check;",
    );
    expect(flat).toContain(
      "check (inspection_outcome is null or inspection_outcome in ('repair_ticket', 'bid', 'none'))",
    );
    for (const c of ["inspection_outcome", "inspection_outcome_at", "inspection_outcome_by"])
      expect(flat).toContain(`comment on column public.service_jobs.${c} is`);
    expect(flat).toContain(
      "alter table public.service_job_photos add column if not exists item_key text;",
    );
    expect(flat).toContain("comment on column public.service_job_photos.item_key is");
    expect(flat).toContain(
      "create index if not exists service_job_photos_item_key_idx on public.service_job_photos (service_job_id, item_key) where item_key is not null;",
    );
    expect(migration).not.toMatch(/create table/);
    expect(migration).not.toMatch(/drop column/);
    expect(migration).not.toContain("inspection_checklist_items (label");
  });
  it("types.ts knows the new columns on service_jobs and service_job_photos", () => {
    expect(types.match(/inspection_outcome: string \| null;/g)).toHaveLength(1);
    expect(types.match(/inspection_outcome\?: string \| null;/g)).toHaveLength(2);
    expect(types.match(/inspection_outcome_at: string \| null;/g)).toHaveLength(1);
    expect(types.match(/inspection_outcome_by: string \| null;/g)).toHaveLength(1);
    expect(types.match(/item_key: string \| null;/g)).toHaveLength(1);
    expect(types.match(/item_key\?: string \| null;/g)).toHaveLength(2);
  });
});
