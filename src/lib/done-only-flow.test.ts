/**
 * Owner, Oct 8: "we dont need the en route then on site buttons for tickets it should just be
 * done then present that workflow, also they should be able to leave and reenter that workflow
 * anytime and it should auto save because they'll have to take pictures before and then after".
 * Today's card has one button, Done, which opens the close-out; the close-out already saves as
 * it goes and is reached again from Today and from the ticket page; Complete now points out a
 * ticket with no time logged, since nothing stamps labor any more.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { missingForComplete } from "@/lib/closeout-check";

const src = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

describe("Today: one button", () => {
  const today = src("src/components/service/today-page.tsx");
  it("the one button, Open ticket, opens the close-out; no En route, On site or Undo", () => {
    expect(today).toContain(
      'void navigate({ to: "/service", search: { id: j.id, closeout: 1 } });',
    );
    expect(today).toContain("Open ticket");
    expect(today).not.toMatch(/>\s*Done\s*</);
    expect(today).not.toMatch(/label: "En route"|label: "On site"/);
    expect(today).not.toContain('step.mutate("undo")');
    expect(today).not.toContain("setFieldStatus");
    expect(today).not.toContain("nextStep(");
  });
  it("the crew question moved to the close-out; an answered card still shows Change", () => {
    expect(today).toContain("const askCrew = false;");
    expect(today).toContain('{crewOpen ? "Done" : "Change"}');
  });
});

describe("the close-out is the workflow", () => {
  const closeout = src("src/components/service/closeout.tsx");
  it("is reached from Today and from the ticket page, and saves as it goes", () => {
    expect(closeout).toContain("Reached from Today's and the ticket page's Open ticket button");
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
    expect(closeout).toContain(
      "...(timeQ.data && !job.on_site_at ? { time_hours: timeQ.data.reduce((sum, r) => sum + Number(r.hours), 0) } : {}),",
    );
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
      closing_notes: "Fixed it",
    };
    expect(missingForComplete({ ...base, time_hours: 0 })).toEqual(["No time logged"]);
    expect(missingForComplete({ ...base, time_hours: 1.5 })).toEqual([]);
    expect(missingForComplete(base)).toEqual([]);
    // In the screen's order: repairs and photos, time, notes, signature.
    expect(
      missingForComplete({ ...base, time_hours: 0, closing_notes: "", signature_path: null }),
    ).toEqual(["No time logged", "No closing notes", "No customer signature"]);
  });
});
