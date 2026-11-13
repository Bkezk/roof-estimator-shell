/**
 * Owner, Nov 13: "if moving the timers to the database itself helps and doesn't negatively effect
 * things then yes go for it". GitHub ran the reminders job about twice a day instead of twice an
 * hour. The database now keeps the time and makes the call, signed with a token it made itself.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateCron } from "./cron-auth";
import { TIMER_TOKEN_SHAPE, timerTokenOf } from "./cron-timer";

const TIMER = `dbt_${"ab12".repeat(16)}`;
const req = (token?: string) =>
  new Request("https://app.test/api/cron/reminders", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const saved = { own: process.env["CRON_SECRET"], lov: process.env["LOVABLE_CRON_SECRET"] };
afterEach(() => {
  if (saved.own === undefined) delete process.env["CRON_SECRET"];
  else process.env["CRON_SECRET"] = saved.own;
  if (saved.lov === undefined) delete process.env["LOVABLE_CRON_SECRET"];
  else process.env["LOVABLE_CRON_SECRET"] = saved.lov;
  vi.restoreAllMocks();
});
const ownerOnly = () => {
  process.env["CRON_SECRET"] = "owner-secret-value";
  delete process.env["LOVABLE_CRON_SECRET"];
};

describe("what the timer's token looks like", () => {
  it("dbt_ and 64 hex digits, nothing else", () => {
    expect(TIMER_TOKEN_SHAPE.test(TIMER)).toBe(true);
    for (const bad of ["", "dbt_", `dbt_${"a".repeat(63)}`, `dbt_${"a".repeat(65)}`])
      expect(TIMER_TOKEN_SHAPE.test(bad)).toBe(false);
    expect(TIMER_TOKEN_SHAPE.test(`dbt_${"G".repeat(64)}`)).toBe(false);
    expect(TIMER_TOKEN_SHAPE.test(`xdbt_${"a".repeat(64)}`)).toBe(false);
    expect(TIMER_TOKEN_SHAPE.test("owner-secret-value")).toBe(false);
  });
  it("is read from the Authorization header only when it has that shape", () => {
    expect(timerTokenOf(req(TIMER))).toBe(TIMER);
    expect(timerTokenOf(req("owner-secret-value"))).toBeNull();
    expect(timerTokenOf(req())).toBeNull();
    expect(
      timerTokenOf(new Request("https://app.test/x", { headers: { authorization: TIMER } })),
    ).toBeNull();
  });
});

describe("the reminders endpoint lets the database's timer in", () => {
  it("a token the database says is its own is allowed", async () => {
    ownerOnly();
    const timer = vi.fn(async () => true);
    expect(await authenticateCron(req(TIMER), { timer })).toBeNull();
    expect(timer).toHaveBeenCalledWith(TIMER);
  });
  it("a token the database does not know is refused, as before", async () => {
    ownerOnly();
    const timer = vi.fn(async () => false);
    expect((await authenticateCron(req(TIMER), { timer }))?.status).toBe(401);
  });
  it("a check that cannot run is a refusal, never a crash and never a way in", async () => {
    ownerOnly();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const timer = vi.fn(async () => {
      throw new Error("database unreachable");
    });
    expect((await authenticateCron(req(TIMER), { timer }))?.status).toBe(401);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
  it("the database is asked only about tokens of the timer's shape", async () => {
    ownerOnly();
    const timer = vi.fn(async () => true);
    expect((await authenticateCron(req("nope"), { timer }))?.status).toBe(401);
    expect((await authenticateCron(req(), { timer }))?.status).toBe(401);
    expect(timer).not.toHaveBeenCalled();
  });
  it("the owner's secret and Lovable's still work on that endpoint", async () => {
    process.env["CRON_SECRET"] = "owner-secret-value";
    process.env["LOVABLE_CRON_SECRET"] = "lovable-value";
    const timer = vi.fn(async () => false);
    expect(await authenticateCron(req("owner-secret-value"), { timer })).toBeNull();
    expect(await authenticateCron(req("lovable-value"), { timer })).toBeNull();
    expect(timer).not.toHaveBeenCalled();
  });
});

describe("no other scheduled endpoint takes the timer's token", () => {
  it("without the route asking for it, the token is just a wrong secret", async () => {
    ownerOnly();
    expect((await authenticateCron(req(TIMER)))?.status).toBe(401);
  });
  it("only the reminders route asks for it", () => {
    expect(readFileSync("src/routes/api.cron.reminders.ts", "utf8")).toContain(
      "authenticateCron(request, { timer: databaseTimerCheck })",
    );
    for (const f of [
      "src/routes/api.cron.leads.ts",
      "src/routes/api.cron.storms.ts",
      "src/lib/leads-import.server.ts",
    ]) {
      const text = readFileSync(f, "utf8");
      expect(text).toContain("authenticateCron(request)");
      expect(text).not.toContain("databaseTimerCheck");
    }
  });
  it("the check asks the database as the server and takes only a plain yes", () => {
    const text = readFileSync("src/lib/cron-timer.server.ts", "utf8");
    expect(text).toContain('supabaseAdmin.rpc("cron_timer_ok", { p_token: token })');
    expect(text).toContain("return data === true;");
    expect(readFileSync("src/integrations/supabase/types.ts", "utf8")).toContain(
      "cron_timer_ok: { Args: { p_token: string }; Returns: boolean }",
    );
  });
});

describe("the database side (supabase/migrations/20261113190000_reminder_timer.sql)", () => {
  const sql = readFileSync("supabase/migrations/20261113190000_reminder_timer.sql", "utf8");
  const code = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  it("the token is made in the database from random bytes and kept in the vault", () => {
    expect(code).toContain("'dbt_' || encode(extensions.gen_random_bytes(32), 'hex')");
    expect(code).toContain("vault.create_secret(");
    expect(code).toContain(
      "if not exists (select 1 from vault.secrets where name = 'reminder_timer_token')",
    );
  });
  it("no token and no other secret is written in the file", () => {
    expect(code).not.toMatch(/dbt_[0-9a-f]{8,}/);
    expect(code).not.toMatch(/CRON_SECRET|service_role_key|sb_secret_|eyJ/i);
  });
  it("only the server may ask whether a token is the timer's", () => {
    expect(code).toContain("coalesce(auth.role(), '') = 'service_role'");
    expect(code).toContain(
      "revoke all on function public.cron_timer_ok(text) from public, anon, authenticated;",
    );
    expect(code).toContain("grant execute on function public.cron_timer_ok(text) to service_role;");
  });
  it("the token goes to one address, written in the function, and nobody else may send it", () => {
    expect(code.match(/https?:\/\/[^'\s]+/g)).toEqual([
      "https://jbkbid.lovable.app/api/cron/reminders",
    ]);
    expect(code).toContain("create or replace function maint.reminder_timer()\n");
    expect(code).toContain(
      "revoke all on function maint.reminder_timer() from public, anon, authenticated, service_role;",
    );
  });
  it("twice an hour in the hours GitHub's job had, five minutes ahead of it", () => {
    expect(code).toContain(
      "select cron.schedule('reminder-timer', '2,32 12-23 * * *', $$select maint.reminder_timer()$$);",
    );
    const yml = readFileSync(".github/workflows/reminders.yml", "utf8");
    expect(yml).toContain('- cron: "7,37 12-23 * * *"');
  });
  it("the timer tidies its own run log", () => {
    expect(code).toContain("'reminder-timer-tidy'");
    expect(code).toContain(
      "delete from cron.job_run_details where end_time < now() - interval '14 days'",
    );
  });
});
