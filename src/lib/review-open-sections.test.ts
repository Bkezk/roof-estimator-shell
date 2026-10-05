/**
 * Owner, Oct 5 (service follow-up 6): when a manager reviews a Done / Authorized ticket, Time and
 * Materials are open (remembered apart from the everyday state) and Time's header splits travel
 * and labor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/components/service-page.tsx", "utf8");
const sections = readFileSync("src/components/service/ticket-field-sections.tsx", "utf8");
const materials = readFileSync("src/components/service/materials-section.tsx", "utf8");

describe("a manager reviewing a Done / Authorized ticket", () => {
  it("Materials opens, remembered under its own key", () => {
    expect(page).toContain(
      'const review = manager && (jobStage === "done" || jobStage === "authorized");',
    );
    expect(page).toContain(
      'defaultOpen={review || (isTech && (jobStage === "open" || jobStage === "scheduled"))}',
    );
    expect(page).toContain('storageKey={review ? "materials-review" : undefined}');
    expect(materials).toContain("storageKey={storageKey}");
    expect(materials).toContain('storageKey = "materials",');
  });
  it("Time opens, remembered under its own key, its header split into travel and labor", () => {
    expect(sections).toContain(
      'managesTickets(profile) && (job.stage === "done" || job.stage === "authorized")',
    );
    expect(sections).toContain("defaultOpen={review}");
    expect(sections).toContain('storageKey={review ? "time-review" : "time"}');
    expect(sections).toContain(
      '`Travel ${hoursText(hoursOf("travel"))} · Labor ${hoursText(hoursOf("labor"))}`',
    );
  });
});
