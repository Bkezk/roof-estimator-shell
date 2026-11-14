/**
 * Security audit, Nov 14. Owner: "go with the sign out all devices button per person" and
 * "go with the technician fix pls".
 *
 * 1. Users & access has a "Sign out all devices" button for each person. Admin only; the
 *    database ends the person's sign-ins and only the server's key may ask it to.
 * 2. A technician reads a ticket's notes and time entries only with the ticket.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SIGN_OUT_ALL_LABEL,
  signOutAllConfirm,
  signOutAllDone,
  signOutAllTitle,
} from "./sign-out-everywhere";

describe("the words", () => {
  it("the button is named for the person", () => {
    expect(SIGN_OUT_ALL_LABEL).toBe("Sign out all devices");
    expect(signOutAllTitle("Pat Doe")).toBe("Sign out all devices for Pat Doe");
  });
  it("the question says what happens and is honest about the hour", () => {
    expect(signOutAllConfirm("Pat Doe", false)).toBe(
      "Sign Pat Doe out of every phone and computer? They will have to sign in again. A device that is open right now can keep working for up to an hour.",
    );
  });
  it("asks differently when it is yourself", () => {
    expect(signOutAllConfirm("Me", true)).toBe(
      "Sign yourself out of every phone and computer, this one included? You will have to sign in again. A device that is open right now can keep working for up to an hour.",
    );
  });
  it("the answer counts the devices and never says 'at once'", () => {
    expect(signOutAllDone("Pat Doe", 0)).toBe("Pat Doe was not signed in anywhere.");
    expect(signOutAllDone("Pat Doe", 1)).toBe(
      "Pat Doe is signed out of 1 device. It stops working within the hour.",
    );
    expect(signOutAllDone("Pat Doe", 4)).toBe(
      "Pat Doe is signed out of 4 devices. They stop working within the hour.",
    );
    for (const n of [0, 1, 4]) expect(signOutAllDone("x", n)).not.toMatch(/at once|immediately/);
  });
});

describe("the server function", () => {
  const src = readFileSync("src/lib/auth.functions.ts", "utf8");
  const fn = src.slice(
    src.indexOf("export const signOutUserEverywhere"),
    src.indexOf("/** A technician (or anyone with Service access)"),
  );
  it("exists and needs a sign-in", () => {
    expect(fn).toContain(".middleware([requireSupabaseAuth])");
    expect(fn).toContain(".validator((data) => signOutEverywhereSchema.parse(data))");
  });
  it("checks the caller is an admin before anything else", () => {
    const admin = fn.indexOf("await assertAdmin(context.supabase, context.userId);");
    expect(admin).toBeGreaterThan(0);
    expect(admin).toBeLessThan(fn.indexOf("await admin()"));
    expect(admin).toBeLessThan(fn.indexOf('.rpc("sign_out_everywhere"'));
  });
  it("refuses a person who is not on the list", () => {
    expect(fn).toContain('if (!target) throw new Error("User not found");');
  });
  it("asks the database through the server's key and reports how many sign-ins ended", () => {
    expect(fn).toContain('supabaseAdmin.rpc("sign_out_everywhere", {');
    expect(fn).toContain('devices: typeof ended === "number" ? ended : 0');
  });
});

describe("the database function", () => {
  const sql = readFileSync("supabase/migrations/20261114210000_sign_out_everywhere.sql", "utf8");
  it("ends the person's sign-ins and counts them", () => {
    expect(sql).toContain("delete from auth.sessions where user_id = p_user;");
    expect(sql).toContain("get diagnostics n = row_count;");
  });
  it("only the server's key may run it, said twice", () => {
    expect(sql).toContain("if auth.role() is distinct from 'service_role' then");
    expect(sql).toContain(
      "revoke all on function public.sign_out_everywhere(uuid) from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.sign_out_everywhere(uuid) to service_role;",
    );
  });
  it("is in the hand-kept types", () => {
    expect(readFileSync("src/integrations/supabase/types.ts", "utf8")).toContain(
      "      sign_out_everywhere: { Args: { p_user: string }; Returns: number }\n",
    );
  });
});

describe("the button on Users & access", () => {
  const page = readFileSync("src/routes/admin.users.tsx", "utf8");
  it("is on every person's row, between Set password and Remove", () => {
    const key = page.indexOf('<KeyRound className="h-4 w-4" />');
    const out = page.indexOf('data-action="sign-out-everywhere"');
    const bin = page.indexOf('<Trash2 className="h-4 w-4 text-destructive" />');
    expect(key).toBeGreaterThan(0);
    expect(out).toBeGreaterThan(key);
    expect(bin).toBeGreaterThan(out);
  });
  it("asks first, and may be used on yourself", () => {
    expect(page).toContain("if (confirm(signOutAllConfirm(u.full_name || u.email, isSelf))) {");
    expect(page).toContain("signOutMut.mutate(u.id);");
    const button = page.slice(page.indexOf('data-action="sign-out-everywhere"')).slice(0, 400);
    expect(button).toContain("disabled={signOutMut.isPending}");
    expect(button).not.toContain("isSelf ||");
  });
  it("has a name a screen reader can say", () => {
    expect(page).toContain("aria-label={signOutAllTitle(u.full_name || u.email)}");
  });
  it("says how many devices were signed out", () => {
    expect(page).toContain(
      'toast.success(signOutAllDone(u ? u.full_name || u.email : "The user", r.devices));',
    );
  });
});

describe("a technician reads notes and hours only with the ticket", () => {
  const sql = readFileSync(
    "supabase/migrations/20261114200000_ticket_notes_with_the_ticket.sql",
    "utf8",
  );
  const rule = (table: string) =>
    sql.slice(sql.indexOf(`alter policy "${table}_read"`)).split(";\n")[0]!;
  it.each([
    ["service_job_events", "by_user = (select auth.uid())"],
    ["service_time_entries", "technician_id = (select auth.uid())"],
  ])("%s: office as before, a technician by the ticket or their own rows", (table, own) => {
    const r = rule(table);
    expect(r).toContain("(select public.has_access('customers'))");
    expect(r).toContain("(select public.has_access('service'))");
    expect(r).toContain("not (select public.is_technician())");
    expect(r).toContain(own);
    expect(r).toContain(`where j.id = ${table}.service_job_id`);
    expect(r).toContain("and j.deleted_at is null");
    expect(r).toContain("and (j.technician_id = (select auth.uid()) or public.is_on_crew(j.id))");
  });
  it("only the two read rules change: who may write is untouched", () => {
    expect(sql.match(/alter policy/g)).toHaveLength(2);
    expect(sql).not.toMatch(/create policy|drop policy|with check/);
  });
});
