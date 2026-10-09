/**
 * Owner, Oct 9 (desktop screenshots of the close-out): "we have a box in a box here and it looks
 * a bit awkward and cramped … having all the steps listed above the forms takes up a lot of
 * space … the forms problem and work completed are a bit ambiguous … can we have each step
 * minimize after completion." The step is the card (no Section card inside a ringed slot), the
 * strip is one line of dots with a chevron for the full list, a done step folds to a summary
 * with Edit, the work card's boxes are "What was wrong" / "What you did to fix it", and the
 * redundant paragraph under step 1 is gone. Each pin fails on the seven-step screen as it landed
 * earlier that day; the summaries are unit-tested without the screen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CLOSEOUT_STEPS,
  SUMMARY_NOTES_CHARS,
  countMaterialItems,
  stepOf,
  stepSummary,
  type StepState,
} from "@/lib/closeout-steps";

const read = (p: string) => readFileSync(p, "utf8");
const src = read("src/components/service/closeout.tsx");
const form = src.slice(src.indexOf("function CloseoutForm("), src.indexOf("// (b) Repairs"));
const section = src.slice(src.indexOf("function Section("), src.indexOf("/** The element a step"));
const strip = src.slice(src.indexOf("function StepStrip("), src.indexOf("function StepCard("));
const card = src.slice(src.indexOf("function StepCard("), src.indexOf("function CloseoutForm("));
const work = src.slice(src.indexOf("{!before && ("), src.indexOf("{shown.length > 0 && ("));

/** A repair ticket with everything done. */
const full: StepState = {
  finished: false,
  crewAnswered: true,
  serviceType: "leak",
  repairs: [{ id: "r1", resolution_text: "Cleared the drain." }],
  photos: [
    { repair_id: "r1", role: "before" },
    { repair_id: "r1", role: "after" },
  ],
  materialsTouched: true,
  timeHours: 3.5,
  onSiteAt: null,
  closingNotes: "Drain was clogged; cleared it and resealed the strainer.",
  notesSkipped: false,
  signaturePath: "job/signature.png",
  crewOthers: 0,
  materialItems: 3,
  signedBy: "Pat Ortiz",
};

