/**
 * The Findings step on a phone (owner, Oct 28: "the findings tab is a bit awkward as well on
 * mobile, is there a better more efficient layout?"). Nine stacked pieces became one screen:
 *
 *   1. The camera button sits at the right of the "Findings" heading; the notes box is under it,
 *      the thumbnails under that (PhotoRoll `heading` / children). No "Optional" word there.
 *   2. Recommend repairs / Recommend new roof are two press-to-select buttons side by side.
 *   3. Inspected (date, Today) and Grade (A–F) carry their label in the row, not above.
 *   4. "Nothing to add" is a small link under Next, beside the missing line, only while the step
 *      is blank — no note, neither recommendation, no picture (findingsBlank) — then the mark
 *      with Undo.
 *   5. The Inspection report button is gone from the step: the header's Documents dialog has it
 *      (owner: "why is there an inspection report button even in that step?").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findingsBlank } from "@/lib/closeout-steps";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const step = read("src/components/service/inspection-closeout.tsx");
const form = read("src/components/service/closeout.tsx");
const section = read("src/components/service/inspection-section.tsx");

describe("findingsBlank: when the 'Nothing to add' link shows", () => {
  const blank = { closingNotes: "", recommendRepairs: false, recommendNewRoof: false };
  it("nothing typed, nothing recommended, no picture", () => {
    expect(findingsBlank(blank, 0)).toBe(true);
    expect(findingsBlank({ ...blank, closingNotes: "   \n" }, 0)).toBe(true);
  });
  it("any one of a note, a recommendation or a picture hides it", () => {
    expect(findingsBlank({ ...blank, closingNotes: "Seam open at the drain" }, 0)).toBe(false);
    expect(findingsBlank({ ...blank, recommendRepairs: true }, 0)).toBe(false);
    expect(findingsBlank({ ...blank, recommendNewRoof: true }, 0)).toBe(false);
    expect(findingsBlank(blank, 1)).toBe(false);
  });
  it("an unknown recommendation (undefined before the checklist loads) still counts as not given", () => {
    expect(findingsBlank({ ...blank, recommendRepairs: undefined }, 0)).toBe(true);
  });
});

describe("the Findings step's markup", () => {
  const findings = step.slice(
    step.indexOf("export function InspectionFindingsStep("),
    step.indexOf("function RecommendButton("),
  );
  it("the camera beside the heading, the notes box inside the roll, no Optional there", () => {
    expect(findings).toContain('heading={<Label htmlFor="co-findings">Findings</Label>}');
    expect(findings).toMatch(/<PhotoRoll[\s\S]*?>\s*<Textarea[\s\S]*?<\/PhotoRoll>/);
    const roll = step.slice(
      step.indexOf("function PhotoRoll("),
      step.indexOf("// Step 2 · Checklist"),
    );
    expect(roll).toContain('data-line="roll-heading"');
    expect(roll).toMatch(/\{!heading && \(\s*<div className="flex flex-wrap items-center gap-2">/);
    expect(roll).toContain("{children}");
  });
  it("the two recommendations side by side, pressed state spoken", () => {
    expect(findings).toContain(
      '<div className="grid grid-cols-2 gap-2" data-section="recommendations">',
    );
    expect(findings).not.toContain("<Switch");
    expect(step).toMatch(/function RecommendButton\([\s\S]*?aria-pressed=\{on\}/);
    expect(step).toMatch(/onClick=\{\(\) => onChange\(!on\)\}/);
  });
  it("Inspected and Grade carry their labels in the row", () => {
    const details = section.slice(
      section.indexOf("export function InspectionDetails("),
      section.indexOf("function GradeButton("),
    );
    expect(details).toMatch(
      /<Label htmlFor=\{dateId\} className="w-\[4.25rem\] shrink-0 sm:w-auto">\s*Inspected\s*<\/Label>/,
    );
    expect(details).toContain('aria-label="Property inspected"');
    expect(details).toMatch(/aria-label="Property grade"[\s\S]*?>\s*Grade\s*<\/span>/);
    // Blank until chosen (owner: number boxes and dates never pre-filled).
    expect(details).toContain("value={draft.inspectedOn}");
    expect(details).not.toContain("defaultValue");
  });
  it("Nothing to add is the step footer's small link, only while blank; Undo once pressed", () => {
    const nta = step.slice(step.indexOf("export function NothingToAdd("));
    expect(nta).toContain("if (!blank) return null;");
    expect(nta).toMatch(/onClick=\{\(\) => onSkip\(true\)\}\s*>\s*Nothing to add/);
    expect(nta).toMatch(/onClick=\{\(\) => onSkip\(false\)\}>\s*Undo/);
    expect(form).toMatch(
      /footer=\{\s*<NothingToAdd\s+skipped=\{notesSkipped\}\s+onSkip=\{markNotesSkipped\}\s+blank=\{findingsBlank\(stepState, unattachedTicketPhotos\(photoRows\)\.length\)\}/,
    );
    // The StepCard renders it beside the missing line, under Next.
    expect(form).toMatch(
      /\{\(missing !== null \|\| footer\) && \(\s*<div[^>]*data-line="step-footer"[\s\S]*?\{footer\}/,
    );
    // No longer a full-width button inside the step.
    expect(findings).not.toContain("Nothing to add");
  });
  it("the Inspection report button is not on the step (the header's Documents dialog has it)", () => {
    expect(form).not.toContain("InspectionReportButton");
    expect(read("src/components/service/ticket-header-actions.tsx")).toContain(
      "<InspectionReportButton",
    );
  });
});
