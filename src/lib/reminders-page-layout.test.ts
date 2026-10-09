/**
 * Admin › Reminders (owner, Oct 9: "optimize and clarify this page a bit its layout is unusual
 * and spaced out"). The numbers sit inside short sentences; one compact card with four sections
 * (name and help on the left, sentences on the right) replaces the two-column grid of boxed
 * sub-cards; Save sits in the header and at the end.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/reminders-settings.tsx", "utf8");

describe("Reminders page layout", () => {
  it("four sections as sentences with inline day boxes", () => {
    for (const t of [
      'title="Opportunities"',
      'title="Tickets"',
      'title="Needs assignment"',
      'title="Untouched work"',
    ])
      expect(src).toContain(t);
    expect(src).toContain('Should close within {field("opportunity_close_days")} days.');
    expect(src).toMatch(
      /Remind the assignee after \{field\("opportunity_first_days"\)\} days, then every/,
    );
    expect(src).toMatch(
      /Unscheduled: remind the technician after \{field\("ticket_first_days"\)\} days/,
    );
    expect(src).toMatch(
      /Flag it overdue after \{daysFields\("unassigned"\)\} days without a person/,
    );
    expect(src).toMatch(
      /A ticket counts as untouched after \{field\("ticket_untouched_days"\)\} days with no\s+contact; an opportunity after \{field\("opportunity_untouched_days"\)\} days\./,
    );
  });
  it("section grid, inline boxes with the full label as their title, no boxed sub-cards", () => {
    expect(src).toContain("sm:grid-cols-[11rem_1fr]");
    expect(src).toMatch(/<NumberField\s+title=\{props\.field\.label\}/);
    expect(src).toContain("blankZero={false}");
    expect(src).not.toContain('className="space-y-4 rounded-lg border p-4"');
    expect(src).not.toContain("function DaysField(");
  });
  it("Save in the header and at the end of the form, bound by form id", () => {
    expect(src).toContain('form="reminder-settings"');
    expect(src).toContain('id="reminder-settings"');
    expect(src.match(/\{saveButton\}/g)?.length).toBe(2);
  });
  it("the page is capped in width", () => {
    expect(src).toContain('<div className="max-w-4xl space-y-6">');
  });
});
