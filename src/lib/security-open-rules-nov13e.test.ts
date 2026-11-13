/**
 * Two access rules that let too many people through (owner, Nov 13, after Lovable's security
 * check: "yes techinicians shouldnt see those pricing number and fix the push notifications
 * button").
 *
 *   1. service_settings_read was `using (true)`: a technician's token read the material markup
 *      and the tax rate. Now an admin, a manager or an invoicer.
 *   2. push_subscriptions_dispatch_update let anyone with Customers, Service or Estimate access
 *      rewrite any person's device row. The policy is gone; the sender stamps through
 *      push_subscription_mark, which changes "sent" and "gone" and nothing else.
 *
 * The SQL was run on a local PostgreSQL as each kind of user (the record has the output); here
 * the migration's text and the sender's code are pinned.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return holder.db;
  },
}));
const pushMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ ok: boolean; gone: boolean; status: number; error?: string }> => ({
    ok: true,
    gone: false,
    status: 201,
  })),
);
vi.mock("@/lib/webpush", () => ({
  generateVapidKeys: async () => ({ publicKey: "pub", privateKey: "priv" }),
  sendWebPush: pushMock,
}));

import { notify, type Client } from "@/lib/notify.server";
import { bareHelperCalls, policyStatements } from "@/lib/rls-check-once";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

const DIR = "supabase/migrations";
const FILE = "20261113140000_service_settings_read_and_push_mark.sql";
const raw = existsSync(`${DIR}/${FILE}`) ? readFileSync(`${DIR}/${FILE}`, "utf8") : "";
const sql = raw.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("20261113140000: service settings are a manager's and an invoicer's to read", () => {
  it("the read rule names the three roles, each checked once per query", () => {
    expect(sql).toContain(
      "drop policy if exists service_settings_read on public.service_settings;",
    );
    expect(sql).toContain(
      "create policy service_settings_read on public.service_settings for select to authenticated using ( (select public.is_admin()) or (select public.is_manager()) or (select public.is_sales_pm()) );",
    );
    for (const p of policyStatements(raw)) expect(bareHelperCalls(p)).toEqual([]);
  });
  it("no migration from this one on writes a rule that lets everyone through", () => {
    const later = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql") && f >= FILE)
      .sort();
    expect(later).toContain(FILE);
    for (const f of later) {
      const text = readFileSync(`${DIR}/${f}`, "utf8").replace(/--[^\n]*/g, "");
      expect(text, f).not.toMatch(/(using|with check)\s*\(\s*\(?\s*(select\s+)?true\s*\)?\s*\)/i);
    }
  });
  it("every reader of the row in the app is behind a manager's or an invoicer's check", () => {
    const materials = readFileSync("src/lib/service-materials.functions.ts", "utf8");
    const at = materials.indexOf('.from("service_settings")');
    expect(at).toBeGreaterThan(-1);
    const fn = materials.slice(materials.lastIndexOf("createServerFn", at), at);
    expect(fn).toContain("await pricingManager(context);");
    const invoices = readFileSync("src/lib/invoices.functions.ts", "utf8");
    expect(invoices).toContain("if (!seesInvoices(data)) throw new Error(");
  });
});

describe("20261113140000: the notice sender stamps a device, it does not edit it", () => {
  it("the open update rule is dropped and none replaces it", () => {
    expect(sql).toContain(
      "drop policy if exists push_subscriptions_dispatch_update on public.push_subscriptions;",
    );
    expect(sql).not.toMatch(/create policy \w+ on public\.push_subscriptions/);
  });
  it("push_subscription_mark sets last_used_at or failed_at and no other column", () => {
    const at = sql.indexOf("create or replace function public.push_subscription_mark(");
    const fn = sql.slice(at, sql.indexOf("$$;", at));
    expect(fn).toContain("(p_id bigint, p_ok boolean) returns void language sql security definer");
    expect(fn).toContain("set search_path = public");
    const set = fn.slice(fn.indexOf(" set last_used_at"), fn.indexOf(" where "));
    expect(set.replace(/\s+/g, " ").trim()).toBe(
      "set last_used_at = case when p_ok then now() else s.last_used_at end, failed_at = case when p_ok then s.failed_at else now() end",
    );
    for (const col of ["endpoint", "p256dh", "auth =", "user_id ="])
      expect(set, col).not.toContain(col);
    expect(fn).toContain("where s.id = p_id");
    expect(fn).toContain("public.followup_is_system()");
    expect(fn).toContain("s.user_id = auth.uid()");
  });
  it("is not callable without a login", () => {
    expect(sql).toContain(
      "revoke all on function public.push_subscription_mark(bigint, boolean) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.push_subscription_mark(bigint, boolean) to authenticated, service_role;",
    );
  });
  it("the generated types list the function", () => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8").replace(/\s+/g, " ");
    expect(types).toContain(
      "push_subscription_mark: { Args: { p_id: number; p_ok: boolean } Returns: undefined }",
    );
  });
});

