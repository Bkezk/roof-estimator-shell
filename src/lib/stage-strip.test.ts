/**
 * The stage stepper after a backwards move (audit, Oct 2). Ticket #6003 went Open → Scheduled →
 * Done and then back to Scheduled: Done still carries its date, but it is AFTER the current
 * stage, so it must be drawn hollow and muted (its date shown, muted), not filled as reached.
 * Steps before the current are filled when dated; the current is ringed.
 *
 * Proved two ways: the pure helper (lib/stage-strip.ts stepLooks) and the real component
 * (components/stage-strip.tsx) rendered to HTML, so the test reads what the page draws.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StageStrip } from "@/components/stage-strip";
import { ticketStageStrip } from "@/lib/stage-dates";
import {
  DATE_AHEAD,
  DATE_SHOWN,
  DOT_AHEAD,
  DOT_CURRENT,
  DOT_REACHED,
  LABEL_AHEAD,
  LINE_AHEAD,
  LINE_REACHED,
  stepLooks,
} from "@/lib/stage-strip";

/** Ticket #6003's timeline: Done on Oct 1, then back to Scheduled on Oct 2. */
const T6003 = [
  { kind: "stage", stage: "open", at: "2026-09-29T14:00:00Z" },
  { kind: "stage", stage: "scheduled", at: "2026-09-30T14:00:00Z" },
  { kind: "stage", stage: "done", at: "2026-10-01T14:00:00Z" },
  { kind: "stage", stage: "scheduled", at: "2026-10-02T14:00:00Z" },
];
const cells = ticketStageStrip("scheduled", T6003);

describe("stepLooks: by position, not by date", () => {
  it("the cells: Scheduled current (dated Oct 2), Done dated Oct 1 though it is ahead", () => {
    expect(cells.map((c) => [c.key, c.current, c.at])).toEqual([
      ["open", false, "2026-09-29T14:00:00Z"],
      ["scheduled", true, "2026-10-02T14:00:00Z"],
      ["done", false, "2026-10-01T14:00:00Z"],
      ["authorized", false, null],
      ["invoiced", false, null],
      ["closed", false, null],
    ]);
  });
  it("#6003: Open reached, Scheduled current, Done / Authorized / Invoiced / Closed ahead", () => {
    expect(stepLooks(cells).map((l) => l.state)).toEqual([
      "reached",
      "current",
      "ahead",
      "ahead",
      "ahead",
      "ahead",
    ]);
  });
  it("#6003: Done is hollow and muted even with its date; its date is shown muted", () => {
    const [open, sched, done] = stepLooks(cells);
    expect(open!.dot).toBe(DOT_REACHED);
    expect(sched!.dot).toBe(DOT_CURRENT);
    expect(done!.dot).toBe(DOT_AHEAD);
    expect(done!.dot).not.toContain("bg-foreground/60");
    expect(done!.label).toBe(LABEL_AHEAD);
    expect(done!.date).toBe(DATE_AHEAD);
    expect(open!.date).toBe(DATE_SHOWN);
  });
  it("the connectors: filled up to the current step, plain after it", () => {
    expect(stepLooks(cells).map((l) => l.line)).toEqual([
      LINE_REACHED,
      LINE_AHEAD,
      LINE_AHEAD,
      LINE_AHEAD,
      LINE_AHEAD,
      LINE_AHEAD,
    ]);
  });
  it("a skipped step before the current one (never entered) stays hollow", () => {
    const skipped = ticketStageStrip("done", [
      { kind: "stage", stage: "open", at: "2026-09-29T14:00:00Z" },
      { kind: "stage", stage: "done", at: "2026-10-01T14:00:00Z" },
    ]);
    const looks = stepLooks(skipped);
    expect(looks.map((l) => l.state)).toEqual([
      "reached",
      "reached",
      "current",
      "ahead",
      "ahead",
      "ahead",
    ]);
    expect(looks[1]!.dot).toBe(DOT_AHEAD);
    expect(looks[0]!.dot).toBe(DOT_REACHED);
  });
  it("the forward path is unchanged: every step before the current filled", () => {
    const fwd = ticketStageStrip("invoiced", [
      { kind: "stage", stage: "open", at: "2026-09-29T14:00:00Z" },
      { kind: "stage", stage: "scheduled", at: "2026-09-30T14:00:00Z" },
      { kind: "stage", stage: "done", at: "2026-10-01T14:00:00Z" },
      { kind: "stage", stage: "authorized", at: "2026-10-01T18:00:00Z" },
      { kind: "stage", stage: "invoiced", at: "2026-10-02T14:00:00Z" },
    ]);
    expect(stepLooks(fwd).map((l) => l.dot)).toEqual([
      DOT_REACHED,
      DOT_REACHED,
      DOT_REACHED,
      DOT_REACHED,
      DOT_CURRENT,
      DOT_AHEAD,
    ]);
  });
  it("no current step (an unknown stage): dated steps read as reached", () => {
    const none = ticketStageStrip("bogus", T6003);
    expect(stepLooks(none).map((l) => l.state)).toEqual([
      "reached",
      "reached",
      "reached",
      "ahead",
      "ahead",
      "ahead",
    ]);
  });
});

describe("the component as rendered (ticket #6003)", () => {
  const html = renderToStaticMarkup(createElement(StageStrip, { cells, label: "Stages" }));
  /** One <li> of the rendered strip by its data-stage. */
  const item = (key: string) => {
    const m = html.match(new RegExp(`<li[^>]*data-stage="${key}"[^>]*>(.*?)</li>`));
    expect(m, key).not.toBeNull();
    return m![1]!;
  };
  const dotOf = (li: string) => li.match(/<span aria-hidden="true" class="([^"]*)"/)![1]!;
  it("Done (after the current Scheduled) is drawn hollow, not filled", () => {
    const done = dotOf(item("done"));
    expect(done).toContain("border border-muted-foreground/40 bg-background");
    expect(done).not.toContain("bg-foreground/60");
  });
  it("Done's date stays visible (Oct 1), muted", () => {
    const done = item("done");
    expect(done).toContain("Oct 1");
    expect(done).toMatch(/<span class="tabular-nums text-muted-foreground[^"]*">Oct 1<\/span>/);
    expect(done).toMatch(/<span class="[^"]*text-muted-foreground[^"]*">Done<\/span>/);
  });
  it("Open is filled; Scheduled is the ringed current step", () => {
    expect(dotOf(item("open"))).toContain("bg-foreground/60");
    expect(dotOf(item("scheduled"))).toContain("ring-2 ring-primary");
    expect(item("scheduled")).toBe(item("scheduled"));
    expect(html).toMatch(/<li[^>]*data-stage="scheduled"[^>]*aria-current="step"/);
  });
});
