/**
 * "Sent by" on the Invoices list (owner, Oct 8, after CenterPoint's Invoices list, which has a
 * SENT BY column): sending an invoice records who sent it (invoices.sent_by_name, migration
 * 20261008120000_invoice_sent_by.sql), and the list's Sent column shows the date and the name.
 *
 * The email goes out before the invoice row is stamped, so a database that does not have the
 * column yet must not turn a sent email into an error: the stamp is written without the name.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stampSent } from "@/lib/invoice-sent";

const read = (p: string) => readFileSync(p, "utf8");

type Err = { code?: string; message: string } | null;
function fakeWrite(firstError: Err) {
  const patches: Record<string, unknown>[] = [];
  const write = async (patch: Record<string, unknown>) => {
    patches.push(patch);
    return patches.length === 1 && firstError
      ? { data: null, error: firstError }
      : { data: { id: "inv", ...patch }, error: null };
  };
  return { write, patches };
}

const base = { status: "sent", sent_at: "2026-10-08T15:00:00.000Z", sent_to: ["ap@acme.example"] };

describe("stampSent — who sent the invoice", () => {
  it("writes the sender's name with the sent stamp", async () => {
    const f = fakeWrite(null);
    const r = await stampSent(f.write, base, "RoAnna Sims");
    expect(f.patches).toEqual([{ ...base, sent_by_name: "RoAnna Sims" }]);
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ status: "sent", sent_by_name: "RoAnna Sims" });
  });
  it("before the migration (no sent_by_name column): stamps it sent without the name", async () => {
    for (const err of [
      { code: "PGRST204", message: "Could not find the 'sent_by_name' column of 'invoices'" },
      { code: "42703", message: 'column "sent_by_name" of relation "invoices" does not exist' },
    ]) {
      const f = fakeWrite(err);
      const r = await stampSent(f.write, base, "RoAnna Sims");
      expect(f.patches).toEqual([{ ...base, sent_by_name: "RoAnna Sims" }, base]);
      expect(r.error).toBeNull();
      expect(r.data).toMatchObject({ status: "sent" });
    }
  });
  it("any other error is returned as it is, with no second write", async () => {
    const f = fakeWrite({ code: "42501", message: "permission denied for table invoices" });
    const r = await stampSent(f.write, base, "RoAnna Sims");
    expect(f.patches).toHaveLength(1);
    expect(r.error?.message).toBe("permission denied for table invoices");
  });
});

describe("sendInvoice and the list use it", () => {
  it("sendInvoice stamps through stampSent with the sender's name", () => {
    const fns = read("src/lib/invoices.functions.ts");
    const send = fns.slice(
      fns.indexOf("export const sendInvoice"),
      fns.indexOf("export const markInvoicePaid"),
    );
    expect(send).toContain("await stampSent(");
    expect(send).toContain("nameOf(p),");
    expect(send).not.toContain('.update({\n        status: b.invoice.status === "paid"');
  });
  it("the Sent column shows the date and, under it, who sent it", () => {
    const page = read("src/components/service/invoices-page.tsx");
    expect(page).toContain('{r.sent_by_name ? `by ${r.sent_by_name}` : ""}');
  });
  it("the migration adds the column idempotently", () => {
    const sql = read("supabase/migrations/20261008120000_invoice_sent_by.sql");
    expect(sql).toContain("alter table public.invoices add column if not exists sent_by_name text");
  });
});
