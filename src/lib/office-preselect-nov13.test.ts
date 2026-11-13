/**
 * Owner, Nov 13 — "go with the preselect office choices": on a Done inspection the office's
 * choice is preselected from what the technician recommended. Recommend repairs highlights
 * Create repair ticket; Recommend a new roof highlights Create bid; both highlight both; one line
 * above says who recommended what. Neither: as before. A highlight is only that — every choice
 * stays pressable.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { officePreselect } from "@/lib/inspection";

const section = readFileSync("src/components/service/inspection-section.tsx", "utf8");
const actions = section.slice(
  section.indexOf("function OfficeActions("),
  section.indexOf("function OpportunityAfterNoAction("),
);

describe("the rule (lib/inspection.ts officePreselect)", () => {
  it("repairs: Create repair ticket, and the line", () => {
    expect(
      officePreselect({ recommend_repairs: true, recommend_new_roof: false }, "Tyler Reed"),
    ).toEqual({ repair: true, bid: false, line: "Tyler Reed recommended repairs" });
  });
  it("a new roof: Create bid", () => {
    expect(
      officePreselect({ recommend_repairs: false, recommend_new_roof: true }, "Tyler Reed"),
    ).toEqual({ repair: false, bid: true, line: "Tyler Reed recommended a new roof" });
  });
  it("both: both", () => {
    expect(
      officePreselect({ recommend_repairs: true, recommend_new_roof: true }, "Tyler Reed"),
    ).toEqual({ repair: true, bid: true, line: "Tyler Reed recommended repairs and a new roof" });
  });
  it("neither: nothing highlighted, no line", () => {
    expect(
      officePreselect({ recommend_repairs: false, recommend_new_roof: false }, "Tyler Reed"),
    ).toEqual({ repair: false, bid: false, line: null });
  });
  it("no name: The technician", () => {
    for (const who of [null, undefined, "", "   "])
      expect(
        officePreselect({ recommend_repairs: true, recommend_new_roof: false }, who).line,
      ).toBe("The technician recommended repairs");
  });
});

describe("the After the inspection panel (and the banner, which is the same panel)", () => {
  it("reads the two switches and who closed the inspection out", () => {
    expect(actions).toMatch(
      /const pre = officePreselect\(\s*\{\s*recommend_repairs: ins\?\.recommend_repairs \?\? false,\s*recommend_new_roof: job\.recommend_new_roof,\s*\},\s*data\.closed_out_by,\s*\);/,
    );
    expect(section).toContain("<OfficeActions job={job} data={q.data} dirty={false} />");
  });
  it("the line stands above the buttons", () => {
    const line = actions.indexOf('data-line="technician-recommended"');
    expect(line).toBeGreaterThan(0);
    expect(actions.slice(line - 80, line + 120)).toContain("{pre.line && (");
    expect(actions.slice(line, line + 120)).toContain("{pre.line}");
    expect(line).toBeLessThan(actions.indexOf('data-action="create-repair-ticket"'));
  });
  it("the recommended choice is the filled button; the rest are outlined", () => {
    const repair = actions.slice(actions.indexOf('data-action="create-repair-ticket"') - 120);
    expect(repair.slice(0, 260)).toContain('variant={pre.repair ? "default" : "outline"}');
    expect(repair.slice(0, 260)).toContain('data-preselected={pre.repair ? "true" : undefined}');
    // Create bid: the live link and the one shown while the checklist is still saving.
    expect(actions.match(/variant=\{pre\.bid \? "default" : "outline"\}/g)).toHaveLength(2);
    expect(actions.match(/data-preselected=\{pre\.bid \? "true" : undefined\}/g)).toHaveLength(2);
    // No action needed is the black one only when nothing was recommended.
    const none = actions.slice(actions.indexOf('data-action="no-action-needed"') - 400);
    expect(none.slice(0, 400)).toContain('variant={pre.line ? "outline" : "default"}');
  });
  it("every choice stays pressable: the preselection disables nothing", () => {
    const disabled = [...actions.matchAll(/disabled=\{([^}]*)\}/g)].map((m) => m[1]);
    expect(disabled.length).toBeGreaterThan(0);
    for (const d of disabled) expect(d).not.toContain("pre.");
  });
});
