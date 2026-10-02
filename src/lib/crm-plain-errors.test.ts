/**
 * Audit, Oct 2, item 4: the vendor, site and contact validators called zod's .parse, so a bad
 * field toasted zod's JSON dump ("[ { "code": "invalid_string", … } ]"). Every validator in
 * crm.functions.ts and vendors.functions.ts now goes through parseInput: one plain sentence for
 * the first problem ("Email looks wrong", "Name is too long (200 max)"). The inputs that had no
 * maxLength have one.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { saveContact, saveSite, searchAccounts } from "@/lib/crm.functions";
import { saveVendor } from "@/lib/vendors.functions";
import { parseInput, accountSchema } from "@/lib/crm-account";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let env: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  env = fakeSupabase({
    profiles: [{ id: MGR, role: "manager", access: [], full_name: "Mo", email: "mo@x.co" }],
    crm_accounts: [{ id: ACC, name: "Acme", phone: "555", deleted_at: null }],
    vendors: [],
  });
});
// The validator runs before the handler (it may throw at once): always a promise here.
const call = (fn: unknown, data: Row) =>
  Promise.resolve().then(() =>
    (fn as (a: { data: Row; context: unknown }) => Promise<Row>)({
      data,
      context: { supabase: env.db, userId: MGR },
    }),
  );
const plain = async (p: Promise<unknown>, message: string) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x as Error,
  );
  expect(e).toBeInstanceOf(Error);
  expect(e!.message).toBe(message);
  expect(e!.message).not.toMatch(/^\s*\[/);
  expect(e!.message).not.toContain('"code"');
};

describe("server validators answer in one plain sentence", () => {
  it("vendor email a@b.c → 'Email looks wrong' (not zod's JSON); nothing written", async () => {
    await plain(call(saveVendor, { name: "ABC Supply", email: "a@b.c" }), "Email looks wrong");
    expect(env.writes).toEqual([]);
  });
  it("a 201-character site name → 'Name is too long (200 max)'", async () => {
    await plain(
      call(saveSite, { account_id: ACC, name: "x".repeat(201) }),
      "Name is too long (200 max)",
    );
    expect(env.writes).toEqual([]);
  });
  it("a contact: a missing name, a too-long position, a bad customer id", async () => {
    await plain(call(saveContact, { account_id: ACC, name: " " }), "Name is required");
    await plain(
      call(saveContact, { account_id: ACC, name: "Al", position: "p".repeat(201) }),
      "Position is too long (200 max)",
    );
    await plain(call(saveContact, { account_id: "nope", name: "Al" }), "The customer looks wrong");
  });
  it("the search box: too long", async () => {
    await plain(call(searchAccounts, { q: "q".repeat(121) }), "The search is too long (120 max)");
  });
  it("only the first problem, and a schema's own words win (Add an email or a phone number)", () => {
    expect(() => parseInput(accountSchema, { name: "A" })).toThrow(
      new Error("Add an email or a phone number"),
    );
    expect(() =>
      parseInput(accountSchema, { name: "", phone: "1", notes: "n".repeat(5001) }),
    ).toThrow(new Error("Name is required"));
    expect(() =>
      parseInput(accountSchema, { name: "A", phone: "1", notes: "n".repeat(5001) }),
    ).toThrow(new Error("Notes is too long (5000 max)"));
  });
});

describe("every validator in crm.functions.ts and vendors.functions.ts goes through parseInput", () => {
  for (const file of ["src/lib/crm.functions.ts", "src/lib/vendors.functions.ts"]) {
    it(file, () => {
      const src = readFileSync(file, "utf8");
      const validators = src.match(/\.validator\(\(d: unknown\) =>\s*\S+/g) ?? [];
      expect(validators.length).toBeGreaterThan(3);
      for (const v of validators) expect(v).toMatch(/=>\s*parseInput\(/);
      expect(src).not.toMatch(/\.parse\(d/);
    });
  }
});

describe("the inputs carry a maxLength", () => {
  const inputs = (src: string) => src.match(/<(Input|Textarea)\b[\s\S]*?\/>/g) ?? [];
  const page = readFileSync("src/components/customers-page.tsx", "utf8");
  const slice = (from: string, to: string) => page.slice(page.indexOf(from), page.indexOf(to));
  it("the account form, the contact form and the site form", () => {
    // The site form lives in crm/site-form.tsx since Oct 2 (shared with the opportunity).
    const siteForm = readFileSync("src/components/crm/site-form.tsx", "utf8");
    for (const part of [
      slice("function AccountForm(", "// ---- Contacts"),
      slice("function ContactForm(", "function SitesSection("),
      siteForm.slice(siteForm.indexOf("export function SiteForm(")),
    ]) {
      const list = inputs(part);
      expect(list.length).toBeGreaterThan(3);
      for (const el of list) expect(el).toContain("maxLength=");
    }
  });
  it("the new-customer dialog and the shared address block", () => {
    const picker = readFileSync("src/components/crm/account-picker.tsx", "utf8");
    const dialog = picker.slice(picker.indexOf("export function QuickAddCustomerDialog("));
    for (const el of inputs(dialog)) expect(el).toContain("maxLength=");
    const fields = readFileSync("src/components/crm/account-fields.tsx", "utf8");
    const address = fields.slice(
      fields.indexOf("export function AddressInputs("),
      fields.indexOf("export function MailingAddressInputs("),
    );
    expect(inputs(address)).toHaveLength(5);
    for (const el of inputs(address)) expect(el).toContain("maxLength=");
  });
});
