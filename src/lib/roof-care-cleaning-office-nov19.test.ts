/**
 * Roof Care: what an inspection answered of the plan's cleaning, where the office looks (owner,
 * Nov 19, night: "Can you do number 3?" of the issues list: "'Answered by' shows only in the
 * workflow, not on the ticket page").
 *
 * Before this the answers, and who gave them, were visible only by opening the technician's
 * workflow on that ticket.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cleaningAsked, cleaningSummary } from "@/lib/roof-care-cleaning";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

describe("the cleaning answers, in words", () => {
  const guard = cleaningAsked("guard", "visit1");
  it("each question with its answer, then who answered and when", () => {
    expect(
      cleaningSummary({
        asked: guard,
        drains: true,
        gutters: false,
        note: "No lift on site",
        by_name: "Tyler M",
        at: "2027-06-20T15:00:00Z",
      }),
    ).toEqual([
      "Drains and scuppers cleaned: Yes",
      "Gutters cleaned: No: No lift on site",
      "Answered by Tyler M on Sun, Jun 20",
    ]);
  });
  it("says plainly what is not answered, and names nobody for it", () => {
    expect(
      cleaningSummary({
        asked: guard,
        drains: null,
        gutters: null,
        note: null,
        by_name: null,
        at: null,
      }),
    ).toEqual(["Drains and scuppers cleaned: Not answered", "Gutters cleaned: Not answered"]);
  });
  it("only what the plan asks: one line for Roof Care, none for Roof Watch or a storm inspection", () => {
    const a = { drains: true, gutters: null, note: null, by_name: "Sam R", at: null };
    expect(cleaningSummary({ ...a, asked: cleaningAsked("care", "visit2") })).toEqual([
      "Drains and scuppers cleaned: Yes",
      "Answered by Sam R",
    ]);
    expect(cleaningSummary({ ...a, asked: cleaningAsked("watch", "visit1") })).toEqual([]);
    expect(cleaningSummary({ ...a, asked: cleaningAsked("guard", "storm") })).toEqual([]);
  });
  it("the reason shows only with a No, and the day is the office's", () => {
    const lines = cleaningSummary({
      asked: guard,
      drains: true,
      gutters: true,
      // A reason typed for an earlier No, since answered Yes.
      note: "No lift on site",
      by_name: "Tyler M",
      // 02:30 UTC on Jun 21 is still Jun 20 at the office.
      at: "2027-06-21T02:30:00Z",
    });
    expect(lines.join(" ")).not.toContain("No lift");
    expect(lines.at(-1)).toBe("Answered by Tyler M on Sun, Jun 20");
  });
});

describe("where the office sees it", () => {
  const card = flat("src/components/roof-care/plan-card.tsx");
  it("on the ticket of a plan's inspection, under the buttons, for the office only", () => {
    expect(card).toContain("enabled: !!session && showsOffered && !!visitId,");
    expect(card).toContain(
      "{showsOffered && cleaning.data && cleaningSummary(cleaning.data).length > 0 && (",
    );
    expect(card).toContain("data-care-cleaning={");
    // The same list the workflow writes to, so an answer shows without a reload.
    expect(card).toContain('queryKey: roofCareCleaningKey(visitId ?? ""),');
    expect(flat("src/components/service/cleaning.tsx")).toContain(
      "qc.setQueryData(roofCareCleaningKey(c.visit_id), now);",
    );
  });
  it("and on the plan, beside each inspection, once it is answered or done", () => {
    expect(card).toContain(
      '(state === "done" || visit.drains_cleaned != null || visit.gutters_cleaned != null);',
    );
    expect(card).toContain(
      '<span className="basis-full text-muted-foreground" data-visit-cleaning>',
    );
    expect(card).toContain("plan={active.plan}");
    const f = flat("src/lib/roof-care-plan.functions.ts");
    expect(f).toContain('cleaning_note, cleaning_by_name, cleaning_at" as const;');
    expect(f).toContain("cleaning_by_name: v.cleaning_by_name ?? null,");
  });
});
