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
  it("four sections as labelled lines: who, due, first reminder, after that", () => {
    // Owner, Oct 9, on the sentence version: "i still think this wording is a bit unclear" —
    // each rule is now one line with a label naming the question it answers.
    for (const t of [
      'title="Opportunities"',
      'title="Tickets"',
      'title="Needs assignment"',
      'title="Untouched work"',
    ])
      expect(src).toContain(t);
    expect(src.match(/<Line label="Who is reminded">/g)?.length).toBe(2);
    expect(src.match(/<Line label="Due date">/g)?.length).toBe(2);
    expect(src.match(/<Line label="First reminder">/g)?.length).toBe(2);
    expect(src.match(/<Line label="After that">/g)?.length).toBe(2);
    // Opportunities
    expect(src).toMatch(
      /The person assigned to the opportunity\. Nobody, until someone is assigned\./,
    );
    expect(src).toMatch(
      /The expected close date\. When none is set, \{field\("opportunity_close_days"\)\} days\s+after the opportunity is entered\./,
    );
    expect(src).toMatch(
      /\{field\("opportunity_first_days"\)\} days after the person is assigned, or on the due\s+date if that comes first\./,
    );
    expect(src).toMatch(
      /Every \{field\("opportunity_every_days"\)\} days until it is won, lost or marked No\s+response\./,
    );
    // Tickets
    expect(src).toMatch(/The technician on the ticket\. Nobody, until one is assigned\./);
    expect(src).toMatch(
      /The scheduled day\. With no scheduled day, \{field\("ticket_first_days"\)\} days after\s+the technician is assigned\./,
    );
    expect(src).toContain('<Line label="First reminder">On the due date.</Line>');
    expect(src).toMatch(/Every \{field\("ticket_every_days"\)\} days until the ticket is Done\./);
    // Needs assignment
    expect(src).toContain('<Line label="Where it shows">Under Unassigned on Work Overview.</Line>');
    expect(src).toMatch(
      /<Line label="Flagged overdue">\s+\{daysFields\("unassigned"\)\} days after it is entered with nobody assigned \(0 = the\s+same day\)\./,
    );
    // Untouched work
    expect(src).toMatch(
      /<Line label="Counts as untouched">\s+A ticket after \{field\("ticket_untouched_days"\)\} days with no contact logged; an\s+opportunity after \{field\("opportunity_untouched_days"\)\} days\./,
    );
    expect(src).toContain('<Line label="What happens">');
    expect(src).toContain('<Line label="Also tell">');
    expect(src).toContain('<Line label="And these people">');
    expect(src).toContain("<span>Every admin and manager</span>");
    // The label column inside each section.
    expect(src).toContain("sm:grid-cols-[10rem_1fr]");
    expect(src).not.toContain("function Row(");
    // The old wordings the owner found unclear are gone.
    expect(src).not.toContain("Should close within");
    expect(src).not.toContain("Remind the assignee");
    expect(src).not.toContain("Unscheduled: remind the technician after");
    expect(src).not.toContain("Flag it overdue after");
    expect(src).not.toContain("Timer starts when someone is assigned. Due at the expected close");
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
      /help="Assigned, but no contact logged and not started\. Past the limit it turns red in the lists; the assignee is reminded as above, and the people below are told as well — right away, then again at the ticket's or opportunity's “After that” interval above — until a contact is logged or it is started\."/,
    );
    // The card's description states the one rule behind all four, and what each line answers.
    expect(src).toMatch(
      /A timer starts when a ticket gets a technician or an opportunity gets an assignee;\s+that person is reminded at these lengths until it is closed\. Nothing is timed, and\s+nobody is reminded, while an item has no person on it\./,
    );
    expect(src).toMatch(
      /Each line below says who is\s+reminded, when the item is due, when the first reminder goes and how often after that\./,
    );
    // The strings other tests and the settings keys pin are still there.
    expect(src).toContain("Escalate untouched items to every admin and manager");
    expect(src).toContain('key: "unassigned_overdue_days"');
    expect(src).toContain('daysFields("unassigned")');
    // The accessible names (the boxes' title) say the same as the lines.
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
