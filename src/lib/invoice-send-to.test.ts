/**
 * "Send To" edited on one invoice only (owner, Oct 8: "fix that to where its editable on one
 * invoice only like centerpoint"). CenterPoint lets the printed Send To be changed on an invoice
 * ("will not save to the Ticket or Property"). In the portal the invoice already keeps its own
 * copy (invoices.bill_to); a draft may now change its name and address lines. The billing
 * instructions and the Sage customer id (external_id) stay, and the customer's record is not
 * touched. A final invoice cannot change (void it, as before).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { mergeSendTo, sendToEdited, sendToOf, SEND_TO_FIELDS } from "@/lib/invoice-send-to";

const read = (p: string) => readFileSync(p, "utf8");

const saved = {
  name: "Microtel Inn",
  address1: "1895 West Highway",
  address2: "",
  city: "London",
  state: "KY",
  zip: "40741",
  instructions: "Need a PO on invoice",
  external_id: "687199",
};

describe("mergeSendTo — the invoice's own Send To", () => {
  it("changes the name and address lines on the invoice's copy", () => {
    const out = mergeSendTo(saved, {
      name: "Microtel Inn — Attn: Accounts Payable",
      address1: "PO Box 12",
    });
    expect(out.name).toBe("Microtel Inn — Attn: Accounts Payable");
    expect(out.address1).toBe("PO Box 12");
    expect(out.city).toBe("London");
  });
  it("keeps the billing instructions and the Sage customer id whatever is sent", () => {
    const out = mergeSendTo(saved, {
      name: "X",
      instructions: "changed",
      external_id: "999",
    } as Record<string, string>);
    expect(out.instructions).toBe("Need a PO on invoice");
    expect(out.external_id).toBe("687199");
  });
  it("trims what is typed; a blank line is kept blank", () => {
    const out = mergeSendTo(saved, { name: "  Microtel  ", address2: "   " });
    expect(out.name).toBe("Microtel");
    expect(out.address2).toBe("");
  });
  it("the editable fields are exactly the six printed lines", () => {
    expect(SEND_TO_FIELDS).toEqual(["name", "address1", "address2", "city", "state", "zip"]);
  });
});

describe("sendToOf / sendToEdited — the editor's boxes", () => {
  it("reads the six lines from a saved copy (missing ones blank)", () => {
    expect(sendToOf({ name: "A" })).toEqual({
      name: "A",
      address1: "",
      address2: "",
      city: "",
      state: "",
      zip: "",
    });
  });
  it("is edited only when a line differs from the saved copy (ignoring outer spaces)", () => {
    const boxes = sendToOf(saved);
    expect(sendToEdited(saved, boxes)).toBe(false);
    expect(sendToEdited(saved, { ...boxes, name: " Microtel Inn " })).toBe(false);
    expect(sendToEdited(saved, { ...boxes, zip: "40742" })).toBe(true);
  });
});

describe("the server and the editor", () => {
  const fns = read("src/lib/invoices.functions.ts");
  const start = fns.indexOf("export const saveInvoice");
  const save = fns.slice(start, fns.indexOf("const { data: updated, error: uErr }", start));
  it("a draft's save takes send_to and merges it over the invoice's copy", () => {
    expect(fns).toContain("send_to: z\n    .object(");
    expect(save).toContain("if (data.send_to)");
    expect(save).toContain("mergeSendTo(");
  });
  it("the raw bill_to replacement is gone (it could overwrite the Sage id)", () => {
    expect(fns).not.toContain("bill_to: z.record(z.string(), z.string()).optional(),");
    expect(save).not.toContain("if (data.bill_to) patch.bill_to = data.bill_to");
  });
  it("the draft's Send To is editable boxes with the one-invoice note; sent only when edited", () => {
    const ed = read("src/components/service/invoice-editor.tsx");
    expect(ed).toContain("Prints on this invoice only; the customer's record is not changed.");
    expect(ed).toContain("sendToEdited(inv.bill_to as Record<string, unknown>, head.send_to)");
    for (const f of ["Name", "Address", "Address line 2", "City", "State", "ZIP"])
      expect(ed).toContain(`label="${f}"`);
  });
});
