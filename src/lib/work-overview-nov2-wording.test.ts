/**
 * Work Overview wording, Nov 2 (the owner, after the browser run):
 *
 *  1. "(unknown)" → "No technician": a Done or Authorized ticket nobody is on (the technician
 *     removed, or closed out by the office) read "(unknown)" as its person on Everyone, as if a
 *     name lookup had failed. A ticket row with no technician now says "No technician"; any other
 *     kind whose person cannot be named still reads "(unknown)".
 *  2. "if something is marked done it can still show as overdue": a Done ticket under Needs
 *     authorization carried its Authorize timer's state line, "Overdue 17 days" in red — the
 *     ticket is finished; what is late is the authorization. The line for an Authorize timer
 *     (kind "invoice") now reads "Authorization overdue 17 days" / "Authorization due today" /
 *     "Authorization due Fri, Oct 16", so nothing marked Done reads as overdue work.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { followupStateText } from "@/lib/followup-rules";
import { followupItem, type FollowupIn } from "@/lib/my-work";

const read = (p: string) => readFileSync(p, "utf8");
const utcDay = (iso: string) => iso.slice(0, 10);
const TODAY = "2026-11-02";

describe("1. a ticket with no technician reads 'No technician'", () => {
  it("the row: a ticket kind with no assignee says No technician; another kind keeps (unknown)", () => {
    const page = read("src/components/my-work-page.tsx");
    const row = page.slice(
      page.indexOf("function WorkRow("),
      page.indexOf("function WaitingSince"),
    );
    expect(row).toContain("const noTech = !item.assigneeId && isTicketKind(item.kind);");
    expect(row).toContain('{noTech ? "No technician" : (item.assigneeName ?? "(unknown)")}');
    expect(row).toContain("(showWho || item.assigneeName || noTech) && (");
  });
});

describe("2. an Authorize timer's line names the authorization, not the ticket, as late", () => {
  const base = { due_at: "2026-10-16T14:33:00Z", every_days: 3 };
  it("overdue / due today / due later, for kind invoice", () => {
    const texts = (f: Parameters<typeof followupStateText>[0]) =>
      followupStateText(f, TODAY, utcDay).map((p) => `${p.tone}:${p.text}`);
    expect(texts({ ...base, kind: "invoice" })).toEqual([
      "overdue:Authorization overdue 17 days",
      "normal:Reminders every 3 days",
    ]);
    expect(texts({ ...base, kind: "invoice", due_at: "2026-11-02T14:00:00Z" })[0]).toBe(
      "normal:Authorization due today",
    );
    expect(texts({ ...base, kind: "invoice", due_at: "2026-11-05T14:00:00Z" })[0]).toBe(
      "normal:Authorization due Thu, Nov 5",
    );
    // Any other kind, and no kind at all: as before.
    expect(texts({ ...base, kind: "ticket" })[0]).toBe("overdue:Overdue 17 days");
    expect(texts(base)[0]).toBe("overdue:Overdue 17 days");
  });
  it("the kind reaches the row: WorkFollowup carries it from the server row", () => {
    const f: FollowupIn = {
      id: "f1",
      title: "Authorize Ticket #6029",
      url: "/service?id=t1",
      due_at: base.due_at,
      status: "open",
      kind: "invoice",
      item_id: "t1",
      assignee_id: "brandon",
      every_days: 3,
    };
    expect(followupItem(f, {}, utcDay).followup).toMatchObject({ id: "f1", kind: "invoice" });
  });
});
