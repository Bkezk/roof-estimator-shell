/**
 * Inventory › Reconcile, the managers' card (owner, Oct 9: "a menu for managers/admins on the
 * inventory tab so they can go in and manually reconcile things rather than just an email"):
 * getReconciliation's gate and output through the fake database (the week parameter, the paged
 * ledger read), the card's pins — week picker, the Counted box + Set count that records an
 * `adjustment` through addMovement, who sees the box, no Dismiss — and that the dropped email
 * path (cron route, workflow) is really gone.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { canAccess, seesEveryone } from "@/lib/access";
import { getReconciliation, readAllMovements } from "@/lib/inventory-reconcile.functions";
import type { Reconciliation } from "@/lib/inventory-reconcile";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JOB = "11111111-1111-4111-8111-111111111111";

const move = (id: number, over: Record<string, unknown>) => ({
  id,
  location_id: "shop",
  screen_id: "duro_last:sealants",
  row_label: "Duro-Caulk Plus",
  price_col: "White",
  qty: -1,
  unit: "tube",
  reason: "consumed",
  service_job_id: null,
  service_job_name: null,
  note: null,
  created_by_name: "Joe",
  created_at: "2026-10-07T14:00:00Z",
  ...over,
});

function world(movements?: Record<string, unknown>[], maxRows?: number) {
  return fakeSupabase(
    {
      profiles: [
        { id: ADMIN, role: "admin", access: [], full_name: "Ann", email: "ann@example.com" },
        { id: MGR, role: "manager", access: [], full_name: "Mo", email: "mo@example.com" },
        { id: USER, role: "user", access: ["estimate"], full_name: "Est", email: "e@example.com" },
      ],
      inventory_locations: [
        { id: "shop", name: "Shop", kind: "shop", sort: 0, active: true },
        { id: "truck-1", name: "Truck 1", kind: "vehicle", sort: 1, active: false },
      ],
      inventory_movements: movements ?? [
        move(1, {
          qty: -2,
          service_job_id: JOB,
          service_job_name: "#6001 Smith",
          note: "Short: the app had 0 tube on the shelf; count needs fixing",
        }),
        move(2, { location_id: "truck-1", qty: 3, reason: "transfer_in" }),
        move(3, { location_id: "truck-1", qty: -4, created_at: "2026-09-30T14:00:00Z" }),
      ],
    },
    maxRows ? { maxRows } : {},
  );
}

const call = (env: ReturnType<typeof fakeSupabase>, userId: string, data?: unknown) =>
  (
    getReconciliation as unknown as (a: {
      data: unknown;
      context: unknown;
    }) => Promise<Reconciliation>
  )({ data, context: { supabase: env.db, userId } });

describe("getReconciliation (server)", () => {
  it("a plain user is refused, even one with Estimate access", async () => {
    await expect(call(world(), USER)).rejects.toThrow("Forbidden: admins and managers only");
  });

  it("admins and managers get the picked week: negatives (current state), the week's short entries, retired locations named", async () => {
    for (const who of [ADMIN, MGR]) {
      const r = await call(world(), who, { weekStart: "2026-10-05" });
      expect(r.weekStart).toBe("2026-10-05");
      expect(r.weekLabel).toBe("Oct 5 – Oct 11");
      expect(r.negatives.map((n) => [n.location_name, n.on_hand])).toEqual([
        ["Shop", -2],
        ["Truck 1", -1],
      ]);
      expect(r.negatives[0]!.contributors[0]).toMatchObject({
        service_job_id: JOB,
        service_job_name: "#6001 Smith",
        by_name: "Joe",
        short: true,
      });
      expect(r.shortEntries).toHaveLength(1);
      expect(r.fixed).toEqual([]);
    }
  });

  it("another week keeps the negatives and drops the short entry; any day of a week picks that week", async () => {
    const r = await call(world(), ADMIN, { weekStart: "2026-10-01" });
    expect(r.weekStart).toBe("2026-09-28");
    expect(r.negatives).toHaveLength(2);
    expect(r.shortEntries).toEqual([]);
  });

  it("no week = this week; a malformed week is refused", async () => {
    const r = await call(world(), ADMIN);
    expect(r.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The validator runs before the handler, so the refusal is immediate.
    expect(() => call(world(), ADMIN, { weekStart: "Oct 5" })).toThrow();
  });

  it("reads the ledger whole past PostgREST's 1,000-row page", async () => {
    const rows = [];
    for (let i = 0; i < 1005; i++)
      rows.push(
        move(i + 1, {
          qty: i < 1000 ? 1 : -201,
          created_at: new Date(1700000000000 + i * 1000).toISOString(),
        }),
      );
    const env = world(rows, 1000);
    expect(await readAllMovements(env.db)).toHaveLength(1005);
    const r = await call(env, ADMIN, { weekStart: "2026-10-05" });
    // 1000 × +1 and 5 × −201 = −5: visible only when the second page is read.
    expect(r.negatives.map((n) => n.on_hand)).toEqual([-5]);
  });
});

describe("who may Set count (addMovement's own rule, not widened)", () => {
  it("an adjustment needs Estimate access or admin; a manager passes canAccess, a technician does not", () => {
    const src = read("src/lib/inventory.functions.ts");
    expect(src).toContain(
      'throw new Error("Only an estimator can adjust counts or write stock off");',
    );
    expect(canAccess({ role: "admin", access: [] }, "estimate")).toBe(true);
    expect(canAccess({ role: "manager", access: [] }, "estimate")).toBe(true);
    expect(canAccess({ role: "user", access: ["service"], technician: true }, "estimate")).toBe(
      false,
    );
    // The card itself is for admins and managers only.
    expect(seesEveryone({ role: "user", access: ["estimate"] })).toBe(false);
  });
});

describe("the Inventory page's Reconcile card", () => {
  const c = read("src/components/inventory-page.tsx");

  it("is shown to seesEveryone only, with the Set count gate from canAccess(estimate)", () => {
    expect(c).toContain(
      '{seesEveryone(profile) && <ReconcileCard canSetCount={canAccess(profile, "estimate")} />}',
    );
    expect(c).toContain('import { canAccess, seesEveryone } from "@/lib/access";');
    expect(c).toContain('<Card data-card="reconcile">');
    expect(c).toContain('<Scale className="h-4 w-4" /> Reconcile');
  });

  it("has a week picker (previous / next, next capped at this week) feeding getReconciliation({ weekStart })", () => {
    expect(c).toContain('queryKey: ["inventory-reconcile", weekStart]');
    expect(c).toContain("queryFn: () => fn({ data: { weekStart } })");
    expect(c).toContain('<div className="flex flex-wrap items-center gap-2" data-week-picker>');
    expect(c).toContain('aria-label="Previous week"');
    expect(c).toContain("onClick={() => setWeekStart((w) => shiftWeek(w, -1))}");
    expect(c).toContain('aria-label="Next week"');
    expect(c).toContain("disabled={weekStart >= thisWeek}");
    expect(c).toContain("onClick={() => setWeekStart((w) => shiftWeek(w, 1))}");
    expect(c).toContain("useState(() => weekStartOf(new Date()))");
  });

  it("each negative cell has a blank Counted box (decimal, in the cell's unit) and Set count → addMovement with reconcileAdjustment's payload", () => {
    const row = c.slice(c.indexOf("function NegativeRow("), c.indexOf("function SettingsCard("));
    expect(row).toContain("const addFn = useServerFn(addMovement);");
    expect(row).toContain("const payload = touched ? reconcileAdjustment(n, counted) : null;");
    expect(row).toContain("await addFn({ data: payload });");
    expect(row).toContain("<NumberField");
    expect(row).toContain('inputMode="decimal"');
    expect(row).toContain('step="any"');
    expect(row).toContain("Counted ({n.unit})");
    expect(row).toContain("{props.canSetCount && (");
    expect(row).toContain("disabled={!payload || busy}");
    expect(row).toContain("Set count");
    // After it answers: the toast names the new count; every stock view refreshes.
    expect(row).toContain(
      "toast.success(`${n.location_name} · ${n.name} set to ${fmtQty(counted)} ${n.unit}`);",
    );
    expect(c).toContain('void qc.invalidateQueries({ queryKey: ["inventory-reconcile"] });');
    expect(c).toContain('void qc.invalidateQueries({ queryKey: ["inventory-stock"] });');
    expect(c).toContain('void qc.invalidateQueries({ queryKey: ["inventory-movements"] });');
    // A failed call shows loudly.
    expect(row).toContain(
      'toast.error(e instanceof Error ? e.message : "Could not set the count", {',
    );
    // Those who may not set a count see the list and a line to ask an admin.
    expect(c).toContain("Ask an admin to set the count.");
  });

  it("no Dismiss: the only way off the list is a corrected count", () => {
    const card = c.slice(c.indexOf("function ReconcileCard("), c.indexOf("function SettingsCard("));
    expect(card).not.toMatch(/dismiss/i);
    expect(c.replace(/\s+\*?\s*/g, " ")).toContain(
      "there is no dismiss — the only way off the list is a corrected count",
    );
  });

  it("lists the week's short entries (when, place, item, qty, who, ticket link, note), the fixes and the clean line", () => {
    expect(c).toContain("Short entries this week");
    expect(c).toContain("search={{ id: s.service_job_id }}");
    expect(c).toContain("search={{ id: c.service_job_id }}");
    expect(c).toContain('{s.note && <div className="pl-4 text-xs">{s.note}</div>}');
    expect(c).toContain("Fixed this week");
    expect(c).toContain('<p className="text-muted-foreground">{CLEAN_LINE}</p>');
    expect(c).toContain("{n.more > 0 && <li>+{n.more} more</li>}");
  });
});

describe("the email path is gone (owner, Oct 9: 'i dont really want another email')", () => {
  it("no cron route, no workflow, no server pass, nothing in the route tree", () => {
    expect(existsSync("src/routes/api.cron.reconcile.ts")).toBe(false);
    expect(existsSync(".github/workflows/reconcile.yml")).toBe(false);
    expect(existsSync("src/lib/inventory-reconcile.server.ts")).toBe(false);
    expect(read("src/routeTree.gen.ts")).not.toContain("/api/cron/reconcile");
    expect(read("src/lib/inventory-reconcile.ts")).not.toContain("reconciliationEmail");
  });
});
