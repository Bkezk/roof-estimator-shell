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
 *
 * Nov 18: "i feel like its still a bit confusing. can you make a standardized version for each
 * type opp, bid, service ticket etc. where you can select multiple people from a dropdown on who
 * gets alerted and the frequency in days", then of the drawing with one card per type: "i like
 * idea 1". The four sections worded each their own way became three cards with the same lines.
 * The checks below were rewritten for that layout; the Save bar's is as it was.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/reminders-settings.tsx", "utf8");

describe("Reminders page layout", () => {
  const flat = src.replace(/\s+/g, " ");
  it("three cards, one per kind of work, in the same order as the menu", () => {
    const at = (t: string) => src.indexOf(t);
    const order = ['type="ticket"', 'type="opportunity"', 'type="bid"'].map(at);
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(src.match(/<TypeCard\s/g)?.length).toBe(3);
    // The card's name comes from the rules, so the page, the notices and the tests agree.
    expect(flat).toContain(
      '<h3 className="text-base font-semibold">{TYPE_TITLES[props.type]}</h3>',
    );
    expect(flat).toContain('<section className="rounded-lg border p-3" data-card={props.type}>');
    // The old sections are gone.
    for (const t of [
      'title="Opportunities"',
      'title="Tickets"',
      'title="Needs assignment"',
      'title="Untouched work"',
      "function Section(",
      "function Row(",
    ])
      expect(src).not.toContain(t);
  });
  it("the same lines on every card, each with its who dropdown", () => {
    const lines = (type: string) =>
      [...src.matchAll(new RegExp(`picker\\("${type}", "([a-z_]+)"\\)`, "g"))].map((m) => m[1]);
    expect(lines("ticket")).toEqual([
      "coming_up",
      "past_due",
      "not_started",
      "nobody",
      "review",
      "steps",
    ]);
    expect(lines("opportunity")).toEqual([
      "coming_up",
      "past_due",
      "not_started",
      "nobody",
      "steps",
    ]);
    expect(lines("bid")).toEqual(["coming_up", "past_due", "steps"]);
    // A line's label is the rule's own name.
    for (const l of ["coming_up", "past_due", "not_started", "nobody", "review", "steps"])
      expect(src).toContain(`<Line label={LINE_LABELS.${l}}`);
    // Two lines have no dropdown: where the date comes from. The bids' own reminder is theirs.
    expect(src.match(/<Line label="Due date">/g)?.length).toBe(2);
    expect(src.match(/<Line label="Own reminder">/g)?.length).toBe(1);
  });
  it("each card's help says what its date is and what ends its reminders", () => {
    expect(src).toContain(
      'help="The date is the scheduled day. Done ends its reminders; so does taking the technician off."',
    );
    expect(src).toContain(
      'help="The date is the expected close. Won, Lost or No response ends its reminders; so does taking the assignee off."',
    );
    expect(src).toContain(
      'help="The date is the bid\'s due date. Only a draft is reminded; a submitted, won or lost bid is not."',
    );
    // The card's description says the one rule behind all three.
    expect(flat).toContain(
      "One card for each kind of work, with the same lines on each. Every line has its number of days and who is told. A blank box, or nobody picked, turns that line off. Changes take effect from the next reminder.",
    );
    // The old wordings the owner found unclear stay gone.
    for (const t of [
      "Should close within",
      "Remind the assignee",
      "Unscheduled: remind the technician after",
      "Flag it overdue after",
      "Escalate untouched items to every admin and manager",
      '<Line label="Also tell">',
      '<Line label="First reminder">',
    ])
      expect(src).not.toContain(t);
  });
  it("the sentences: where the date comes from, and each line's pace", () => {
    expect(flat).toContain(
      'The scheduled day. With none, {field("ticket_first_days")} days after the technician is assigned.',
    );
    expect(flat).toContain(
      'The expected close. With none, {field("opportunity_close_days")} calendar days after it is entered.',
    );
    expect(flat).toContain(
      'Every {field("opportunity_before_every_days")} days before the expected close, and a notice {field("opportunity_due_notice_days")} days before it. Also on the morning of the date.',
    );
    expect(flat).toContain(
      'After {field("unassigned_overdue_days")} days with no technician, then every{" "} {field("ticket_unassigned_every_days")} days. It also turns red on Work Overview.',
    );
    expect(flat).toContain(
      'After {field("opportunity_unassigned_days")} days with nobody assigned, then every{" "} {field("opportunity_unassigned_every_days")} days. It also turns red on Work Overview.',
    );
    expect(flat).toContain(
      'Every {field("ticket_review_every_days")} days until it is authorized.',
    );
    expect(flat).toContain(
      "Once when it is opened, scheduled, reassigned, moved, authorized, invoiced, closed or deleted.",
    );
    expect(flat).toContain("Once when it is opened, assigned, changes status or is deleted.");
    expect(flat).toContain("Once when it is started, changes status or is deleted.");
    // Tasks are not a card; the page says so, and where a person turns a notice off.
    expect(flat).toContain(
      "Tasks keep their own notices: when one is given to someone, the morning it is due, and when it is overdue. Each person can turn a kind of notice off for themselves on My account.",
    );
  });
  it("inline boxes with the full label as their title; the line is a row on a desk and stacks on a phone", () => {
    expect(src).toContain("lg:grid-cols-[8.5rem_1fr_17rem]");
    expect(src).toMatch(/<NumberField\s+title=\{props\.field\.label\}/);
    expect(src).toContain("blankZero={false}");
    expect(src).not.toContain('className="space-y-4 rounded-lg border p-4"');
    expect(src).not.toContain("function DaysField(");
    // Every box has a name that says its card and its line.
    // Every day box has a name that says its card and its line (the last two are the Owner
    // page's limits).
    const labels = [...src.matchAll(/\blabel:\s*"([^"]+)",/g)].map((m) => m[1]);
    expect(labels).toHaveLength(19);
    for (const l of labels.slice(0, 17)) expect(l).toMatch(/^(Tickets|Opportunities|Bids)[,:] /);
  });
  // Nov 17: one Save, in the bar that stays at the bottom of the window (save-bar.tsx), where
  // there was one in the header and one at the end of the form. It is inside the form, so it
  // needs no form id to submit it.
  it("Save in the bar at the end of the form, always in reach", () => {
    expect(src).toContain('id="reminder-settings"');
    expect(src).not.toContain("{saveButton}");
    expect(src.match(/type="submit"/g)).toHaveLength(1);
    const form = src.slice(src.indexOf('id="reminder-settings"'), src.indexOf("</form>"));
    expect(form).toMatch(/<SaveBar className="mt-4">[\s\S]*type="submit"[\s\S]*<\/SaveBar>/);
  });
  it("the page uses the full width", () => {
    // Owner (Oct 9): "we're only using half the page here, make the panels wider".
    expect(src).not.toContain("max-w-4xl");
    expect(src).toContain('<div className="space-y-6">\n      <Card>');
  });
});