describe("notify(): the device stamp goes through push_subscription_mark", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const recipients: FakeRpc = (args, tables) =>
    (tables["profiles"] ?? [])
      .filter((p) => (args["ids"] as string[]).includes(p["id"] as string))
      .map((p) => ({
        id: p["id"],
        email: p["email"],
        full_name: p["full_name"],
        notify_email: false,
        notify_push: true,
        notify_leads: true,
        notify_opportunities: true,
        notify_service: true,
        notify_bids: true,
        notify_storms: true,
      }));
  const env = (rpcs: Record<string, FakeRpc>) => {
    const e = fakeSupabase(
      {
        profiles: [{ id: A, email: "a@example.com", full_name: "A" }],
        notifications: [],
        push_subscriptions: [
          {
            id: 7,
            user_id: A,
            endpoint: "https://push.example/7",
            p256dh: "k",
            auth: "a",
            failed_at: null,
          },
        ],
        app_secrets: [
          { key: "vapid_public", value: "pub" },
          { key: "vapid_private", value: "priv" },
        ],
      },
      { rpcs },
    );
    holder.db = e.db;
    return e;
  };
  const send = (e: ReturnType<typeof env>) =>
    notify(
      [A],
      { kind: "ticket_done", title: "Ticket #12 done", url: "/service?id=t12" },
      e.db as Client,
    );
  const deviceWrites = (e: ReturnType<typeof env>) =>
    e.writes.filter((w) => w.table === "push_subscriptions");
  const marks = (e: ReturnType<typeof env>) =>
    e.rpcCalls.filter((c) => c.fn === "push_subscription_mark").map((c) => c.args);

  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-placeholder-not-a-key");
    vi.stubEnv("APP_URL", "https://portal.example.com");
    pushMock.mockClear();
    pushMock.mockImplementation(async () => ({ ok: true, gone: false, status: 201 }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("a push that lands: one mark (ok), and no direct write to the device row", async () => {
    const e = env({ notify_recipients: recipients, push_subscription_mark: () => null });
    expect(await send(e)).toBe(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(marks(e)).toEqual([{ p_id: 7, p_ok: true }]);
    expect(deviceWrites(e)).toEqual([]);
  });

  it("a device that is gone: one mark (not ok), and no direct write", async () => {
    pushMock.mockImplementation(async () => ({
      ok: false,
      gone: true,
      status: 410,
      error: "gone",
    }));
    const e = env({ notify_recipients: recipients, push_subscription_mark: () => null });
    await send(e);
    expect(marks(e)).toEqual([{ p_id: 7, p_ok: false }]);
    expect(deviceWrites(e)).toEqual([]);
  });

  it("a push that fails for another reason: no mark and no write (it used to send an empty update)", async () => {
    pushMock.mockImplementation(async () => ({
      ok: false,
      gone: false,
      status: 500,
      error: "busy",
    }));
    const e = env({ notify_recipients: recipients, push_subscription_mark: () => null });
    await send(e);
    expect(marks(e)).toEqual([]);
    expect(deviceWrites(e)).toEqual([]);
  });

  it("before the migration is applied the function is missing: the old stamp still runs, one column", async () => {
    const e = env({ notify_recipients: recipients });
    await send(e);
    expect(marks(e)).toEqual([{ p_id: 7, p_ok: true }]);
    const w = deviceWrites(e);
    expect(w).toHaveLength(1);
    expect(Object.keys(w[0]!.payload ?? {})).toEqual(["last_used_at"]);
  });

  it("the sender has no other write to push_subscriptions", () => {
    const src = readFileSync("src/lib/notify.server.ts", "utf8");
    const updates = src
      .split('.from("push_subscriptions")')
      .slice(1)
      .map((s) => s.slice(0, 40));
    expect(updates.filter((s) => /\.update\(/.test(s))).toHaveLength(1);
    expect(src).toContain('rawRpc(admin, "push_subscription_mark", { p_id: id, p_ok: ok })');
  });
});
