/**
 * The ticket stage strip says who set each stage (owner, Oct 12: "go ahead and add it" — the
 * opportunity strip already shows "by <name>" under each status date; the ticket strip showed the
 * date only, though the timeline's 'stage' rows carry by_name from service_jobs_stage_log).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stageActors, ticketStageStrip } from "@/lib/stage-dates";

const events = [
  { kind: "stage", stage: "open", at: "2026-10-01T12:00:00Z", by_name: "Office Olga" },
  { kind: "stage", stage: "scheduled", at: "2026-10-02T12:00:00Z", by_name: "Mo Manager" },
  { kind: "stage", stage: "done", at: "2026-10-05T20:00:00Z", by_name: "Tech Tom" },
  // Authorized twice (a void sent it back): the LAST setter wins.
  { kind: "stage", stage: "authorized", at: "2026-10-06T12:00:00Z", by_name: "Brandon Keck" },
  { kind: "stage", stage: "authorized", at: "2026-10-08T12:00:00Z", by_name: "Braden Keck" },
  // An invoice-path stage with no actor name (system): dated, nobody named.
  { kind: "stage", stage: "invoiced", at: "2026-10-07T12:00:00Z", by_name: null },
  // Not a stage row: ignored.
  { kind: "note", stage: null, at: "2026-10-09T12:00:00Z", by_name: "Nobody" },
];

describe("ticket stage strip: by <name> under each stage date", () => {
  it("stageActors names the last setter of each reached stage, nobody for a nameless row", () => {
    expect(stageActors(events)).toEqual({
      open: "Office Olga",
      scheduled: "Mo Manager",
      done: "Tech Tom",
      authorized: "Braden Keck",
    });
  });
  it("ticketStageStrip carries `by` on named cells only", () => {
    const cells = ticketStageStrip("authorized", events);
    const by = Object.fromEntries(cells.map((c) => [c.key, c.by ?? null]));
    expect(by).toEqual({
      open: "Office Olga",
      scheduled: "Mo Manager",
      done: "Tech Tom",
      authorized: "Braden Keck",
      invoiced: null,
      closed: null,
    });
    expect(cells.find((c) => c.key === "invoiced")?.at).toBe("2026-10-07T12:00:00Z");
    expect(cells.find((c) => c.key === "closed")?.at).toBeNull();
  });
  it("the strip component prints `by` (shared with the opportunity strip) and the page feeds it timeline rows", () => {
    const strip = readFileSync("src/components/stage-strip.tsx", "utf8");
    expect(strip).toMatch(/\{c\.by && \(/);
    expect(strip).toContain("by {c.by}");
    const page = readFileSync("src/components/service-page.tsx", "utf8");
    expect(page).toContain("ticketStageStrip(asStage(job.stage), eventsQ.data ?? [])");
  });
});
