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
  flaggedItems,
  unansweredCount,
  unansweredItems,
  visibleChecklist,
  type ChecklistItem,
  type Inspection,
} from "@/lib/inspection";
import { CHECKLIST_NOT_SAVED } from "@/lib/closeout-check";
import {
  registerJobPhoto,
  setFieldStatus,
  setJobPhotoItem,
  setJobPhotoItems,
} from "@/lib/service-field.functions";
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

describe("2a. the checklist step: saved on the server (Oct 26: only a problem needs a status)", () => {
  it("done once saved, whatever the rows say; unsaved, the Next line asks for the save", () => {
    expect(stepDone("checklist", whole)).toBe(true);
    expect(stepMissing("checklist", whole)).toBeNull();
    // Rows with no status read as OK: nothing is "left" to answer.
    const two = { ...whole, checklist: [answered("ok"), answered(null), answered(null)] };
    expect(stepDone("checklist", two)).toBe(true);
    expect(stepMissing("checklist", two)).toBeNull();
    const none = { ...whole, checklist: [answered(null), answered(null)] };
    expect(stepDone("checklist", none)).toBe(true);
    const unsaved = { ...whole, checklistSaved: false };
    expect(stepDone("checklist", unsaved)).toBe(false);
    expect(stepMissing("checklist", unsaved)).toBe(
      "Save the checklist (flag only what has a problem)",
    );
    expect(stepMissing("checklist", unsaved)).not.toMatch(/unanswered|Answer every/);
    // Nothing flagged and not saved yet: the checklist is current, the rest locked.
    const fresh = {
      ...whole,
      checklist: [answered(null), answered(null)],
      checklistSaved: false,
      closingNotes: "",
      timeHours: 0,
    };
    expect(firstOpenStep(fresh)).toBe("checklist");
    expect(statusList(fresh)).toEqual(["done", "current", "locked", "done", "locked", "done"]);
    // Saved with nothing flagged: on to the findings.
    expect(firstOpenStep({ ...fresh, checklistSaved: true })).toBe("findings");
  });
  it("the summary is the inspection's counts, a row with no status counted OK", () => {
    expect(stepSummary("checklist", whole)).toBe("1 issue · 2 OK · 1 N/A");
    expect(
      stepSummary("checklist", { ...whole, checklist: [answered(null), answered("ok")] }),
    ).toBe("No issues · 2 OK");
    expect(stepSummary("checklist", { ...whole, checklist: [] })).toBe("nothing to check");
    expect(INSPECTION_STEPS.find((s) => s.id === "findings")!.unlocks).toBe("The checklist saved");
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
  it("rows with no status are never a gap (Oct 26); saved with time: none — no photo, no signature asked", () => {
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
    // Only a problem needs a status: a row left alone reads as OK.
    expect(
      completeGaps({
        ...base,
        checklist: { data: [ok("Seams"), open("Drains"), open("Ponding")], error: null },
      }),
    ).toEqual({ gaps: [], unread: false });
    expect(
      completeGaps({ ...base, checklist: { data: [open("Drains")], error: null } }).gaps,
    ).toEqual([]);
    expect(
      completeGaps({
        ...base,
        checklist: { data: [ok("Seams"), open("Recommend repairs")], error: null },
      }).gaps,
    ).toEqual([]);
    // A flagged row with no note is not a gap either; the note is the tech's to write.
    expect(
      completeGaps({
        ...base,
        checklist: { data: [{ label: "Seams", status: "issue" as const }], error: null },
      }).gaps,
    ).toEqual([]);
    expect(check).not.toContain("unanswered");
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
  it("closeoutGaps (the server): the saved JSON merged with the live checklist; never saved is the one gap", () => {
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
    // No inspection JSON at all with rows to save: the checklist is not saved.
    expect(closeoutGaps({ ...rows, inspection: null })).toEqual([CHECKLIST_NOT_SAVED]);
    expect(CHECKLIST_NOT_SAVED).toBe("The checklist is not saved yet");
    // No JSON and no visible row either (the hidden seed row only): nothing to save, no gap.
    expect(closeoutGaps({ ...rows, inspection: null, checklist: [checklist[2]!] })).toEqual([]);
    // An item added since the save reads as OK (Oct 26), not as unanswered.
    expect(
      closeoutGaps({
        ...rows,
        checklist: [...checklist, { id: "c4", label: "Ponding", sort: 40 }],
      }),
    ).toEqual([]);
    // Saved with every status null — nothing flagged — passes.
    expect(
      closeoutGaps({
        ...rows,
        inspection: {
          ...saved,
          items: saved.items.map((i) => ({ ...i, status: null, note: "" })),
        },
      }),
    ).toEqual([]);
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
  it("the pure helpers: hidden row, the flagged rows; nothing is ever unanswered", () => {
    expect(RECOMMEND_REPAIRS_LABEL).toBe("Recommend repairs");
    expect(hiddenChecklistItem(" recommend REPAIRS ")).toBe(true);
    expect(hiddenChecklistItem("Seams")).toBe(false);
    expect(visibleChecklist([ok("Seams"), open("Recommend repairs")])).toEqual([ok("Seams")]);
    const issue = (label: string) => ({ label, status: "issue" as const });
    expect(
      flaggedItems([ok("Seams"), open("Drains"), issue("Ponding"), issue("Recommend repairs")]),
    ).toEqual([issue("Ponding")]);
    // The Oct 12 helpers still compile for their callers, answering "nothing".
    expect(unansweredItems([ok("Seams"), open("Drains"), open("Recommend repairs")])).toEqual([]);
    const checklist: ChecklistItem[] = DEFAULT_CHECKLIST.map((label, i) => ({
      id: `c${i}`,
      label,
      sort: i,
    }));
    expect(unansweredCount(null, checklist)).toBe(0);
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
  it("refuses a technician while the checklist was never saved; a partial save (rows left alone read as OK) goes through", async () => {
    // Never saved at all, with rows to save: the one checklist gap.
    const none = envWith(job());
    await expect(call(setFieldStatus, { id: JOB, to: "done" }, none, TECH)).rejects.toThrow(
      "The close-out is not complete: The checklist is not saved yet. Add what is missing, then press Complete again.",
    );
    expect(none.service_jobs[0]).toMatchObject({ stage: "scheduled", completed_at: null });
    // Saved with one of the two visible items: the other reads as OK (Oct 26), not unanswered.
    const tables = envWith(job({ inspection: savedJson({ items: [savedJson().items[0]!] }) }));
    const { row } = await call<{ row: Row }>(setFieldStatus, { id: JOB, to: "done" }, tables, TECH);
    expect(row["stage"]).toBe("done");
    // Saved with nothing flagged at all: a clean roof is a complete inspection.
    const clean = envWith(
      job({
        inspection: savedJson({
          items: savedJson().items.map((i) => ({ ...i, status: null, note: "" })),
        }),
      }),
    );
    expect(
      (await call<{ row: Row }>(setFieldStatus, { id: JOB, to: "done" }, clean, TECH)).row["stage"],
    ).toBe("done");
  });
  it("lets a technician through with every item answered and time logged — no photo, no signature", async () => {
    const tables = envWith(job({ inspection: savedJson() }));
    const { row } = await call<{ row: Row }>(setFieldStatus, { id: JOB, to: "done" }, tables, TECH);
    expect(row["stage"]).toBe("done");
    expect(tables.service_job_photos).toEqual([]);
  });
  it("no time is still a gap; a manager completes anyway", async () => {
    const tables = { ...envWith(job({ inspection: savedJson() })), service_time_entries: [] };
    await expect(call(setFieldStatus, { id: JOB, to: "done" }, tables, TECH)).rejects.toThrow(
      "The close-out is not complete: No time logged.",
    );
    const asManager = envWith(job());
    const { row } = await call<{ row: Row }>(
      setFieldStatus,
      { id: JOB, to: "done" },
      asManager,
      MANAGER,
    );
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
    // Oct 26: saved also means the server holds a record; Save now sends an untouched draft.
    expect(draftHook).toContain(
      "saved: hasRecord && draft !== null && snapshot !== null && sameDraft(draft, snapshot),",
    );
    expect(draftHook).toContain(
      "if (!hasRecord && !opts.readOnly && latest.current) autosave.push(latest.current);",
    );
    expect(draftHook).toContain("await autosave.flush();");
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
    // Oct 28: the camera feeds the portal's one picture queue with the item in the target
    // (lib/photo-upload-queue.ts pictureRegistration puts it in item_key, role "other", no repair).
    expect(camera).toMatch(
      /pictures\.add\(\s*files,\s*\{ jobId, repairId: null, itemKey, role: "other" \}/,
    );
    expect(camera).toContain('"data-camera": "inspection",');
    expect(cards).toContain("camera={camera.controls(item.id, item.label)}");
    expect(cards).toContain('camera={camera.controls(null, "Findings")}');
    // Oct 28: an item's roll is every picture whose item_keys include it; the findings roll the
    // pictures on no item (inspection.ts).
    expect(cards).toContain(
      "itemKey === null ? unattachedTicketPhotos(photos) : photosOnItem(photos, itemKey);",
    );
    expect(cards.match(/<PhotoRoll/g)).toHaveLength(2);
    expect(cards).toContain('<span className="text-xs text-muted-foreground">Optional</span>');
    expect(fieldFn).toContain("item_key: z.string().min(1).max(60).nullable().optional(),");
    // Oct 28: the row's item_key is the first of the registration's items (item_key, then item_keys).
    expect(fieldFn).toContain("item_key: itemKeys[0] ?? null,");
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

// ── 6e. Oct 26: only problems need a status; pictures from the ticket on each item ─────────

const PHOTO = "55555555-5555-4555-8555-555555555555";
const PHOTO2 = "66666666-6666-4666-8666-666666666666";
const REPAIR_PHOTO = "77777777-7777-4777-8777-777777777777";
const OTHER_JOB = "88888888-8888-4888-8888-888888888888";
const photoRow = (over: Row = {}): Row => ({
  id: PHOTO,
  service_job_id: JOB,
  repair_id: null,
  role: "other",
  item_key: null,
  storage_path: `${JOB}/1.jpg`,
  annotations: null,
  file_name: "1.jpg",
  ...over,
});

describe("6e. setJobPhotoItem: a loose ticket photo onto a checklist item, and off it", () => {
  const photos = () => [
    photoRow(),
    photoRow({ id: PHOTO2, item_key: "c2", storage_path: `${JOB}/2.jpg` }),
    photoRow({ id: REPAIR_PHOTO, repair_id: "r1", role: "before", storage_path: `${JOB}/3.jpg` }),
  ];
  it("the assigned technician attaches (item_key set) and detaches (null); the row comes back", async () => {
    const tables = {
      ...envWith(job()),
      service_job_photos: photos(),
      service_job_photo_items: [] as Row[],
    };
    const row = await call<Row>(
      setJobPhotoItem,
      { id: PHOTO, service_job_id: JOB, item_key: "c1" },
      tables,
      TECH,
    );
    expect(row).toMatchObject({ id: PHOTO, item_key: "c1", role: "other" });
    expect(tables.service_job_photos[0]!["item_key"]).toBe("c1");
    const off = await call<Row>(
      setJobPhotoItem,
      { id: PHOTO2, service_job_id: JOB, item_key: null },
      tables,
      OFFICE,
    );
    expect(off["item_key"]).toBeNull();
    // The photo stays on the ticket: nothing deleted, the path untouched.
    expect(tables.service_job_photos).toHaveLength(3);
    expect(tables.service_job_photos[1]!["storage_path"]).toBe(`${JOB}/2.jpg`);
    // The one-item call writes the link too (the wrapper over setJobPhotoItems).
    expect(tables.service_job_photo_items).toEqual([
      expect.objectContaining({ photo_id: PHOTO, item_key: "c1" }),
    ]);
  });
  it("Oct 28: setJobPhotoItems puts a photo on several items; item_key stays the primary while linked, else the first; [] takes it off every item; the links table holds the rest", async () => {
    // One fake across the calls (`call` copies the table record per call, and the fake's delete
    // swaps a table's array, so a deleted link would stay visible to the next call otherwise).
    const fake = fakeSupabase({
      profiles,
      ...envWith(job()),
      service_job_photos: photos(),
      service_job_photo_items: [] as Row[],
    });
    const run = <T>(data: Row, userId: string) =>
      (setJobPhotoItems as unknown as Fn)({
        data,
        context: { supabase: fake.db, userId },
      }) as Promise<T>;
    const links = () =>
      (fake.tables["service_job_photo_items"] ?? [])
        .filter((l) => l["photo_id"] === PHOTO)
        .map((l) => l["item_key"]);
    const photoRowNow = () => fake.tables["service_job_photos"]!.find((p) => p["id"] === PHOTO)!;
    const on = await run<Row>(
      { id: PHOTO, service_job_id: JOB, item_keys: ["c1", "c2", "c1"] },
      TECH,
    );
    expect(on).toMatchObject({ id: PHOTO, item_key: "c1", item_keys: ["c1", "c2"] });
    expect(links().sort()).toEqual(["c1", "c2"]);
    expect(photoRowNow()["item_key"]).toBe("c1");
    // c1 goes, c3 comes: the primary moves to the first link still there (c2), not to c3.
    const moved = await run<Row>(
      { id: PHOTO, service_job_id: JOB, item_keys: ["c3", "c2"] },
      OFFICE,
    );
    expect(moved).toMatchObject({ item_key: "c2", item_keys: ["c2", "c3"] });
    expect(links().sort()).toEqual(["c2", "c3"]);
    expect(photoRowNow()["item_key"]).toBe("c2");
    // Adding an item keeps the primary.
    const more = await run<Row>(
      { id: PHOTO, service_job_id: JOB, item_keys: ["c2", "c3", "c4"] },
      OFFICE,
    );
    expect(more).toMatchObject({ item_key: "c2", item_keys: ["c2", "c3", "c4"] });
    expect(links().sort()).toEqual(["c2", "c3", "c4"]);
    // Off every item: no links, item_key null, the row still on the ticket.
    const off = await run<Row>({ id: PHOTO, service_job_id: JOB, item_keys: [] }, TECH);
    expect(off).toMatchObject({ item_key: null, item_keys: [] });
    expect(links()).toEqual([]);
    expect(photoRowNow()["item_key"]).toBeNull();
    expect(fake.tables["service_job_photos"]).toHaveLength(3);
    // Nothing of another photo's was touched.
    expect(fake.writes.every((w) => w.table !== "service_job_photos" || w.rows === 1)).toBe(true);
    // A repair's photo never goes on an item; the list is capped.
    await expect(
      run({ id: REPAIR_PHOTO, service_job_id: JOB, item_keys: ["c1"] }, TECH),
    ).rejects.toThrow("Only a loose ticket photo");
    await expect(
      Promise.resolve().then(() =>
        run(
          {
            id: PHOTO,
            service_job_id: JOB,
            item_keys: Array.from({ length: 41 }, (_, i) => `k${i}`),
          },
          TECH,
        ),
      ),
    ).rejects.toThrow();
    expect(fieldFn).toContain("item_keys: z.array(z.string().min(1).max(60)).max(ITEM_LINKS_MAX),");
    expect(fieldFn).toContain("export const ITEM_LINKS_MAX = 40;");
  });
  it("Oct 28: registerJobPhoto takes item_keys (the camera's item_key still works): the row's item_key is the first, every link is written, the event names them all", async () => {
    const tables = {
      ...envWith(job()),
      service_job_photos: [] as Row[],
      service_job_photo_items: [] as Row[],
    };
    const row = await call<Row>(
      registerJobPhoto,
      {
        service_job_id: JOB,
        role: "other",
        storage_path: `${JOB}/new.jpg`,
        item_key: "c2",
        item_keys: ["c1", "c2"],
      },
      tables,
      TECH,
    );
    expect(row).toMatchObject({ item_key: "c2", item_keys: ["c2", "c1"] });
    expect(tables.service_job_photo_items.map((l) => l["item_key"]).sort()).toEqual(["c1", "c2"]);
    const event = tables.service_job_events.find((e) => e["kind"] === "photo");
    expect(event?.["meta"]).toMatchObject({ item_key: "c2", item_keys: ["c2", "c1"] });
    // Without any item: no link, as before.
    const loose = await call<Row>(
      registerJobPhoto,
      { service_job_id: JOB, role: "other", storage_path: `${JOB}/loose.jpg` },
      tables,
      TECH,
    );
    expect(loose).toMatchObject({ item_key: null, item_keys: [] });
    expect(tables.service_job_photo_items).toHaveLength(2);
    // A repair's photo with items is refused.
    await expect(
      call(
        registerJobPhoto,
        {
          service_job_id: JOB,
          role: "before",
          repair_id: "44444444-4444-4444-8444-444444444444",
          storage_path: `${JOB}/r.jpg`,
          item_keys: ["c1"],
        },
        tables,
        TECH,
      ),
    ).rejects.toThrow("Only a loose ticket photo");
    expect(fieldFn).toContain(
      "item_keys: z.array(z.string().min(1).max(60)).max(ITEM_LINKS_MAX).optional(),",
    );
    expect(fieldFn).toContain("item_key: itemKeys[0] ?? null,");
    // The list the screens read carries every link.
    expect(fieldFn).toContain("Promise<JobPhotoWithItems[]>");
    expect(fieldFn).toContain('.from("service_job_photo_items")');
    expect(types).toContain("service_job_photo_items: {");
  });
  it("another technician is refused (ownJob); a repair's photo never moves onto an item; a photo off this ticket is not found; item_key is capped at 60", async () => {
    const tables = {
      ...envWith(job()),
      service_job_photos: photos(),
      service_job_photo_items: [] as Row[],
    };
    const other = { ...tables, profiles: [...profiles, { ...profiles[0]!, id: OTHER_JOB }] };
    await expect(
      call(setJobPhotoItem, { id: PHOTO, service_job_id: JOB, item_key: "c1" }, other, OTHER_JOB),
    ).rejects.toThrow("This ticket is assigned to someone else");
    await expect(
      call(
        setJobPhotoItem,
        { id: REPAIR_PHOTO, service_job_id: JOB, item_key: "c1" },
        tables,
        TECH,
      ),
    ).rejects.toThrow("Only a loose ticket photo");
    await expect(
      call(
        setJobPhotoItem,
        { id: "99999999-9999-4999-8999-999999999999", service_job_id: JOB, item_key: "c1" },
        tables,
        TECH,
      ),
    ).rejects.toThrow("That photo is not on this ticket");
    await expect(
      Promise.resolve().then(() =>
        call(
          setJobPhotoItem,
          { id: PHOTO, service_job_id: JOB, item_key: "x".repeat(61) },
          tables,
          TECH,
        ),
      ),
    ).rejects.toThrow();
    expect(tables.service_job_photos[0]!["item_key"]).toBeNull();
    // The guard is ownJob, as on registerJobPhoto / savePhotoAnnotations — in the shared
    // applyPhotoItems both setJobPhotoItems and the one-item wrapper run through (Oct 28).
    const fn = fieldFn.slice(fieldFn.indexOf("async function applyPhotoItems("));
    expect(fn.slice(0, fn.indexOf("const closeoutSchema"))).toContain(
      "const job = await ownJob(context, data.service_job_id);",
    );
    expect(fieldFn).toContain("item_key: z.string().min(1).max(60).nullable(),");
    expect(fieldFn).toContain("item_keys: data.item_key === null ? [] : [data.item_key],");
  });
});

describe("6f. the screens: compact rows, pictures from the ticket, Property inspected / grade", () => {
  const itemPhotos = read("src/components/service/inspection-item-photos.tsx");
  const mutations = read("src/components/service/item-photo-mutations.ts");
  it("each row is one line — the label and the flag toggle Issue; OK is a subtle tick; N/A a small toggle; only a flagged row opens", () => {
    expect(section).toContain("aria-label={`${item.label}: flag an issue`}");
    expect(section).toContain("aria-label={`${item.label}: issue`}");
    expect(section).toContain("aria-label={`${item.label}: OK`}");
    expect(section).toContain("aria-label={`${item.label}: not applicable`}");
    expect(section).toMatch(/aria-pressed=\{flagged\}/);
    expect(section).toContain(
      "onChange(item.id, { status: item.status === status ? null : status })",
    );
    // The note and the pictures (`extra`) only under a flagged row.
    expect(section).toMatch(/\{flagged \? \(\s*<div[^>]*>\s*<Input/);
    expect(section).toMatch(/\{extra\?\.\(item\)\}\s*<\/div>\s*\) : \(/);
    expect(section).not.toContain("StatusButton");
    expect(section).not.toContain("INSPECTION_STATUSES.map");
    // The hint under the rows says the rule, not "unanswered"; no "the app".
    for (const s of [section, cards, itemPhotos, mutations, steps, check, draftHook]) {
      // ("not checked" as the old summary's words — `3 not checked` — not as a plain phrase.)
      expect(s.toLowerCase()).not.toMatch(/unanswered|\} not checked|the app\b|the office fixes/);
    }
    expect(section).toContain("Flag only what has a problem — every other row reads as OK.");
    expect(closeout).toContain("issueCountText(insp.items.filter(isFlagged).length)");
    expect(closeout).not.toContain("answered\n");
  });
  it("pictures from the ticket: the picker lists the loose photos, Attach sets item_key, Detach clears it, on both screens", () => {
    expect(itemPhotos).toContain("export function TicketPhotoPicker({");
    // Oct 28: the picker offers every picture not on THIS item (one photo on several items);
    // Detach removes this item's link only.
    expect(itemPhotos).toContain("const pickable = attachableTicketPhotos(photos, itemKey);");
    expect(itemPhotos).toContain("From ticket photos");
    expect(itemPhotos).toContain(
      "setItem.mutate({ ids: [p.id], item_key: itemKey, attach: false })",
    );
    expect(itemPhotos).toMatch(/setItem\.mutate\(\s*\{ ids, item_key: itemKey, attach: true \},/);
    expect(mutations).toContain(
      "void qc.invalidateQueries({ queryKey: fieldKeys.photos(jobId) });",
    );
    expect(mutations).toContain("const setFn = useServerFn(setJobPhotoItems);");
    expect(mutations).toContain(
      "const item_keys = toggleItemKey(photoItemKeys(photo), v.item_key, v.attach);",
    );
    // The tile is RotatedPhoto: the photo turned as the ticket keeps it, its marks over it.
    expect(itemPhotos).toMatch(
      /<RotatedPhoto\s+url=\{url\.data\}\s+alt=""\s+marks=\{marks\}\s+rotation=\{rotation\}\s+fit="cover"/,
    );
    // The close-out's item roll and the office fold both carry them.
    expect(cards).toContain("<FromTicketPhotosButton");
    expect(cards).toContain("<ItemPhotoThumbs");
    expect(section).toContain("<ItemPhotoTools");
    expect(section).toContain("queryKey: fieldKeys.photos(job.id),");
  });
  it("Property inspected (blank; Today is the phone's day) and Property grade (A–F, none pressed) on the Findings step and the office fold, saved through saveTicketInspection", () => {
    expect(section).toContain("export function InspectionDetails({");
    expect(section).toContain("<Label htmlFor={dateId}>Property inspected</Label>");
    expect(section).toContain("onClick={() => draft.setInspectedOn(localYmd())}");
    expect(section).not.toContain("toISOString().slice(0, 10)");
    expect(section).toContain("{INSPECTION_GRADES.map((g) => (");
    expect(section).toContain("aria-label={`Grade ${grade}`}");
    expect(section).toContain("onClick={() => draft.setGrade(draft.grade === g ? null : g)}");
    expect(cards).toContain('<InspectionDetails draft={draft} canEdit idPrefix="co" />');
    expect(section).toContain(
      "<InspectionDetails draft={draft} canEdit={canEdit} idPrefix={`insp-${job.id}`} />",
    );
    expect(inspectionBranch).toContain("draft={insp}");
    expect(draftHook).toContain(
      "const ins = await saveFn({ data: { id: job.id, inspection: trimmed(d) } });",
    );
    expect(draftHook).toContain("const trimmed = inspectionPayload;");
    // The saved line carries them.
    expect(section).toContain("const details = inspectedLine({");
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
