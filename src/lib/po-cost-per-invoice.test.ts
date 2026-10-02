/**
 * Each approved purchase order counts toward exactly one invoice of its ticket (audit, Oct 2):
 * the Internal fold of every invoice on a ticket used to add the ticket's whole approved PO
 * total, so with "6000" and "6000.2" a $500 PO was $1,000 of cost. Now the ticket's earliest
 * live invoice (lowest number, the earlier made on a tie) carries it; the others show
 * "Purchase orders (approved) — counted on #6000" and add $0. The pure rule
 * (invoice-totals.ts poCostForInvoice) and the editor's wiring (invoice-editor.tsx).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as totalsLib from "@/lib/invoice-totals";
import { computeTotals, type PoCostShare, type TicketInvoiceRef } from "@/lib/invoice-totals";

type Share = (id: string, invoices: readonly TicketInvoiceRef[], total: number) => PoCostShare;
/** The helper, looked up so a missing export fails the test rather than the whole file. */
const share: Share = (id, invoices, total) => {
  const fn = (totalsLib as Record<string, unknown>)["poCostForInvoice"];
  expect(fn, "invoice-totals.ts exports poCostForInvoice").toBeTypeOf("function");
  return (fn as Share)(id, invoices, total);
};

const ref = (
  id: string,
  label: string,
  status = "final",
  created_at = "2026-10-01T10:00:00Z",
): TicketInvoiceRef => ({ id, label, status, created_at });
const A = ref("a", "6000", "sent", "2026-10-01T10:00:00Z");
const B = ref("b", "6000.2", "draft", "2026-10-01T11:00:00Z");

describe("poCostForInvoice: one invoice per ticket carries the approved PO total", () => {
  it("one invoice: the full total", () => {
    expect(share("a", [A], 500)).toEqual({ cost: 500, countedOn: null });
  });
  it("two invoices: the first gets the total; the second 0, counted on the first's number", () => {
    expect(share("a", [A, B], 500)).toEqual({ cost: 500, countedOn: null });
    expect(share("b", [A, B], 500)).toEqual({ cost: 0, countedOn: "6000" });
    // Order of the list does not matter (listTicketInvoices returns oldest first; others newest).
    expect(share("a", [B, A], 500)).toEqual({ cost: 500, countedOn: null });
    expect(share("b", [B, A], 500)).toEqual({ cost: 0, countedOn: "6000" });
  });
  it("the ticket's money is whole: across its invoices the PO total is counted exactly once", () => {
    const C = ref("c", "6000.3", "final", "2026-10-01T12:00:00Z");
    const all = [A, B, C];
    const sum = all.reduce((s, i) => s + share(i.id, all, 500).cost, 0);
    expect(sum).toBe(500);
    // The audit's case: before, each invoice's Internal cost carried the whole $500 ($1,000).
    const lines = [{ kind: "labor", qty: 1, rate: 100, cost_rate: 40, taxable: false }];
    const costs = [A, B].map((i) => computeTotals(lines, 0, share(i.id, [A, B], 500).cost));
    expect(costs.map((t) => t.po_cost)).toEqual([500, 0]);
    expect(costs.reduce((s, t) => s + t.po_cost, 0)).toBe(500);
  });
  it("a void first invoice: the next live one carries it; the void one carries nothing", () => {
    const voidA = { ...A, status: "void" };
    expect(share("b", [voidA, B], 500)).toEqual({ cost: 500, countedOn: null });
    expect(share("a", [voidA, B], 500)).toEqual({ cost: 0, countedOn: "6000.2" });
    // No live invoice left at all: nothing carries it.
    expect(share("a", [voidA], 500)).toEqual({ cost: 0, countedOn: null });
  });
  it("lowest number first, slots as integers (.10 after .9); created_at breaks a tie", () => {
    const nine = ref("n", "6000.9", "final", "2026-10-01T09:00:00Z");
    const ten = ref("t", "6000.10", "final", "2026-10-01T08:00:00Z");
    expect(share("n", [ten, nine], 80)).toEqual({ cost: 80, countedOn: null });
    expect(share("t", [ten, nine], 80)).toEqual({ cost: 0, countedOn: "6000.9" });
    // A re-used bare number made later still comes before ".2" (lowest number wins).
    const reused = ref("r", "6000", "draft", "2026-10-02T09:00:00Z");
    expect(share("r", [B, reused], 80)).toEqual({ cost: 80, countedOn: null });
    // Same label (a legacy integer and a bare display number): the earlier made.
    const legacy = ref("l", "6000", "paid", "2026-09-01T09:00:00Z");
    expect(share("r", [reused, legacy], 80)).toEqual({ cost: 0, countedOn: "6000" });
    expect(share("l", [reused, legacy], 80)).toEqual({ cost: 80, countedOn: null });
  });
  it("cents-rounded like the rest of the totals; a non-number total is 0", () => {
    expect(share("a", [A], 412.505).cost).toBe(412.51);
    expect(share("a", [A], Number.NaN).cost).toBe(0);
  });
});

