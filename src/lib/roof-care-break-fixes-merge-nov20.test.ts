/**
 * Roof Care break test, Nov 20: what joining the three sets of fixes added.
 *
 *  - A plan priced on a roof size typed by hand, where the map had none to check it against,
 *    is on the Needs attention list until a manager or an admin confirms the size (number 4).
 *  - Merging a customer moves its Roof Care plans with its properties. Before, the plans kept
 *    naming the customer that was merged away, and the new rule that holds a customer with a
 *    plan refused the merge.
 *  - The note on an inspection ticket taken off the board at a renewal says "the renewal was
 *    reduced for it" only when something was taken off the renewal.
 *
 * The dollar figures here are made up and match no plan price.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ATTENTION_DEFAULTS, attentionList } from "@/lib/owner-attention";
import { SIZE_CONFIRM_LABEL, SIZE_UNCHECKED_WORDS } from "@/lib/roof-care-plan";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const MIGRATION = "supabase/migrations/20261120730000_roof_care_merge_and_renewal_note.sql";

const base = {
  today: "2026-11-25",
  now: "2026-11-25T15:00:00Z",
  limits: ATTENTION_DEFAULTS,
  tickets: [],
  untouched: [],
  opps: [],
  bids: [],
  invoices: [],
  followups: [],
  repairFrom: [],
  bidFrom: [],
  names: {},
};

describe("a roof size nobody checked is on the Needs attention list", () => {
  it("says the size, why it matters and who confirms it, and opens the property", () => {
    const list = attentionList({
      ...base,
      careSizes: [
        {
          plan_id: "p1",
          site_id: "s1",
          title: "Roof Care · Main Plant (Acme)",
          roof_sqft: 48250,
          signed_on: "2026-11-20",
        },
      ],
    });
    const row = list.rows.find((r) => r.kind === "care_plan_size")!;
    expect(row.key).toBe("care_plan_size:p1");
    expect(row.group).toBe("office");
    expect(row.tag).toBe("Roof Care");
    expect(row.title).toBe("Roof Care · Main Plant (Acme)");
    expect(row.why).toBe(
      `${SIZE_UNCHECKED_WORDS}: 48,250 sq ft. The plan's price follows the size. A manager or an admin opens the property, checks the size and presses ${SIZE_CONFIRM_LABEL}.`,
    );
    expect(row.age).toBe(5);
    expect(row.tone).toBe("amber");
    expect(row.amount).toBeNull();
    expect(row.href).toBe("/properties/s1");
  });
  it("turns red after two weeks, and a list with none has no such row", () => {
    const old = attentionList({
      ...base,
      careSizes: [
        { plan_id: "p1", site_id: "s1", title: "t", roof_sqft: 20000, signed_on: "2026-11-01" },
      ],
    });
    expect(old.rows.find((r) => r.kind === "care_plan_size")!.tone).toBe("red");
    expect(attentionList(base).rows.some((r) => r.kind === "care_plan_size")).toBe(false);
  });
  it("the server lists plans in force or waiting whose size is marked unchecked", () => {
    const fn = flat(read("src/lib/owner-attention.functions.ts"));
    expect(fn).toContain(
      "const sizes: AttCareSize[] = live .filter((p) => p.size?.unchecked) .map((p) => ({",
    );
    expect(fn).toContain("careSizes: care.sizes,");
    // `live` is every plan that has not ended: in force and awaiting payment.
    expect(fn).toContain('const live = all.filter((p) => p.status !== "ended");');
  });
});

describe("merging a customer takes its Roof Care plans along", () => {
  const sql = read(MIGRATION);
  const fn = sql.slice(
    sql.indexOf("create or replace function public.merge_accounts("),
    sql.indexOf("revoke all on function public.merge_accounts("),
  );
  it("the plans move before the merged customer is deleted", () => {
    const move = "update public.roof_care_plans set account_id = p_keep where account_id = p_drop;";
    expect(fn).toContain(move);
    expect(fn.indexOf(move)).toBeGreaterThan(-1);
    expect(fn.indexOf(move)).toBeLessThan(fn.indexOf("merged_into = p_keep"));
    // The properties move too, as before.
    expect(fn).toContain(
      "update public.crm_sites set account_id = p_keep where account_id = p_drop;",
    );
  });
  it("is still an admin's alone, and nobody signed out can call it", () => {
    expect(fn).toContain("if not public.is_admin() then");
    expect(sql).toContain(
      "revoke all on function public.merge_accounts(uuid, uuid) from public, anon;",
    );
  });
  it("every table with an account_id is moved (the list on Nov 20)", () => {
    for (const t of [
      "crm_sites",
      "crm_contacts",
      "service_jobs",
      "bids",
      "crm_opportunities",
      "tasks",
      "takeoffs",
      "documents",
      "crm_followups",
      "roof_care_plans",
    ])
      expect(fn).toContain(`update public.${t} set account_id = p_keep`);
  });
});

describe("the note on a ticket taken off the board at a renewal", () => {
  const sql = read(MIGRATION);
  it("says the renewal was reduced only when it was", () => {
    expect(flat(sql)).toContain(
      "'Taken off the board: the plan was renewed with this inspection not done' || case when coalesce(v_p.renewal_credit, 0) > 0 then ', and the renewal was reduced for it.' else '.' end,",
    );
    expect(sql).not.toContain("inspection not done, and the renewal was reduced for it.',");
  });
  it("the start function keeps its rights: the server's own key only", () => {
    expect(sql).toContain(
      "revoke all on function public.roof_care_start(uuid, date) from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.roof_care_start(uuid, date) to service_role;",
    );
  });
});
