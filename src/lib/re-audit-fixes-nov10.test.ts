/**
 * The fixes the owner chose from the Nov 10 re-audit (docs/qa/re-audit-invoices-bids-documents-
 * 2026-11-10.md): "fix 1, 2, 3 … fix 5, 6, 7, 8, 9".
 *
 *  1. A $0 amount takes a recorded payment off (it read "Partly paid $0.00", no Mark paid, no Void).
 *  2. An amount above the total is asked about before it is recorded.
 *  3. A ticket with a live invoice is not deleted.
 *  5. An inspection's "Outcome: Bid" follows its bids: cleared when the last one is deleted,
 *     recorded again when one is restored.
 *  6. A deleted ticket is not shown as a bid's inspection.
 *  7. The server asks for the office or a manager before linking a bid to an inspection.
 *  8. A bid still carrying its old customer's automatic name is renamed when the customer changes.
 *  9. A copy of a bid carries the inspection it was started from.
 *
 * Every test here is red on the code before these fixes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      validator: (v: (d: unknown) => unknown) => {
        validate = v;
        return b;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) =>
        (arg: { data: unknown; context: unknown }) =>
          h({ data: validate(arg.data), context: arg.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/bid-locks.functions", () => ({ liveLockHeldElsewhere: vi.fn(async () => null) }));
// The server client falls back to the caller's client (no service role in tests).
vi.mock("@/lib/notify.server", () => ({ serverClient: async (c: unknown) => c }));

import { isCustomerBidName } from "@/lib/bid-name";
import { duplicateBidRow } from "@/lib/duplicate-bid";
import { clearsPayment, hasPayment, overpaidBy, paidStatusFor } from "@/lib/invoice-payment";
import {
  linkBidToInspection,
  syncInspectionOutcomeAfterBidChange,
} from "@/lib/service-inspection.functions";
import { ticketDeleteProblem } from "@/lib/ticket-delete-rule";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

// ── 1 + 2: the payment ─────────────────────────────────────────────────────────────────────
describe("1. a $0 amount takes the payment off", () => {
  it("clears on an invoice with a total; a $0 invoice is still paid by $0", () => {
    expect(clearsPayment(625, 0)).toBe(true);
    expect(clearsPayment("625.00", 0)).toBe(true);
    expect(clearsPayment(625, 0.01)).toBe(false);
    expect(clearsPayment(625, 500)).toBe(false);
    expect(clearsPayment(0, 0)).toBe(false);
    expect(paidStatusFor(0, 0)).toBe("paid");
  });
  it("the cleared invoice has no payment on record, so Mark paid and Void come back", () => {
    // What the server writes for $0 (below): amount 0 and no day.
    expect(hasPayment({ paid_amount: 0, paid_on: null })).toBe(false);
    // What the old code left behind: amount 0 WITH the day — still "a payment".
    expect(hasPayment({ paid_amount: 0, paid_on: "2026-11-10" })).toBe(true);
  });
  it("markInvoicePaid writes the cleared row for $0 and the payment row otherwise", () => {
    const fn = flat(read("src/lib/invoices.functions.ts"));
    expect(fn).toContain("const off = clearsPayment(cur.total, data.amount);");
    expect(fn).toContain(
      'off ? { status: "final", paid_on: null, paid_amount: 0, paid_method: null, paid_ref: null, updated_by_name: nameOf(p), }',
    );
    expect(fn).toContain(
      ": { status: paidStatusFor(cur.total, data.amount), paid_on: data.paid_on,",
    );
  });
  it("the dialog says how, names the button, and the toast says it is Final again", () => {
    const ed = flat(read("src/components/service/invoice-editor.tsx"));
    expect(ed).toContain('{again ? " To take this payment off, set the amount to 0." : ""}');
    expect(ed).toContain("const takesOff = again && clearsPayment(inv.total, amount);");
    expect(ed).toContain('data-note="takes-off"');
    expect(ed).toContain('? "Take the payment off"');
    expect(ed).toContain(
      ": !hasPayment(r.invoice) ? `Payment taken off invoice #${invoiceLabel(r.invoice)}; it is Final again with ${money(balanceDue(r.invoice))} due`",
    );
  });
});

describe("2. an overpayment is asked about first", () => {
  it("overpaidBy is the amount over the total, a cent forgiven", () => {
    expect(overpaidBy(625, 700)).toBe(75);
    expect(overpaidBy("625.00", 625.004)).toBe(0);
    expect(overpaidBy(625, 625)).toBe(0);
    expect(overpaidBy(625, 500)).toBe(0);
    expect(overpaidBy(625, 625.01)).toBe(0.01);
  });
  it("the first press shows the question; a changed amount asks again; the second press saves", () => {
    const ed = flat(read("src/components/service/invoice-editor.tsx"));
    expect(ed).toContain("const over = overpaidBy(inv.total, amount);");
    expect(ed).toContain("if (over > 0 && !overAsked) { setOverAsked(true); return; }");
    expect(ed).toContain("onChange={(v) => { setAmount(v); setOverAsked(false); }}");
    expect(ed).toContain('data-note="overpayment"');
    expect(ed).toContain("more than the invoice total of {money(inv.total)}");
    expect(ed).toContain('{overAsked && over > 0 ? "Record it anyway"');
    // The question comes before the save in submit().
    expect(ed.indexOf("if (over > 0 && !overAsked)")).toBeLessThan(
      ed.indexOf("props.onSave({ paid_on: paidOn, amount, method, ref });"),
    );
  });
});

// ── 3: the ticket ──────────────────────────────────────────────────────────────────────────
describe("3. a ticket with a live invoice is not deleted", () => {
  const inv = (status: string, label: string, paid_amount = 0, paid_on: string | null = null) => ({
    status,
    label,
    paid_amount,
    paid_on,
  });
  it("no invoice, or only void ones: it can be deleted", () => {
    expect(ticketDeleteProblem(6009, [])).toBeNull();
    expect(ticketDeleteProblem(6009, [inv("void", "6009")])).toBeNull();
  });
  it("says which invoice and what to do first, in plain words", () => {
    expect(ticketDeleteProblem(6024, [inv("draft", "6024")])).toBe(
      "Ticket #6024 has invoice #6024, so it cannot be deleted. Delete the draft from the ticket's Invoice card first.",
    );
    expect(ticketDeleteProblem(6010, [inv("final", "6010")])).toBe(
      "Ticket #6010 has invoice #6010, so it cannot be deleted. Void it first, then delete the ticket.",
    );
    expect(
      ticketDeleteProblem(6009, [
        inv("final", "6009"),
        inv("void", "6009.3"),
        inv("final", "6009.2"),
      ]),
    ).toBe(
      "Ticket #6009 has 2 invoices (#6009, #6009.2), so it cannot be deleted. Void them first, then delete the ticket.",
    );
    expect(ticketDeleteProblem(6000, [inv("paid", "6000", 7.96, "2026-10-07")])).toBe(
      "Ticket #6000 has invoice #6000, so it cannot be deleted. Take the payment off (Edit payment, amount 0), void the invoice, then delete the ticket.",
    );
    // A partial payment on a final invoice needs the same.
    expect(ticketDeleteProblem(6063, [inv("final", "6063", 500, "2026-11-10")])).toContain(
      "Take the payment off",
    );
  });
  it("deleteServiceJob asks before it stamps deleted_at", () => {
    const fn = flat(read("src/lib/service.functions.ts"));
    const start = fn.indexOf("export const deleteServiceJob");
    const body = fn.slice(start, fn.indexOf("export const", start + 10));
    expect(body).toContain('.eq("service_job_id", data.id) .neq("status", "void")');
    expect(body).toContain("if (problem) throw new Error(problem);");
    expect(body.indexOf("if (problem) throw new Error(problem);")).toBeLessThan(
      body.indexOf("deleted_at: new Date().toISOString()"),
    );
  });
});

// ── 5 + 7: the inspection side, against a recording fake database ─────────────────────────────
type Row = Record<string, unknown>;
function fakeDb(o: {
  job?: Row | null;
  liveBids?: Row[];
  repair?: Row | null;
  profile?: Row;
  bid?: Row | null;
}) {
  const calls: string[] = [];
  const from = (table: string) => {
    const st = { op: "select", filters: [] as string[], patch: null as unknown };
    const one = () => {
      if (table === "profiles")
        return (
          o.profile ?? {
            role: "admin",
            access: ["service", "estimate"],
            technician: false,
            full_name: "Olive Office",
            email: "o@x",
          }
        );
      if (table === "service_jobs")
        // The repair-ticket lookup filters by from_job_id; the ticket read filters by id.
        return st.filters.some((f) => f.startsWith("from_job_id="))
          ? (o.repair ?? null)
          : (o.job ?? null);
      if (table === "bids") return o.bid ?? null;
      return null;
    };
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => (st.filters.push(`${k}=${String(v)}`), q),
      is: (k: string, v: unknown) => (st.filters.push(`${k} is ${String(v)}`), q),
      order: () => q,
      limit: () => q,
      update: (patch: unknown) => ((st.op = "update"), (st.patch = patch), q),
      insert: (row: unknown) => {
        calls.push(`${table}.insert ${JSON.stringify(row)}`);
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: () => Promise.resolve({ data: one(), error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        if (st.op === "update") calls.push(`${table}.update ${JSON.stringify(st.patch)}`);
        const data = table === "bids" && st.op === "select" ? (o.liveBids ?? []) : null;
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return q;
  };
  return { ctx: { supabase: { from }, userId: "u1" } as never, calls };
}
const INSPECTION = {
  id: "j1",
  service_type: "inspection",
  stage: "done",
  deleted_at: null,
  inspection_outcome: "bid",
};

describe("5. the inspection's outcome follows its bids", () => {
  it("the last linked bid is deleted: the outcome is cleared and the timeline says why", async () => {
    const { ctx, calls } = fakeDb({ job: INSPECTION, liveBids: [] });
    await syncInspectionOutcomeAfterBidChange(ctx, "j1", { bidName: "Option A", deleted: true });
    const upd = calls.find((c) => c.startsWith("service_jobs.update"))!;
    expect(JSON.parse(upd.slice("service_jobs.update ".length))).toMatchObject({
      inspection_outcome: null,
      inspection_outcome_at: null,
      inspection_outcome_by: null,
    });
    expect(calls.find((c) => c.startsWith("service_job_events.insert"))).toContain(
      'Bid \\"Option A\\" was deleted — this inspection has no bid now',
    );
  });
  it("a repair ticket also came of the inspection: the outcome falls back to it", async () => {
    const { ctx, calls } = fakeDb({
      job: INSPECTION,
      liveBids: [],
      repair: { id: "r1", number: 6070 },
    });
    await syncInspectionOutcomeAfterBidChange(ctx, "j1", { bidName: "Option A", deleted: true });
    expect(calls.find((c) => c.startsWith("service_jobs.update"))).toContain(
      '"inspection_outcome":"repair_ticket"',
    );
  });
  it("another live bid is left, or the outcome was not Bid: nothing is written", async () => {
    for (const o of [
      { job: INSPECTION, liveBids: [{ id: "b2" }] },
      { job: { ...INSPECTION, inspection_outcome: "none" }, liveBids: [] },
      { job: { ...INSPECTION, deleted_at: "2026-11-10T00:00:00Z" }, liveBids: [] },
      { job: { ...INSPECTION, service_type: "repair" }, liveBids: [] },
      { job: null, liveBids: [] },
    ]) {
      const { ctx, calls } = fakeDb(o);
      await syncInspectionOutcomeAfterBidChange(ctx, "j1", { bidName: "Option A", deleted: true });
      expect(calls).toEqual([]);
    }
  });
  it("a bid is restored and the inspection has no outcome: Bid is recorded again", async () => {
    const { ctx, calls } = fakeDb({
      job: { ...INSPECTION, inspection_outcome: null },
      liveBids: [{ id: "b1" }],
    });
    await syncInspectionOutcomeAfterBidChange(ctx, "j1", { bidName: "Option A", deleted: false });
    expect(calls.find((c) => c.startsWith("service_jobs.update"))).toContain(
      '"inspection_outcome":"bid"',
    );
    expect(calls.find((c) => c.startsWith("service_job_events.insert"))).toContain(
      'Bid \\"Option A\\" was restored — started from this inspection',
    );
  });
  it("a restore does not override a choice made since (No action needed)", async () => {
    const { ctx, calls } = fakeDb({
      job: { ...INSPECTION, inspection_outcome: "none" },
      liveBids: [{ id: "b1" }],
    });
    await syncInspectionOutcomeAfterBidChange(ctx, "j1", { bidName: "Option A", deleted: false });
    expect(calls).toEqual([]);
  });
  it("deleteBid and restoreBid call it for a bid that has an inspection", () => {
    const fn = flat(read("src/lib/bids.functions.ts"));
    expect(fn).toContain(
      "if (gone.from_job_id) await syncInspectionOutcomeAfterBidChange(context, gone.from_job_id, { bidName: gone.name, deleted: true, });",
    );
    expect(fn).toContain(
      "if (back.from_job_id) await syncInspectionOutcomeAfterBidChange(context, back.from_job_id, { bidName: back.name, deleted: false, });",
    );
  });
});

describe("6. a deleted ticket is not a bid's inspection", () => {
  it("getSourceInspection leaves a deleted ticket out", () => {
    const fn = flat(read("src/lib/service-inspection.functions.ts"));
    const start = fn.indexOf("export const getSourceInspection");
    const body = fn.slice(
      start,
      fn.indexOf("export async function syncInspectionOutcomeAfterBidChange"),
    );
    expect(body).toContain('.eq("id", data.id) .is("deleted_at", null) .maybeSingle();');
  });
});

describe("7. the server asks for the office or a manager", () => {
  const IDS = {
    inspectionId: "0f0e0d0c-0b0a-4908-8706-050403020100",
    bidId: "1f0e0d0c-0b0a-4908-8706-050403020100",
  };
  const call = (ctx: unknown) =>
    (
      linkBidToInspection as unknown as (a: { data: unknown; context: unknown }) => Promise<unknown>
    )({ data: IDS, context: ctx });
  // Estimate and Customers but not Service: the old check (Service OR Customers) let this
  // person through, though they cannot open a ticket and so never see the Create bid button.
  it("someone with Estimate and Customers access but not Service is refused; nothing is written", async () => {
    const { ctx, calls } = fakeDb({
      profile: {
        role: "user",
        access: ["customers", "estimate"],
        technician: false,
        full_name: "Sam Sales",
        email: "s@x",
      },
      job: { ...INSPECTION, number: 6058 },
      bid: { id: "b1", name: "Bid", from_job_id: null, deleted_at: null },
    });
    await expect(call(ctx)).rejects.toThrow(
      "Only the office or a manager starts a bid from an inspection",
    );
    expect(calls).toEqual([]);
  });
  it("the office with Service access still links", async () => {
    const { ctx, calls } = fakeDb({
      profile: {
        role: "user",
        access: ["service", "estimate"],
        technician: false,
        full_name: "Olive Office",
        email: "o@x",
      },
      job: { ...INSPECTION, number: 6058, inspection_outcome: null },
      bid: { id: "b1", name: "Bid", from_job_id: "j1", deleted_at: null },
    });
    await expect(call(ctx)).resolves.toEqual({ linked: true });
    expect(calls).toEqual([]);
  });
  it("the check comes before any read of the ticket or the bid", () => {
    const fn = flat(read("src/lib/service-inspection.functions.ts"));
    const body = fn.slice(fn.indexOf("export const linkBidToInspection"));
    expect(body.indexOf("if (!dispatchesTickets(p))")).toBeGreaterThan(-1);
    expect(body.indexOf("if (!dispatchesTickets(p))")).toBeLessThan(
      body.indexOf('.from("service_jobs")'),
    );
  });
});

// ── 8 + 9: the bid side ────────────────────────────────────────────────────────────────────
describe("8. the automatic name follows a changed customer", () => {
  it("isCustomerBidName: the customer's name, or with (n) — nothing else", () => {
    expect(isCustomerBidName("Acme Roofing", "Acme Roofing")).toBe(true);
    expect(isCustomerBidName("acme  roofing (1)", "Acme Roofing")).toBe(true);
    expect(isCustomerBidName("Acme Roofing (12)", "Acme Roofing")).toBe(true);
    expect(isCustomerBidName("Acme Roofing (copy)", "Acme Roofing")).toBe(false);
    expect(isCustomerBidName("Acme Roofing 2026", "Acme Roofing")).toBe(false);
    expect(isCustomerBidName("Acme Roofing (1) east wing", "Acme Roofing")).toBe(false);
    expect(isCustomerBidName("Gym reroof", "Acme Roofing")).toBe(false);
    expect(isCustomerBidName("Acme Roofing", "")).toBe(false);
    expect(isCustomerBidName("", "Acme Roofing")).toBe(false);
    expect(isCustomerBidName("Acme Roofing", null)).toBe(false);
  });
  it("saveBid renames only when the customer changed and the name was the old customer's", () => {
    const fn = flat(read("src/lib/bids.functions.ts"));
    expect(fn).toContain(
      "if (data.accountId && cur.account_id && data.accountId !== cur.account_id) {",
    );
    expect(fn).toContain(
      "if (isCustomerBidName(name, old?.name)) renamed = await nameAfterCustomer(context.supabase, data);",
    );
    expect(fn).toContain("...(renamed ? { name: renamed } : {}),");
    // The estimator already adopts whatever name the saved row carries (bid-name.test.ts).
  });
});

describe("9. a copy carries the inspection", () => {
  const source = {
    name: "Option A",
    data: {},
    grand_total: 100,
    account_id: "a1",
    site_id: null,
    building_id: null,
    roof_id: null,
    folder: null,
    from_job_id: "j1",
  };
  it("duplicateBidRow copies from_job_id; the takeoff and opportunity links still are not copied", () => {
    const row = duplicateBidRow(source, "Olive Office", "2026-11-10T00:00:00Z", null, "2026-12-01");
    expect(row.from_job_id).toBe("j1");
    expect(row.opportunity_id).toBeNull();
    expect(row.takeoff_id).toBeNull();
    expect(row.name).toBe("Option A (copy)");
  });
  it("a bid with no inspection copies as none", () => {
    expect(
      duplicateBidRow({ ...source, from_job_id: null }, null, "2026-11-10T00:00:00Z").from_job_id,
    ).toBeNull();
    const { from_job_id: _drop, ...bare } = source;
    expect(duplicateBidRow(bare, null, "2026-11-10T00:00:00Z").from_job_id).toBeNull();
  });
});