describe("stepSummary — the one line a folded step shows", () => {
  it("1 Alone / With N others", () => {
    expect(stepSummary("crew", full)).toBe("Alone");
    expect(stepSummary("crew", { ...full, crewOthers: 1 })).toBe("With 1 other");
    expect(stepSummary("crew", { ...full, crewOthers: 2 })).toBe("With 2 others");
  });
  it("2 N repairs, Before photos taken; none says so (an inspection by name)", () => {
    expect(stepSummary("before", full)).toBe("1 repair, Before photo taken");
    expect(
      stepSummary("before", {
        ...full,
        repairs: [...full.repairs, { id: "r2", resolution_text: null }],
      }),
    ).toBe("2 repairs, Before photos taken");
    expect(stepSummary("before", { ...full, repairs: [] })).toBe("No repairs");
    expect(stepSummary("before", { ...full, repairs: [], serviceType: "inspection" })).toBe(
      "Inspection — no repairs",
    );
  });
  it("3 N of N with what you did and an After photo (blank text or no After photo does not count)", () => {
    expect(stepSummary("work", full)).toBe("1 of 1 with what you did and an After photo");
    expect(
      stepSummary("work", {
        ...full,
        repairs: [...full.repairs, { id: "r2", resolution_text: "  " }],
        photos: [...full.photos, { repair_id: "r2", role: "after" }],
      }),
    ).toBe("1 of 2 with what you did and an After photo");
    expect(
      stepSummary("work", {
        ...full,
        repairs: [...full.repairs, { id: "r2", resolution_text: "Patched" }],
      }),
    ).toBe("1 of 2 with what you did and an After photo");
    expect(stepSummary("work", { ...full, repairs: [] })).toBe("No repairs");
  });
  it("4 N items logged / Nothing used", () => {
    expect(stepSummary("materials", full)).toBe("3 items logged");
    expect(stepSummary("materials", { ...full, materialItems: 1 })).toBe("1 item logged");
    expect(stepSummary("materials", { ...full, materialItems: 0 })).toBe("Nothing used");
    expect(stepSummary("materials", { ...full, materialItems: 0, materialsTouched: false })).toBe(
      "No materials",
    );
  });
  it("5 the hours as the Time section prints them", () => {
    expect(stepSummary("time", full)).toBe("3.5 h");
    expect(stepSummary("time", { ...full, timeHours: 0.25 })).toBe("0.25 h");
    expect(stepSummary("time", { ...full, timeHours: 8 })).toBe("8 h");
    expect(stepSummary("time", { ...full, timeHours: 0, onSiteAt: "2026-10-09T12:00:00Z" })).toBe(
      "Labor from the On site stamp",
    );
    expect(stepSummary("time", { ...full, timeHours: 0 })).toBe("No time");
  });
  it("6 the first ~80 characters of the closing notes, on one line", () => {
    expect(SUMMARY_NOTES_CHARS).toBe(80);
    expect(stepSummary("notes", full)).toBe(full.closingNotes);
    const long = "Found two holes over the gym near the north drain. ".repeat(4);
    const out = stepSummary("notes", { ...full, closingNotes: long });
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(SUMMARY_NOTES_CHARS + 1);
    expect(out.startsWith("Found two holes over the gym")).toBe(true);
    expect(stepSummary("notes", { ...full, closingNotes: "  line one\n\nline two  " })).toBe(
      "line one line two",
    );
    expect(stepSummary("notes", { ...full, closingNotes: "   " })).toBe("No notes");
    // Owner, Oct 9: "Skip — nothing to add" pressed with the notes blank.
    expect(stepSummary("notes", { ...full, closingNotes: "   ", notesSkipped: true })).toBe(
      "Skipped",
    );
    expect(stepSummary("notes", { ...full, notesSkipped: true })).toBe(full.closingNotes);
  });
  it("7 Signed by <name> / Signed / Not signed", () => {
    expect(stepSummary("signature", full)).toBe("Signed by Pat Ortiz");
    expect(stepSummary("signature", { ...full, signedBy: "  " })).toBe("Signed");
    expect(stepSummary("signature", { ...full, signaturePath: null })).toBe("Not signed");
  });
  it("every step has a summary", () => {
    for (const s of CLOSEOUT_STEPS) expect(stepSummary(s.id, full).length).toBeGreaterThan(0);
    expect(stepOf("materials").unlocks).toBe("What you did and an After photo on every repair");
  });
});

describe("countMaterialItems — distinct cells with a net count on the ticket", () => {
  const cell = (row_label: string, qty: number | string, price_col = "price") => ({
    screen_id: "duro_last:sealants",
    row_label,
    price_col,
    qty,
  });
  it("counts cells, not rows; a count taken back is nothing; numeric strings read", () => {
    expect(countMaterialItems([])).toBe(0);
    expect(countMaterialItems([cell("Caulk", -1), cell("Caulk", -2)])).toBe(1);
    expect(countMaterialItems([cell("Caulk", -1), cell("Caulk", 1)])).toBe(0);
    expect(countMaterialItems([cell("Caulk", "-0.25"), cell("Primer", -1)])).toBe(2);
    // Colour columns are different cells.
    expect(countMaterialItems([cell("Caulk", -1, "White"), cell("Caulk", -1, "Tan")])).toBe(2);
  });
});

