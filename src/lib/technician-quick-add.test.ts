/**
 * A technician quick-creating a customer on their ticket (the sixth audit, Oct 21; item 2). The
 * picker (components/crm/account-picker.tsx) always offered "Add … as a new customer" and
 * crm.functions.ts quickCreateAccount passed for Service access — but under
 * 20261020122000_technician_customer_fence.sql the new account (no ticket links it yet) was
 * unreadable to a technician-only token, so the ticket's save failed "Customer not found" and
 * an orphan customer stayed behind. Now: (i) AccountPicker takes `allowAdd` (default true) and
 * the ticket page passes `!isFieldOnly(profile)`; (ii) the "Change the customer" × on the ticket
 * page is hidden for a technician-only user (they work the tickets assigned to them; the office
 * owns the customer); (iii) quickCreateAccount refuses isFieldOnly callers with
 * OFFICE_ADDS_CUSTOMERS before any write. saveSite (the ticket form's "Add property" on a linked
 * customer) keeps working for them — it already passes through the fence.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));

import { OFFICE_ADDS_CUSTOMERS } from "@/lib/crm-account";
import { quickCreateAccount, saveSite } from "@/lib/crm.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const read = (p: string) => readFileSync(p, "utf8");

const TECH = "00000000-0000-4000-8000-00000000000a";
const OFFICE_TECH = "00000000-0000-4000-8000-00000000000b";
const OFFICE = "00000000-0000-4000-8000-00000000000d";
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const profiles: Row[] = [
  { id: TECH, role: "user", access: ["service"], technician: true, full_name: "Tim", email: "t@x" },
  // An office person ticked Technician keeps the office's rights (owner, Oct 8).
  {
    id: OFFICE_TECH,
    role: "user",
    access: ["service", "customers", "estimate", "pricing", "invoices", "prospect", "takeoff"],
    technician: true,
    full_name: "Olive",
    email: "o@x",
  },
  {
    id: OFFICE,
    role: "user",
    access: ["service"],
    technician: false,
    full_name: "Sam",
    email: "s@x",
  },
];

function world() {
  return fakeSupabase({
    profiles: profiles.map((p) => ({ ...p })),
    crm_accounts: [{ id: ACC, name: "Bell County Schools", deleted_at: null, kind: "company" }],
    crm_sites: [],
    crm_contacts: [],
  });
}
const call = <T>(fn: unknown, data: unknown, db: unknown, userId: string) =>
  (fn as Fn)({ data, context: { supabase: db, userId } }) as Promise<T>;
const newCustomer = { name: "New Roof Co", kind: "company", phone: "606-555-0100" };

describe("quickCreateAccount", () => {
  it("refuses a technician-only user with OFFICE_ADDS_CUSTOMERS and writes nothing", async () => {
    const env = world();
    await expect(call(quickCreateAccount, newCustomer, env.db, TECH)).rejects.toThrow(
      OFFICE_ADDS_CUSTOMERS,
    );
    expect(OFFICE_ADDS_CUSTOMERS).toBe("The office adds customers");
    expect(env.writes).toEqual([]);
    expect(env.tables["crm_accounts"]).toHaveLength(1);
  });
  it("still serves the office — a Service-only office user and an office person ticked Technician", async () => {
    for (const who of [OFFICE, OFFICE_TECH]) {
      const env = world();
      const hit = await call<Row>(quickCreateAccount, newCustomer, env.db, who);
      expect(hit["account_name"]).toBe("New Roof Co");
      expect(env.writes.map((w) => [w.table, w.op])).toEqual([["crm_accounts", "insert"]]);
    }
  });
  it("saveSite on a customer the technician's ticket links keeps working (the fence admits that customer)", async () => {
    const env = world();
    const row = await call<Row>(
      saveSite,
      { account_id: ACC, name: "Gym", address1: "1 Main St", city: "Pineville", state: "KY" },
      env.db,
      TECH,
    );
    expect(row["name"]).toBe("Gym");
    expect(env.writes.map((w) => [w.table, w.op])).toEqual([["crm_sites", "insert"]]);
  });
  it("the refusal sits before the insert, after writeAccess", () => {
    const s = read("src/lib/crm.functions.ts");
    expect(s).toMatch(
      /quickCreateAccount = createServerFn[\s\S]*?const p = await writeAccess\(context\);\s*if \(isFieldOnly\(p\)\) throw new Error\(OFFICE_ADDS_CUSTOMERS\);\s*const sb = context\.supabase;/,
    );
  });
});

describe("the picker (components/crm/account-picker.tsx)", () => {
  const picker = read("src/components/crm/account-picker.tsx");
  it("takes allowAdd (default on) and offers no add row without it", () => {
    expect(picker).toContain("allowAdd?: boolean;");
    expect(picker).toContain("const allowAdd = props.allowAdd !== false;");
    expect(picker).toContain('const addLabel = free || !allowAdd ? "" : typed.trim();');
    // The add row is still rendered only from addLabel.
    expect(picker).toMatch(/\{addLabel && \(\s*<div\s+role="option"/);
    expect(picker).toContain("as a new customer");
  });
});

describe("the ticket page (components/service-page.tsx)", () => {
  const page = read("src/components/service-page.tsx");
  it("passes allowAdd={!isFieldOnly(profile)} to its AccountPicker", () => {
    expect(page).toMatch(/import \{[^}]*\bisFieldOnly\b[^}]*\} from "@\/lib\/access";/);
    expect(page).toContain("const ownsCustomer = !isFieldOnly(profile);");
    expect(page).toMatch(/<AccountPicker\s+id="ticket-customer"[\s\S]*?allowAdd=\{ownsCustomer\}/);
  });
  it("hides the 'Change the customer' × for a technician-only user", () => {
    expect(page).toMatch(/<CustomerBlock[\s\S]*?allowChange=\{ownsCustomer\}/);
    expect(page).toContain("allowChange: boolean;");
    expect(page).toMatch(
      /\{!props\.disabled && props\.allowChange && \(\s*<Button[\s\S]*?title="Change the customer"/,
    );
    expect(page).not.toMatch(
      /\{!props\.disabled && \(\s*<Button[\s\S]{0,200}title="Change the customer"/,
    );
  });
  it("the other AccountPickers are unchanged (adding stays on for the office's forms)", () => {
    for (const f of [
      "src/components/opportunities-page.tsx",
      "src/components/tasks/task-dialog.tsx",
      "src/components/takeoff/setup-tab.tsx",
      "src/components/import-planswift-dialog.tsx",
      "src/routes/estimate.tsx",
    ])
      expect(read(f), f).not.toMatch(/<AccountPicker[^>]*allowAdd/);
  });
});
