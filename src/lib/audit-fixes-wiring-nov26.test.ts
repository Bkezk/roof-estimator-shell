/**
 * The pieces that join the audit's fix streams (Nov 26, 2026; the audit of Nov 25, owner: "go on
 * 1, 2, 3 ...").
 *
 *   - A card payment page opened before a roof size was corrected asked for the old price. The
 *     correction closes the plan's open pages first; ending a plan closes them after.
 *   - A plan year paid online from a bank account said "Paid by card online" on the plan.
 *   - The sign-up window said "Could not sign them up" of a plan that was signed and only could
 *     not be read back.
 *
 * None of these pass on the code before: the server never asked for a page to be closed, the
 * plan's row never said how it was paid online, and the window had one sentence for every error.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CARE_SIGNED_NOT_READ } from "@/lib/public-requests";
import { cardPaidWords } from "@/lib/roof-care-checkout";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\s+/g, " ");
const server = read("src/lib/roof-care-plan.functions.ts");
/** The text of one server function, from its name to the next one. */
const fn = (name: string) => {
  const from = server.indexOf(`export const ${name} = createServerFn`);
  expect(from, name).toBeGreaterThan(-1);
  const to = server.indexOf("export const ", from + 20);
  return server.slice(from, to === -1 ? undefined : to);
};

describe("open card payment pages are closed when the amount or the plan changes", () => {
  it("a corrected size closes the pages before the price changes", () => {
    const body = fn("correctRoofCareSize");
    const close = body.indexOf("await closeCardPages(sb, data.plan_id)");
    const save = body.indexOf('"roof_care_correct_size"');
    expect(close).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(-1);
    expect(close).toBeLessThan(save);
    // Only a manager or an admin gets this far.
    expect(body.indexOf("await sizeManager(context)")).toBeLessThan(close);
  });
  it("an ended plan's pages are closed once it has ended, not before", () => {
    const body = fn("endRoofCarePlan");
    const end = body.indexOf('"roof_care_end_refund"');
    const refused = body.indexOf("if (error) throw new Error(error.message)", end);
    const close = body.indexOf("await closeCardPages(context.supabase, data.plan_id)");
    expect(end).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(refused);
  });
  it("closing never stops the correction or the end", () => {
    const from = server.indexOf("async function closeCardPages(");
    expect(from).toBeGreaterThan(-1);
    const body = server.slice(from, server.indexOf("export class PlanSignedNotRead", from));
    expect(body).toContain("try {");
    expect(body).toContain("expirePlanCardPages(await serverClient(sb), planId)");
    expect(body).toContain("catch (e)");
    expect(body).not.toContain("throw ");
  });
});

describe("how a plan year was paid online", () => {
  it("the plan's row says when it was from a bank account", () => {
    expect(server).toContain(
      '.select("id, size_changes, size_paid_price, size_refunds, paid_by_bank")',
    );
    expect(server).toContain("if (r.paid_by_bank === true) byBank.add(r.id);");
    expect(server).toContain("bank: byBank.has(p.id),");
  });
  it("and the plan card's words follow it", () => {
    const paid = { on: "2026-11-26", amount: 321, ref: "pi_made_up" };
    expect(cardPaidWords({ ...paid, bank: true })).toMatch(/^Paid from a bank account online /);
    expect(cardPaidWords({ ...paid, bank: false })).toMatch(/^Paid by card online /);
    expect(cardPaidWords(paid)).toMatch(/^Paid by card online /);
  });
});

describe("the sign-up window and a plan that is signed", () => {
  const card = read("src/components/roof-care/plan-card.tsx");
  it('a plan that was signed is not reported as "Could not sign them up"', () => {
    const signed = card.indexOf("if (message.includes(CARE_SIGNED_NOT_READ))");
    const could = card.indexOf("toast.error(`Could not sign them up: ${message}`");
    expect(signed).toBeGreaterThan(-1);
    expect(could).toBeGreaterThan(signed);
    const between = card.slice(signed, could);
    expect(between).toContain("toast.warning(CARE_SIGNED_NOT_READ");
    expect(between).toContain("onClose();");
    expect(between).toContain("return;");
  });
  it("the sentence says the plan is signed", () => {
    expect(CARE_SIGNED_NOT_READ).toMatch(/^The plan is signed\./);
  });
});
