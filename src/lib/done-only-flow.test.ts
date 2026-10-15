/**
 * Owner, Oct 8: "we dont need the en route then on site buttons for tickets it should just be
 * done then present that workflow, also they should be able to leave and reenter that workflow
 * anytime and it should auto save because they'll have to take pictures before and then after".
 * Today's card had one button, Open ticket, which opens the close-out; the close-out saves as it
 * goes and is reached again from Today and from the ticket page; Complete points out a ticket
 * with no time logged.
 *
 * Owner, Oct 15: the buttons are back as the CLOCK (CenterPoint-style; tech-clock.ts,
 * tech-clock-wiring.test.ts): Start travel / On site / Leave site / Complete on each card, one
 * running clock per technician, the entries written with their real times. Open ticket stays;
 * the close-out is still the workflow and still saves as it goes. The "no buttons" pins below
 * are rewritten for that.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { missingForComplete } from "@/lib/closeout-check";

const src = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

describe("Today: Open ticket, and the clock's buttons (owner, Oct 15)", () => {
  const today = src("src/components/service/today-page.tsx");
  it("Open ticket opens the close-out; the clock's buttons sit beside it (no Done, no Undo button)", () => {
    expect(today).toContain(
      'void navigate({ to: "/service", search: { id: j.id, closeout: 1 } });',
    );
    expect(today).toContain("Open ticket");
    expect(today).not.toMatch(/>\s*Done\s*</);
    // Owner, Oct 15: Start travel / On site are the clock (tech-clock.ts cardActions), pressed
    // through setFieldStatus; the card has no undo button. The banner at the top (the running
    // clock's one control) has a small "started travel by mistake? Cancel" — undo, nothing logged.
    expect(today).toContain("const actions = cardActions(clock, j.id);");
    expect(today).toContain("setFieldStatus");
    expect(today).not.toContain('press_.mutate("undo")');
    expect(today).toContain('onClick={() => press.mutate("undo")}');
    expect(today).not.toContain("nextStep(");
  });
  it("the crew question moved to the close-out; an answered card still shows Change", () => {
    // Owner, Oct 9: the dead `askCrew = false` is gone; Change alone opens the box.
    expect(today).not.toContain("askCrew");
    expect(today).toContain("{crewOpen && <CrewBox job={j} />}");
    expect(today).toContain('{crewOpen ? "Done" : "Change"}');
  });
});

describe("the close-out is the workflow", () => {
  const closeout = src("src/components/service/closeout.tsx");
  it("is reached from Today and from the ticket page, and saves as it goes", () => {
    expect(closeout).toContain("Reached from My tickets' and the ticket page's Open ticket button");
    expect(src("src/components/service-page.tsx")).toContain(
      '<ClipboardCheck className="mr-1 h-4 w-4" /> Open ticket',
    );
    expect(closeout).toContain("useAutosave<TextDraft>(");
    expect(src("src/components/service-page.tsx")).toContain(
      '<Link to="/service" search={{ id: job.id, closeout: 1 }}>',
    );
  });
  it("Complete checks the time logged on tickets without an On site stamp", () => {
    expect(closeout).toContain("queryFn: () => timeFn({ data: { id: job.id } }),");
    // Owner, Oct 9: the time read goes to completeGaps with the On site stamp (closeout-check.ts
    // skips the time check when the stamp's labor is added by Complete itself). Owner, Oct 15:
    // that stamp is the labor clock running on this ticket, or an older ticket's On site stamp
    // (onSiteAt), never one a closed clock left behind.
    expect(closeout).toContain("on_site_at: onSiteAt,");
    expect(closeout).toContain("time: timeQ }");
  });
  it("missingForComplete: 'No time logged' when hours are given and zero; untouched for older callers", () => {
    const base = {
      service_type: "repair",
      repairs: [{ id: "r1", name: "Patch" }],
      photos: [
        { repair_id: "r1", role: "before" },
        { repair_id: "r1", role: "after" },
      ],
      signature_path: "sig.png",
    };
    expect(missingForComplete({ ...base, time_hours: 0 })).toEqual(["No time logged"]);
    expect(missingForComplete({ ...base, time_hours: 1.5 })).toEqual([]);
    expect(missingForComplete(base)).toEqual([]);
    // In the screen's order: repairs and photos, time, signature (the notes are skippable, owner
    // Oct 9: never a gap).
    expect(missingForComplete({ ...base, time_hours: 0, signature_path: null })).toEqual([
      "No time logged",
      "No customer signature",
    ]);
  });
});
