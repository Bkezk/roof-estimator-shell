/**
 * Audit, Oct 2, item 6: adding a vendor whose name matched an ARCHIVED vendor said "X is already
 * a vendor" — and X was nowhere in the list (archived ones are hidden). The message now says
 * "X is an archived vendor — restore it instead of adding a new one", and the Vendors tab offers
 * that restore.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { saveVendor } from "@/lib/vendors.functions";
import * as vendors from "@/lib/vendors";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const V1 = "f1111111-1111-4111-8111-111111111111";
const V2 = "f2222222-2222-4222-8222-222222222222";
const ARCHIVED = "ABC Supply is an archived vendor — restore it instead of adding a new one";

let env: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  env = fakeSupabase({
    profiles: [{ id: MGR, role: "manager", access: [], full_name: "Mo", email: "mo@x.co" }],
    vendors: [
      { id: V1, name: "ABC Supply", archived_at: "2026-09-01T00:00:00Z" },
      { id: V2, name: "84 Lumber", archived_at: null },
    ],
  });
});
const call = (data: Row) =>
  (saveVendor as unknown as (a: { data: Row; context: unknown }) => Promise<Row>)({
    data,
    context: { supabase: env.db, userId: MGR },
  });

describe("saveVendor: a name clash names an archived vendor as archived", () => {
  it("a new vendor named like an archived one (any case / spacing) → the archived message; nothing written", async () => {
    await expect(call({ name: "  abc   supply " })).rejects.toThrow(new Error(ARCHIVED));
    expect(env.writes).toEqual([]);
  });
  it("a live one still reads 'already a vendor'", async () => {
    await expect(call({ name: "84 lumber" })).rejects.toThrow(
      new Error("84 Lumber is already a vendor"),
    );
  });
  it("renaming a vendor to its own name is no clash", async () => {
    await call({ id: V2, name: "84 Lumber", billable: false });
    expect(env.tables["vendors"]!.find((v) => v["id"] === V2)!["billable"]).toBe(false);
  });
});

describe("vendorNameClash (pure)", () => {
  const list = [
    { id: V1, name: "ABC Supply", archived_at: "2026-09-01T00:00:00Z" },
    { id: V2, name: "84 Lumber", archived_at: null },
  ];
  it("archived / live / self / none", () => {
    expect(vendors.vendorNameClash(list, "abc supply")).toEqual({
      vendor: list[0],
      message: ARCHIVED,
    });
    expect(vendors.vendorNameClash(list, "84 LUMBER")?.message).toBe(
      "84 Lumber is already a vendor",
    );
    expect(vendors.vendorNameClash(list, "84 Lumber", V2)).toBeNull();
    expect(vendors.vendorNameClash(list, "New Co")).toBeNull();
    expect(vendors.vendorNameClash(list, "  ")).toBeNull();
  });
});

describe("the Vendors tab offers the restore", () => {
  const tab = readFileSync("src/components/crm/vendors-section.tsx", "utf8");
  it("reads archived vendors too, finds the clash, and shows a Restore button for it", () => {
    expect(tab).toContain("const everyVendor = useVendors(true).data ?? [];");
    expect(tab).toContain("vendorNameClash(everyVendor, draft.name, vendor?.id)");
    expect(tab).toContain("const archivedClash = clash?.vendor.archived_at ? clash : null;");
    expect(tab).toMatch(/onClick=\{\(\) => restoreClash\.mutate\(archivedClash\.vendor\.id\)\}/);
    expect(tab).toContain("Restore {archivedClash.vendor.name}");
    expect(tab).toContain("mutationFn: (id: string) => restoreFn({ data: { id } }),");
  });
});
