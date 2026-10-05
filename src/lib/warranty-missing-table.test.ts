/**
 * Owner, Oct 5: "Could not find the table 'public.site_warranties' in the schema cache" blanked
 * the page before 20261005160000_site_warranties.sql was applied. Until the table exists, a
 * site's warranties read as none (no badge, nothing to list); saving one says which migration
 * is missing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        (a: { data: unknown; context: unknown }) =>
          h({ data: validate(a.data), context: a.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { listSiteWarranties, saveSiteWarranty } from "@/lib/warranties.functions";
import { isMissingTable, WARRANTIES_NOT_SET_UP } from "@/lib/warranty";

const MISSING = {
  code: "PGRST205",
  message: "Could not find the table 'public.site_warranties' in the schema cache",
};
/** A client whose every site_warranties query answers `result`. */
const ctx = (result: { data: unknown; error: unknown }) => {
  const q: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "insert", "update", "delete"]) q[k] = () => q;
  q["maybeSingle"] = async () => result;
  q["then"] = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return { supabase: { from: () => q }, userId: "u1" };
};
const SITE = "e46a5e92-c512-4b62-a6a7-9fd4c565412e";
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe("before the migration", () => {
  it("knows PostgREST's missing table", () => {
    expect(isMissingTable(MISSING)).toBe(true);
    expect(isMissingTable({ message: "permission denied" })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
  it("a site's warranties read as none instead of an error", async () => {
    const r = await (listSiteWarranties as unknown as Fn)({
      data: { site_id: SITE },
      context: ctx({ data: null, error: MISSING }),
    });
    expect(r).toEqual([]);
  });
  it("any other error is still thrown", async () => {
    await expect(
      (listSiteWarranties as unknown as Fn)({
        data: { site_id: SITE },
        context: ctx({ data: null, error: { message: "permission denied" } }),
      }),
    ).rejects.toThrow("permission denied");
  });
  it("saving says which migration is missing", async () => {
    expect(WARRANTIES_NOT_SET_UP).toContain("20261005160000_site_warranties.sql");
    await expect(
      (saveSiteWarranty as unknown as Fn)({
        data: {
          site_id: SITE,
          manufacturer: "Duro-Last",
          kind: null,
          number: null,
          start_date: null,
          end_date: null,
          notes: null,
        },
        context: ctx({ data: null, error: MISSING }),
      }),
    ).rejects.toThrow(WARRANTIES_NOT_SET_UP);
  });
});
