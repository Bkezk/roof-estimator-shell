/**
 * Admin "Set password" (owner, Oct 13): the sign-in page has no "Forgot password" and only the
 * user's own Account page changes a password, so an admin sets one from Admin › Users & access
 * — for a restored account (passwords are in no backup) or anyone locked out. The real server
 * function runs against the in-memory stand-in; the page is pinned on its text.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const updateUserById = vi.fn(async (_id: string, _attrs: { password: string }) => ({
  data: {},
  error: null,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { auth: { admin: { updateUserById } } },
}));

import { setUserPassword } from "@/lib/auth.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const ADMIN = "11111111-1111-4111-8111-111111111111";
const TECH = "22222222-2222-4222-8222-222222222222";
type Fn = (a: { data: unknown; context: unknown }) => Promise<{ id: string }>;
const call = async (db: unknown, userId: string, data: unknown) =>
  (setUserPassword as unknown as Fn)({ data, context: { supabase: db, userId } });

beforeEach(() => updateUserById.mockClear());

describe("setUserPassword", () => {
  const tables = () => ({
    profiles: [
      { id: ADMIN, email: "owner@jbk.com", role: "admin" },
      { id: TECH, email: "tech@jbk.com", role: "user" },
    ],
  });
  it("an admin sets another user's password through the service-role auth admin API", async () => {
    const { db, writes } = fakeSupabase(tables());
    const r = await call(db, ADMIN, { id: TECH, password: "Welcome-Back-9" });
    expect(r).toEqual({ id: TECH });
    expect(updateUserById).toHaveBeenCalledWith(TECH, { password: "Welcome-Back-9" });
    expect(writes).toHaveLength(0); // nothing in the database changes, no audit row carries the password
  });
  it("refuses a non-admin, an unknown user, and a short password, touching auth not at all", async () => {
    const { db } = fakeSupabase(tables());
    await expect(call(db, TECH, { id: ADMIN, password: "Welcome-Back-9" })).rejects.toThrow(
      "Forbidden: admin access required",
    );
    await expect(
      call(db, ADMIN, { id: "33333333-3333-4333-8333-333333333333", password: "Welcome-Back-9" }),
    ).rejects.toThrow("User not found");
    await expect(call(db, ADMIN, { id: TECH, password: "short" })).rejects.toThrow("at least 8");
    expect(updateUserById).not.toHaveBeenCalled();
  });
  it("never logs the password", () => {
    const src = read("./auth.functions.ts");
    const body = src.slice(
      src.indexOf("export const setUserPassword"),
      src.indexOf("const deleteUserSchema"),
    );
    expect(body).toContain("await assertAdmin(context.supabase, context.userId)");
    expect(body).toContain("auth.admin.updateUserById(data.id");
    expect(body).not.toMatch(/console\.|audit|insert\(/);
  });
});

describe("Admin › Users & access", () => {
  const page = read("../routes/admin.users.tsx");
  it("has a Set password action per user: a dialog with password + confirm, min 8, toast 'Password set for <name>'", () => {
    expect(page).toContain("setUserPassword");
    expect(page).toContain("function SetPasswordDialog(");
    expect(page).toContain("<DialogTitle>Set password for {name}</DialogTitle>");
    expect(page).toContain('id="set-password-confirm"');
    expect(page).toContain('? "At least 8 characters"');
    expect(page).toContain('? "The two passwords differ"');
    expect(page).toContain(
      'toast.success(`Password set for ${u ? u.full_name || u.email : "the user"}`)',
    );
    expect(page).toContain("aria-label={`Set password for ${u.full_name || u.email}`}");
    expect(page).toContain("onClick={() => setPasswordFor(u)}");
    expect(page).toContain("passwordMut.mutate({ id, password })");
  });
});
