/**
 * Admin › Reminders (owner, Oct 9: "optimize and clarify this page a bit its layout is unusual
 * and spaced out"). The numbers sit inside short sentences; one compact card with four sections
 * (name and help on the left, sentences on the right) replaces the two-column grid of boxed
 * sub-cards; Save sits in the header and at the end.
 *
 * Later the same day: "its unclear what the remind the assignee after x days means … for
 * tickets who is it reminding if unassigned? if assigned is it 1 day after due date then every 3
 * days?" — each sentence now states the rule followups.server.ts runs: when the timer starts,
 * when the item is due, who is reminded and from when, and that nobody is reminded while an
 * item has no person on it.
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
    expect(src).toMatch(
      /Timer starts when someone is assigned\. Due at the expected close,\{" "\}\s*\{field\("opportunity_close_days"\)\} days after it is entered unless a date is set\./,
    );
    expect(src).toMatch(
      /Remind the assignee \{field\("opportunity_first_days"\)\} days after assignment \(never\s+later than the due date\), then every \{field\("opportunity_every_days"\)\} days until\s+it is won, lost or closed\./,
    );
    expect(src).toMatch(
      /Timer starts when a technician is assigned\. A scheduled ticket is due on its day:\s+remind the technician that day, then every \{field\("ticket_every_days"\)\} days until\s+it is Done\./,
    );
    expect(src).toMatch(
      /An unscheduled ticket is due \{field\("ticket_first_days"\)\} days after assignment:\s+remind the technician then, and again every \{draft\.ticket_every_days\} days until\s+it is Done\./,
    );
    expect(src).toMatch(
      /It sits under Unassigned on Work Overview and is flagged overdue there after\{" "\}\s*\{daysFields\("unassigned"\)\} days \(0 = the day it is entered\)\./,
    );
    expect(src).toMatch(
      /A ticket counts as untouched after \{field\("ticket_untouched_days"\)\} days with no\s+contact; an opportunity after \{field\("opportunity_untouched_days"\)\} days\./,
    );
    // The old wording the owner found unclear is gone.
    expect(src).not.toContain("Should close within");
    expect(src).not.toContain("Remind the assignee after");
    expect(src).not.toContain("Unscheduled: remind the technician after");
    expect(src).not.toContain("Flag it overdue after");
  });
  it("each section's help says who is reminded, from when, and what ends the timer", () => {
    expect(src).toContain(
      'help="Won, Lost or No response ends the timer; taking the assignee off stops the reminders."',
    );
    expect(src).toContain(
      'help="Done, Invoiced or Closed ends the timer; taking the technician off stops the reminders."',
    );
    expect(src).toContain(
      'help="Nobody is reminded while a ticket or opportunity has no person on it — there is no timer until someone is assigned."',
    );
    expect(src).toMatch(
      /help="Assigned, but no contact logged and not started\. Past the limit it turns red in the lists; the assignee is reminded as above, and the people below are told as well — right away, then again at the ticket's or opportunity's “every N days” above — until a contact is logged or it is started\."/,
    );
    // The card's description states the one rule behind all four.
    expect(src).toMatch(
      /A timer starts when a ticket gets a technician or an opportunity gets an assignee;\s+that person is reminded at these lengths until it is closed\. Nothing is timed, and\s+nobody is reminded, while an item has no person on it\./,
    );
    // The strings other tests and the settings keys pin are still there.
    expect(src).toContain("Escalate untouched items to every admin and manager");
    expect(src).toContain('key: "unassigned_overdue_days"');
    expect(src).toContain('daysFields("unassigned")');
    // The accessible names (the boxes' title) say the same as the sentences.
    expect(src).toContain('label: "First opportunity reminder N days after assignment"');
    expect(src).toContain(
      'label: "Unscheduled ticket due N days after the technician is assigned"',
    );
    // The rules are quoted from followups.server.ts in the header, so they stay in step.
    expect(src).toContain(
      "ticket = due on its scheduled day (or first_days from now when unscheduled), reminders",
    );
    expect(src).toContain(
      "Opportunity: first reminder after first_days, never later than the due date.",
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
  it("the page uses the full width, with a wider label column on large screens", () => {
    // Owner (Oct 9): "we're only using half the page here, make the panels wider".
    expect(src).not.toContain("max-w-4xl");
    expect(src).toContain('<div className="space-y-6">\n      <Card>');
    expect(src).toContain("lg:grid-cols-[15rem_1fr]");
  });
});
