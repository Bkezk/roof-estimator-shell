/**
 * Authorized counts as open work for a customer (owner, Oct 6). OPEN_TICKET_STAGES in
 * crm-account.ts was open / scheduled / done, so a customer with an Authorized, not yet invoiced
 * ticket could be deleted — and the ticket count on the Customers list left it out.
 *
 * Work Overview's counts (work-counts.ts) keep their own three stages: the owner said the Work
 * Overview lists stay as they are.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { OPEN_TICKET_STAGES, deleteBlockedMessage, keepsCustomer } from "@/lib/crm-account";
import { SERVICE_STAGES } from "@/lib/service.functions";

const read = (p: string) => readFileSync(p, "utf8");

describe("the stages that keep a customer", () => {
  it("open, scheduled, done and authorized — not invoiced or closed", () => {
    expect([...OPEN_TICKET_STAGES]).toEqual(["open", "scheduled", "done", "authorized"]);
    for (const s of SERVICE_STAGES)
      expect(keepsCustomer(s), s).toBe(s !== "invoiced" && s !== "closed");
  });
  it("a customer with one Authorized ticket is refused with the count", () => {
    const tickets = [{ stage: "authorized" }, { stage: "invoiced" }, { stage: "closed" }].filter(
      (t) => keepsCustomer(t.stage),
    );
    expect(deleteBlockedMessage(tickets.length, 0)).toBe(
      "This customer has 1 open ticket; close or move them first",
    );
    expect(deleteBlockedMessage(0, 0)).toBeNull();
  });
});

describe("the server uses the one constant", () => {
  const crm = read("src/lib/crm.functions.ts");
  it("deleteAccount counts live tickets in OPEN_TICKET_STAGES from crm-account.ts", () => {
    const fn = crm.slice(crm.indexOf("export const deleteAccount"));
    expect(fn.slice(0, 2000)).toContain('.in("stage", [...OPEN_TICKET_STAGES])');
    const imports = crm.slice(0, crm.indexOf("\nexport "));
    expect(imports).toMatch(/import \{[^}]*OPEN_TICKET_STAGES[^}]*\} from "@\/lib\/crm-account";/);
    expect(imports).not.toMatch(
      /import \{[^}]*OPEN_TICKET_STAGES[^}]*\} from "@\/lib\/work-counts"/,
    );
  });
  it("Work Overview's own set is untouched (owner: the lists stay as they are)", () => {
    expect(read("src/lib/work-counts.ts")).toContain(
      'export const OPEN_TICKET_STAGES = ["open", "scheduled", "done"] as const;',
    );
  });
});