describe("no box in a box: the step is the card", () => {
  it("Section renders plain (no border, icon or heading of its own); StepCard draws the card", () => {
    expect(section).toContain('<section className="space-y-3" aria-label={title}>');
    expect(section).not.toContain("rounded-xl");
    expect(section).not.toContain("<h2");
    expect(src).not.toContain("function StepSlot(");
    expect(src).not.toContain("ring-2 ring-primary ring-offset-4");
    expect(card).toContain("scroll-mt-3 rounded-xl border bg-card");
    // The header row: the number (a tick once done), the section's icon, the title, the aside.
    expect(card).toMatch(/status === "done" \? \(\s*<span[\s\S]*?<Check className="h-4 w-4"/);
    expect(card).toContain("{step.n}");
    expect(card).toContain(
      '<Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />',
    );
    expect(card).toContain('<span className="truncate">{step.title}</span>');
    expect(card).toContain("{aside}");
    // Current: a left accent bar and a primary border, not a ring-offset frame.
    expect(card).toMatch(/status === "current" \? "border-l-4 border-primary" : ""/);
    // Locked: still one muted line naming the step to finish.
    expect(card).toMatch(/if \(status === "locked"\)\s*return \(\s*<p/);
    expect(card).toContain("{lockedLine(open)}");
  });
  it("the sections pass only a title; the icons and asides sit on the step cards", () => {
    for (const t of ["Time", "Notes", "Signature"])
      expect(form).toContain(`<Section title="${t}">`);
    expect(src).not.toMatch(/<Section title="[^"]+" icon=/);
    expect(form).toContain('<StepCard {...card("crew")} icon={Users}>');
    expect(form).toContain('{...card("before")}');
    expect(form).toContain("icon={Wrench}");
    expect(form).toContain('{...card("work")}');
    expect(form).toContain("icon={Hammer}");
    expect(form).toContain('{...card("materials")}');
    expect(form).toContain("icon={Package}");
    expect(form).toContain("<span>{repairRows.length} added</span>");
    expect(form).toMatch(/\{workDone\} of \{repairRows\.length\} done/);
    expect(form).toMatch(/\{materialItems\} \{materialItems === 1 \? "item" : "items"\}/);
    // The repairs body no longer carries a heading or the aside.
    const repairs = src.slice(
      src.indexOf("function RepairsSection("),
      src.indexOf("const PICKER_CHIPS"),
    );
    expect(repairs).toContain('<Section title={before ? "Repairs" : "The work"}>');
    expect(repairs).not.toContain("aside=");
  });
  it("the crew question is embedded (no border of its own) and the paragraph under it is gone", () => {
    expect(form).toContain("<CrewBox job={job} embedded />");
    expect(form).not.toContain("Check-in details, photos, repairs and the rest open");
    expect(form).toContain("{waiting ? null : !ready ? (");
    const crew = read("src/components/service/crew-box.tsx");
    expect(crew).toContain("embedded?: boolean | undefined;");
    expect(crew).toMatch(/embedded\s*\?\s*`space-y-3 \$\{className \?\? ""\}`/);
    expect(crew).toMatch(
      /\{embedded \? \(\s*<p className="font-medium">Who is on this job with you\?<\/p>/,
    );
    // Today's crew box is unchanged.
    expect(read("src/components/service/today-page.tsx")).toContain(
      "{crewOpen && <CrewBox job={j} />}",
    );
  });
  it("step 4's Materials body and Purchase orders fold are plain inside the card too", () => {
    const materials = read("src/components/service/materials-section.tsx");
    expect(materials).toContain('<section className="space-y-3" aria-label="Materials">');
    expect(materials).not.toContain(
      '<section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Materials">',
    );
    expect(read("src/components/service/purchase-orders-section.tsx")).toContain("plain={field}");
    const box = read("src/components/service/field-shared.tsx");
    expect(box).toContain("plain?: boolean | undefined;");
    expect(box).toMatch(/plain \? "border-t" : `overflow-hidden rounded-lg border/);
  });
});

describe("the compact strip", () => {
  it("one line: the headline, seven dots (tick / number / lock), a chevron for the full list", () => {
    expect(strip).toContain(
      '<p className="min-w-0 flex-1 truncate text-sm font-semibold">{stepHeadline(open)}</p>',
    );
    expect(strip).toContain('aria-label="Jump to a step"');
    expect(strip).toContain('aria-disabled={status === "locked" || undefined}');
    expect(strip).toContain(
      'title={status === "locked" ? `Locked — ${step.unlocks}` : step.title}',
    );
    expect(strip).toContain('onClick={() => status !== "locked" && jumpTo(step.id)}');
    expect(strip).toMatch(
      /status === "done" \? \(\s*<Check className="h-4 w-4" aria-hidden \/>\s*\) : status === "locked" \? \(\s*<Lock className="h-3\.5 w-3\.5" aria-hidden \/>\s*\) : \(\s*step\.n\s*\)/,
    );
    expect(strip).toContain('? "bg-primary text-primary-foreground"');
    // The full list is the earlier markup, behind the chevron, closed by default, not remembered.
    expect(strip).toContain("const [listOpen, setListOpen] = useState(false);");
    expect(strip).toContain("aria-expanded={listOpen}");
    expect(strip).toMatch(/\{listOpen && \(\s*<ol className="mt-2 space-y-0\.5 border-t pt-2">/);
    expect(strip).toContain("{step.unlocks}");
    expect(strip).not.toContain("localStorage");
    // Not sticky; still first in the form.
    expect(strip).not.toContain("sticky");
    expect(form).toMatch(
      /<div className="space-y-5">\s*<StepStrip statuses=\{statuses\} open=\{shownOpen\} \/>/,
    );
  });
});

describe("done steps minimize", () => {
  it("a done step that is not current folds to its header, the summary and Edit; Edit unfolds it", () => {
    expect(card).toContain('const folded = status === "done" && !expanded;');
    expect(card).toMatch(
      /\{folded \? \(\s*<p className="px-4 pb-3 text-sm text-muted-foreground">\{summary\}<\/p>\s*\) : \(\s*<div className="space-y-3 px-4 pb-4">\{children\}<\/div>/,
    );
    expect(card).toMatch(/\{status === "done" && \(\s*<Button/);
    expect(card).toContain("aria-expanded={!folded}");
    expect(card).toContain("onClick={onToggle}");
    expect(card).toMatch(/<Pencil className="mr-1 h-4 w-4" \/> Edit/);
    expect(card).toMatch(/<ChevronUp className="mr-1 h-4 w-4" \/> Done/);
  });
  it("the form holds the per-step state, nothing remembered; it clears when the open step moves", () => {
    expect(form).toContain(
      "const [editing, setEditing] = useState<Partial<Record<StepId, boolean>>>({});",
    );
    // Owner, Oct 9 (later): the SHOWN open step — the one the tech is inside does not fold.
    expect(form).toContain("useEffect(() => setEditing({}), [shownOpen]);");
    expect(form).not.toContain("useEffect(() => setEditing({}), [open]);");
    expect(form).toContain("summary: stepSummary(id, stepState),");
    expect(form).toContain("expanded: editing[id] === true,");
    expect(form).toContain("onToggle: () => setEditing((e) => ({ ...e, [id]: !e[id] })),");
    expect(form).not.toMatch(/localStorage[^\n]*editing/);
    // The state the summaries need.
    expect(form).toContain("crewOthers: job.helper_count,");
    expect(form).toContain("materialItems: countMaterialItems(materialsQ.data ?? []),");
    expect(form).toContain("signedBy: draft.signed_by,");
  });
});

describe("plain labels on the work card", () => {
  it('"What was wrong" and "What you did to fix it", with examples; the columns stay', () => {
    expect(work).toMatch(
      /<Label className="text-sm" htmlFor=\{`\$\{repair\.id\}-problem`\}>\s*What was wrong\s*<\/Label>/,
    );
    expect(work).toContain('placeholder="e.g. Drain clogged with debris, water pooling"');
    expect(work).toMatch(
      /<Label className="text-sm" htmlFor=\{`\$\{repair\.id\}-resolution`\}>\s*What you did to fix it\s*<\/Label>/,
    );
    expect(work).toContain('placeholder="e.g. Cleared the drain and resealed the strainer"');
    expect(work).toContain("value={vals.problem_text}");
    expect(work).toContain("value={vals.resolution_text}");
    expect(work).not.toContain(">Problem<");
    expect(work).not.toContain(">Work completed<");
    // The template prefill is unchanged.
    expect(src).toContain("problem_text: t.description,");
    expect(src).toContain("resolution_text: t.work_completed,");
  });
  it("the amber needs hint and the unlock line use the same words", () => {
    const repairs = read("src/lib/closeout-repairs.ts");
    expect(repairs).toContain('needs.push("what you did");');
    expect(repairs).not.toContain('"work completed"');
    expect(read("src/lib/closeout-steps.ts")).toContain(
      'unlocks: "What you did and an After photo on every repair",',
    );
  });
});
