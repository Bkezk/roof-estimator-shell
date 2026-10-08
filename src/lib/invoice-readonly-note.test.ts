/**
 * Owner, Oct 8: "i dont see how you can edit an invoice" (on 6006, which is void). Only a draft
 * is edited; a final, sent or paid invoice is frozen and a void one stays on record. The page now
 * says so where the editor would be, and what to do instead.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ed = readFileSync("src/components/service/invoice-editor.tsx", "utf8");
// Whitespace folded: the page wraps its sentences across lines.
const final = ed
  .slice(ed.indexOf("function FinalInvoice("), ed.indexOf("// ---- Dialogs"))
  .replace(/\s+/g, " ");

describe("a finished invoice says why it cannot be edited", () => {
  it("final / sent: only a draft is edited; void it and make a new one", () => {
    expect(final).toContain('{(status === "final" || status === "sent") && (');
    expect(final).toContain(
      "This invoice is {STATUS_LABELS[status].toLowerCase()}, so it can't be edited. To change it, Void it below and make a new invoice from the ticket.",
    );
  });
  it("paid: it can't be edited (a paid invoice is not voided)", () => {
    expect(final).toContain(
      "This invoice is paid, so it can't be edited. A correction goes through Sage.",
    );
  });
  it("void: bill the ticket from its invoice card", () => {
    expect(final).toContain(
      "This invoice is void. It stays on record under its number and is left out of the Sage export. To bill this ticket, open it (the title above) and choose Make the invoice.",
    );
  });
});
