/**
 * The Work Overview card names whose item it is (owner, Oct 9, from a List screenshot of
 * ticket #6003 with no name: "why doesnt this show who its assigned to on the card?"). The row
 * only named the person in the Everyone / one-person views, and a plain user's `names` map was
 * empty (they read no other profile), so their own cards never said who. Now the server always
 * puts the caller's own name in `names`, and the row shows the name whenever it has one.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ticketItem, type TicketIn } from "@/lib/my-work";

const read = (p: string) => readFileSync(p, "utf8");
const ME = "11111111-1111-4111-8111-111111111111";

const ticket = (over: Partial<TicketIn> = {}): TicketIn => ({
  id: "t6003",
  number: 6003,
  customer_name: "bell county",
  site_name: "bowling green hardees",
  site_address: null,
  description: "leak over the gym",
  service_type: "repair",
  stage: "scheduled",
  scheduled_date: "2026-09-29",
  technician_id: ME,
  ...over,
});

describe("whose card it is", () => {
  it("a ticket row carries the technician's name from the names map", () => {
    expect(ticketItem(ticket(), { [ME]: "Test Office" }).assigneeName).toBe("Test Office");
  });

  it("listMyWork fills the caller's own name whoever they are", () => {
    const src = read("src/lib/my-work.functions.ts");
    expect(src).toContain("names[context.userId] ??= nameOf(me);");
  });

  it("the row shows the name whenever it has one, not only in the Everyone view", () => {
    const src = read("src/components/my-work-page.tsx");
    expect(src).toMatch(
      /\(showWho \|\| item\.assigneeName\) && <span>\{item\.assigneeName \?\? "\(unknown\)"\}<\/span>/,
    );
    expect(src).not.toMatch(/\n\s*showWho && <span>\{item\.assigneeName \?\? "\(unknown\)"\}/);
  });
});
