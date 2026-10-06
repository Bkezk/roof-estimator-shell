/**
 * Owner, Oct 6: the Tech Board "color coded the same colors as centerpoint … same base color as
 * centerpoint" and "as the stages update it changes color along the way"; "once the tech
 * completes it id like it to be green with a check mark"; colours everywhere stages show.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { STAGE_TONES, stageMark, ticketToneKey } from "@/lib/stage-colors";

describe("stage colours in CenterPoint's families", () => {
  it("Open pink (New Service), Scheduled orange, Done green, Authorized teal, Invoiced indigo", () => {
    expect(STAGE_TONES.open.chip).toContain("bg-pink-100");
    expect(STAGE_TONES.scheduled.chip).toContain("bg-orange-100");
    expect(STAGE_TONES.done.chip).toContain("bg-green-100");
    expect(STAGE_TONES.authorized.chip).toContain("bg-teal-100");
    expect(STAGE_TONES.invoiced.chip).toContain("bg-indigo-100");
    expect(STAGE_TONES.closed.chip).toContain("bg-slate-100");
    for (const t of Object.values(STAGE_TONES)) expect(t.chip).toMatch(/dark:bg-/);
  });
  it("a Scheduled card changes colour as the tech goes en route, then on site", () => {
    expect(ticketToneKey({ stage: "scheduled", field_status: null })).toBe("scheduled");
    expect(ticketToneKey({ stage: "scheduled", field_status: "en_route" })).toBe("en_route");
    expect(ticketToneKey({ stage: "scheduled", field_status: "on_site" })).toBe("on_site");
    expect(ticketToneKey({ stage: "done", field_status: "on_site" })).toBe("done");
    expect(STAGE_TONES.en_route.chip).toContain("bg-amber-100");
    expect(STAGE_TONES.on_site.chip).toContain("bg-violet-100");
  });
  it("Done carries a check mark, Authorized a double one", () => {
    expect(stageMark("done")).toBe("check");
    expect(stageMark("authorized")).toBe("double-check");
    expect(stageMark("scheduled")).toBeNull();
  });
});

const read = (p: string) => readFileSync(p, "utf8");
describe("used on the board, the ticket list and the stage strip", () => {
  it("the board's cards and legend", () => {
    const board = read("src/components/service/board-page.tsx");
    expect(board).not.toContain("STAGE_CHIP");
    expect(board).toContain("STAGE_TONES[toneKey].chip");
    expect(board).toContain(
      "const toneKey = ticketToneKey({ stage, field_status: j.field_status });",
    );
    expect(board).toContain(
      '<Check className="mr-0.5 inline h-3.5 w-3.5 align-[-2px]" aria-label="Done" />',
    );
    expect(board).toMatch(
      // Every stage's colour in the key (owner, Oct 6: Invoiced was missing).
      /stages=\{\[\s*"open",\s*"scheduled",\s*"en_route",\s*"on_site",\s*"done",\s*"authorized",\s*"invoiced",\s*"closed",?\s*\]\}/,
    );
  });
  it("the ticket list's stage badge and the ticket's stage strip", () => {
    const page = read("src/components/service-page.tsx");
    expect(page).toContain("<StageBadge stage={stage} fieldStatus={j.field_status} />");
    expect(page).toContain('<StageStrip cells={stageCells} label="Stages" tones={STAGE_DOTS} />');
    expect(read("src/components/stage-strip.tsx")).toContain("dotOf(c.key, look)");
  });
});