describe("the editor counts the POs once (invoice-editor.tsx)", () => {
  const ed = readFileSync("src/components/service/invoice-editor.tsx", "utf8");
  const hook = ed.slice(ed.indexOf("function useApprovedPoCost("), ed.indexOf("function Totals("));
  const totals = ed.slice(ed.indexOf("function Totals("), ed.indexOf("// ---- Final / sent"));
  it("the hook reads the ticket's invoices (the ticket page's cache) and asks the helper", () => {
    expect(ed).toMatch(/import \{[^}]*\bpoCostForInvoice\b[^}]*\} from "@\/lib\/invoice-totals";/);
    expect(hook).toContain("queryKey: ticketInvoicesKey(jobId),");
    expect(hook).toContain("invoicesFn({ data: { job_id: jobId } })");
    expect(hook).toContain(
      "poCostForInvoice(invoiceId, invoices.data, approvedPoTotal(q.data.pos))",
    );
    // Until both lists are in, nothing is added (never the whole total "for now").
    expect(hook).toContain("if (!q.data || !invoices.data)");
    expect(hook).not.toContain("approvedPoTotal(q.data?.pos ?? [])");
  });
  it("the draft and the final invoice both pass their own id", () => {
    const calls = ed.match(/useApprovedPoCost\([^)]*\)/g) ?? [];
    expect(calls.filter((c) => !c.includes("jobId: string"))).toEqual([
      "useApprovedPoCost(job.id, inv.id)",
      "useApprovedPoCost(job.id, inv.id)",
    ]);
    expect(ed).not.toContain("useApprovedPoCost(job.id)");
    expect(ed).toMatch(
      /<Totals\s+t=\{t\}\s+taxPct=\{head\.tax_pct\}\s+poError=\{po\.error\}\s+poCountedOn=\{po\.countedOn\}\s+\/>/,
    );
    expect(ed).toMatch(
      /<Totals\s+t=\{stored\}\s+taxPct=\{toPct\(inv\.tax_rate\)\}\s+poError=\{po\.error\}\s+poCountedOn=\{po\.countedOn\}\s+\/>/,
    );
  });
  it('the Internal fold says "— counted on #6000" on the other invoices', () => {
    const line = totals.indexOf("Purchase orders (approved)");
    expect(line).toBeGreaterThan(totals.indexOf("{open && ("));
    expect(totals).toContain('{poCountedOn ? ` — counted on #${poCountedOn}` : ""}');
    expect(totals).toContain("money(t.po_cost)");
    // Above the fold (what a sales / PM sees): no PO, no "counted on".
    expect(totals.slice(totals.indexOf("return ("), totals.indexOf("{internal && ("))).not.toMatch(
      /purchase|po_cost|counted on/i,
    );
  });
});
