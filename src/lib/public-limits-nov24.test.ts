/**
 * The limits of the public pages and the day's email count (owner, Nov 24, 2026: "Go on 4s
 * suggestions"). Each test here failed on the code of that morning.
 *
 *  1. A limit is said in the right words: this connection's hour, this connection's day, or
 *     the day's count for everyone, which is nothing the visitor did.
 *  2. The office is told once when the day's count passes four fifths and once when it is
 *     reached: to the bell and the phone, never by email.
 *  3. Emails are counted. From four fifths of the day's limit, emails to staff about notices
 *     wait, and the rest is kept for customers. The admins are told once, and once more when
 *     the email service refuses.
 *  4. What the office sees on Setup, QR pages.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return holder.db;
  },
}));
const pushMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, status: 201 })));
vi.mock("@/lib/webpush", () => ({
  generateVapidKeys: async () => ({ publicKey: "pub", privateKey: "priv" }),
  sendWebPush: pushMock,
}));

import {
  BELL_ONLY_KINDS,
  EMAIL_DAY_FULL,
  EMAIL_HELD,
  countedEmail,
  emailLimitNotice,
  notify,
  sendEmail,
  type Client,
} from "@/lib/notify.server";
import {
  PUBLIC_BUSY,
  PUBLIC_DAY_LIMITS,
  PUBLIC_TOO_MANY,
  PUBLIC_TOO_MANY_TODAY,
  publicLimitLine,
  type PublicLimitAlert,
} from "@/lib/public-forms";
import { quoteFor, sendService, type PublicDeps } from "@/lib/public-forms.functions";
import { tellPublicLimit } from "@/lib/public-forms.server";
import { emailUsageWords, publicLimitNotice, readUsage, usageLine } from "@/lib/public-requests";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const ASK = { address: "120 Mill St", city: "London", state: "KY", zip: "40741" };
const SERVICE = {
  ...ASK,
  contact_name: "Pat Smith",
  company: "",
  phone: "606-555-0142",
  email: "",
  building_name: "",
  referred_by: "",
  services: [] as string[],
  details: "It drips by the dock door.",
  website: "",
  open_ms: 30_000,
};

function formDeps(take: unknown, limitAlert?: PublicDeps["limitAlert"]) {
  const calls: string[] = [];
  const admin = {
    rpc: async (fn: string) => {
      calls.push(fn);
      if (fn === "public_form_take2") return { data: take, error: null };
      if (fn === "public_care_quote")
        return { data: { quote_token: "tok", custom_quote: false, plans: [] }, error: null };
      if (fn === "public_request_submit") return { data: "R-4321", error: null };
      return { data: null, error: { message: `no such function ${fn}` } };
    },
  };
  const deps: PublicDeps = {
    admin: admin as never,
    key: "k".repeat(40),
    sample: false,
    drive: async () =>
      ({
        hours: 1,
        miles: 50,
        source: "routed",
        note: "",
        placed_by: "street",
        place: null,
      }) as never,
    mapSize: async () => null,
    tell: async () => undefined,
    ...(limitAlert ? { limitAlert } : {}),
  };
  return { deps, calls };
}

describe("1. A limit is said in the right words", () => {
  it("this connection's hour, this connection's day, and the day's count for everyone", async () => {
    for (const [why, words] of [
      ["one", PUBLIC_TOO_MANY],
      ["one_day", PUBLIC_TOO_MANY_TODAY],
      ["all", PUBLIC_BUSY],
    ] as const) {
      const q = formDeps({ ok: false, why });
      await expect(quoteFor({ ...ASK, sqft: 21000 }, q.deps), why).rejects.toThrow(words);
      // Refused: nothing more is asked of the database.
      expect(q.calls).toEqual(["public_form_take2"]);
      const s = formDeps({ ok: false, why });
      await expect(sendService(SERVICE, s.deps), why).rejects.toThrow(words);
      expect(s.calls).toEqual(["public_form_take2"]);
    }
    // The day's count for everyone is nothing the visitor did, and gives the number to call.
    expect(PUBLIC_BUSY).not.toContain("this connection");
    expect(PUBLIC_BUSY).toContain("606-523-9000");
    expect(PUBLIC_TOO_MANY_TODAY).toContain("606-523-9000");
    expect(PUBLIC_DAY_LIMITS).toEqual({ quote: 2000, request: 300 });
  });
  it("the pages show each of the three as it is, and any other failure as before", () => {
    expect(publicLimitLine(`Error: ${PUBLIC_BUSY}`)).toBe(PUBLIC_BUSY);
    expect(publicLimitLine(PUBLIC_TOO_MANY_TODAY)).toBe(PUBLIC_TOO_MANY_TODAY);
    expect(publicLimitLine(PUBLIC_TOO_MANY)).toBe(PUBLIC_TOO_MANY);
    expect(publicLimitLine("The price changed after it was shown.")).toBeNull();
    const care = flat(read("src/components/public/care-page.tsx"));
    const request = flat(read("src/components/public/request-page.tsx"));
    expect(care).toContain("setAskError(publicLimitLine(errWords(e)) ?? SEND_FAILED_LINE);");
    expect(care).toContain("setSendError(publicLimitLine(errWords(e)) ?? SEND_FAILED_LINE);");
    expect(request).toContain("setSendError(publicLimitLine(errWords(e)) ?? SEND_FAILED_LINE);");
  });
  it("the database: higher day limits, a day limit for one connection, counted in one step", () => {
    const sql = flat(read("supabase/migrations/20261124900000_public_limits_and_email_count.sql"));
    expect(sql).toContain("v_hour_cap := 20; v_one_cap := 60; v_all_cap := 2000;");
    expect(sql).toContain("v_hour_cap := 5; v_one_cap := 10; v_all_cap := 300;");
    // The number that comes back from the count is this call's own place in line.
    expect(sql).toContain(
      "on conflict (kind, key, bucket) do update set n = public.public_form_hits.n + 1 returning n into v_all; if v_all > v_all_cap then",
    );
    // A call already over a limit is refused before anything is counted.
    expect(sql.indexOf("if coalesce(v_all, 0) >= v_all_cap then")).toBeLessThan(
      sql.indexOf("returning n into v_all;"),
    );
    // The office's day, not the server's.
    expect(sql).toContain(
      "date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York'",
    );
    expect(sql).toContain(
      "revoke all on function public.public_form_take2(text, text) from public, anon, authenticated;",
    );
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\banon\b/);
  });
});

describe("2. The office is told once, to the bell and the phone", () => {
  it("the call that takes the count past four fifths, or to its end, tells the office", async () => {
    const told: PublicLimitAlert[] = [];
    const near = formDeps({ ok: true, alert: "near", used: 1600, cap: 2000 }, async (_a, x) => {
      told.push(x);
    });
    await quoteFor({ ...ASK, sqft: 21000 }, near.deps);
    const reached = formDeps({ ok: true, alert: "reached", used: 300, cap: 300 }, async (_a, x) => {
      told.push(x);
    });
    expect(await sendService(SERVICE, reached.deps)).toEqual({ reference: "R-4321" });
    expect(told).toEqual([
      { kind: "quote", level: "near", used: 1600, cap: 2000 },
      { kind: "request", level: "reached", used: 300, cap: 300 },
    ]);
    // An ordinary call tells nobody, and a telling that fails does not lose the request.
    const quiet = formDeps({ ok: true, alert: null, used: 12, cap: 2000 }, async () => {
      throw new Error("must not be called");
    });
    await quoteFor({ ...ASK, sqft: 21000 }, quiet.deps);
    const broken = formDeps({ ok: true, alert: "near", used: 240, cap: 300 }, async () => {
      throw new Error("push service down");
    });
    expect(await sendService(SERVICE, broken.deps)).toEqual({ reference: "R-4321" });
  });
  it("the notice says how much is used, what happens at the limit, and where the count is", () => {
    const near = publicLimitNotice({ kind: "quote", level: "near", used: 1600, cap: 2000 });
    expect(near.title).toBe("The Roof Care page: 1,600 of today's 2,000 price questions are used");
    expect(near.body).toContain("visitors are asked to call the office until midnight");
    expect(near.url).toBe("/setup/qr");
    const full = publicLimitNotice({ kind: "request", level: "reached", used: 300, cap: 300 });
    expect(full.title).toBe("The public pages have reached today's limit of 300 requests");
    expect(full.kind).toBe("public_limit");
    expect([...BELL_ONLY_KINDS].sort()).toEqual(["email_limit", "public_limit"]);
  });
});

/* ---- the email count ---------------------------------------------------------------------- */

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const recipients: FakeRpc = (args, tables) =>
  (tables["profiles"] ?? [])
    .filter((p) => (args["ids"] as string[]).includes(p["id"] as string))
    .map((p) => ({
      id: p["id"],
      email: p["email"],
      full_name: null,
      notify_email: true,
      notify_push: true,
      notify_leads: false,
      notify_opportunities: true,
      notify_service: true,
      notify_bids: true,
      notify_storms: false,
    }));

function emailEnv(rpcs: Record<string, FakeRpc>) {
  const e = fakeSupabase(
    {
      profiles: [
        { id: ADMIN, role: "admin", email: "admin@example.com" },
        { id: MANAGER, role: "manager", email: "manager@example.com" },
      ],
      notifications: [],
      push_subscriptions: [
        {
          id: "s1",
          user_id: ADMIN,
          endpoint: "https://push.example/1",
          p256dh: "k",
          auth: "a",
          failed_at: null,
        },
      ],
      company_settings: [{ id: 1, company_name: "Acme Roofing" }],
      app_secrets: [
        { key: "vapid_public", value: "pub" },
        { key: "vapid_private", value: "priv" },
      ],
    },
    { rpcs: { notify_recipients: recipients, ...rpcs } },
  );
  holder.db = e.db;
  return e;
}

describe("3. Emails are counted, and customers come first", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-placeholder-not-a-key");
    vi.stubEnv("RESEND_API_KEY", "test-placeholder-not-a-key");
    vi.stubEnv("APP_URL", "https://portal.example.com");
    vi.stubEnv("NOTIFY_FROM_EMAIL", "JBK <reminders@example.com>");
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    pushMock.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const mail = { to: "pat@example.com", subject: "Hello", text: "Hi" };

  it("an email is counted before it goes, as one to staff unless it says it is a customer's", async () => {
    const e = emailEnv({ email_take: () => ({ send: true, alert: null, used: 3, cap: 100 }) });
    expect(await sendEmail(mail)).toEqual({ ok: true });
    expect(await sendEmail({ ...mail, kind: "customer" })).toEqual({ ok: true });
    expect(e.rpcCalls.filter((c) => c.fn === "email_take").map((c) => c.args)).toEqual([
      { p_kind: "staff" },
      { p_kind: "customer" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Every email to a customer says so: the agreement and the receipt, the payment link, the
    // invoice.
    expect(flat(read("src/lib/roof-care-email.server.ts"))).toContain('kind: "customer",');
    expect(flat(read("src/lib/roof-care-pay-link.functions.ts"))).toContain('kind: "customer",');
    expect(flat(read("src/lib/invoices.server.ts"))).toContain(
      'return countedEmail("customer", () =>',
    );
  });
  it("a staff notice email waits when most of the day's count is used: it is never sent", async () => {
    emailEnv({ email_take: () => ({ send: false, why: "held", used: 80, cap: 100 }) });
    expect(await sendEmail(mail)).toEqual({ ok: false, error: EMAIL_HELD });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(EMAIL_HELD).toContain("The notice is in the bell.");
  });
  it("at four fifths the admins are told once: bell and phone, and no email for it", async () => {
    const e = emailEnv({ email_take: () => ({ send: true, alert: "near", used: 80, cap: 100 }) });
    expect(await sendEmail({ ...mail, kind: "customer" })).toEqual({ ok: true });
    const rows = e.tables["notifications"] ?? [];
    // The admin, not the manager.
    expect(rows.map((r) => r["user_id"])).toEqual([ADMIN]);
    expect(rows[0]!["kind"]).toBe("email_limit");
    expect(rows[0]!["title"]).toBe("Email: 80 of today's 100 are used");
    expect(pushMock).toHaveBeenCalledTimes(1);
    // One call to the email service: the customer's email. The notice itself is not emailed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("the email service's own count is kept, and its refusal for the day is said plainly", async () => {
    const e = emailEnv({
      email_take: () => ({ send: true, alert: null, used: 99, cap: 100 }),
      email_seen: (a) => ({ alert: a["p_refused"] ? "full" : null, cap: 100 }),
    });
    fetchMock.mockImplementationOnce(
      async () => new Response("{}", { status: 200, headers: { "x-resend-daily-quota": "42" } }),
    );
    expect(await sendEmail({ ...mail, kind: "customer" })).toEqual({ ok: true });
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          '{"name":"daily_quota_exceeded","message":"You have reached your daily email sending quota."}',
          {
            status: 429,
          },
        ),
    );
    expect(await sendEmail({ ...mail, kind: "customer" })).toEqual({
      ok: false,
      error: EMAIL_DAY_FULL,
    });
    expect(e.rpcCalls.filter((c) => c.fn === "email_seen").map((c) => c.args)).toEqual([
      { p_used: 42, p_refused: false },
      { p_used: null, p_refused: true },
    ]);
    const rows = e.tables["notifications"] ?? [];
    expect(rows.map((r) => r["title"])).toEqual(["Email has reached today's limit"]);
    // Any other refusal reads as before.
    fetchMock.mockImplementationOnce(async () => new Response("bad address", { status: 422 }));
    expect(await sendEmail(mail)).toEqual({ ok: false, error: "Resend 422: bad address" });
  });
  it("a count that cannot be read never stops an email, and the preview counts nothing", async () => {
    const e = emailEnv({
      email_take: () => {
        throw new Error("database away");
      },
    });
    expect(await sendEmail(mail)).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const before = e.rpcCalls.length;
    expect(await countedEmail("staff", async () => new Response("{}", { status: 200 }))).toEqual({
      ok: true,
    });
    expect(e.rpcCalls.length).toBe(before);
  });
  it("a notice about a limit is never emailed, whoever has email on", async () => {
    const e = emailEnv({ email_take: () => ({ send: true }) });
    await notify([ADMIN, MANAGER], emailLimitNotice("full", 100, 100), e.db as Client);
    await tellPublicLimit(e.db as Client, { kind: "quote", level: "near", used: 1600, cap: 2000 });
    expect((e.tables["notifications"] ?? []).length).toBe(3);
    expect(fetchMock).not.toHaveBeenCalled();
    // An ordinary notice to the same people is emailed as before.
    await notify([ADMIN], { kind: "task", title: "A task" }, e.db as Client);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("the database: staff wait from four fifths, customers go on, told once in 24 hours", () => {
    const sql = flat(read("supabase/migrations/20261124900000_public_limits_and_email_count.sql"));
    expect(sql).toContain("v_hold := floor(v_cap * 0.8)::integer;");
    expect(sql).toContain("if p_kind = 'staff' and v_used >= v_hold then");
    expect(sql).toContain(
      "and (s.near_told_at is null or s.near_told_at < now() - interval '24 hours')",
    );
    expect(sql).toContain("where at > now() - interval '24 hours' and not held;");
    for (const fn of ["email_take(text)", "email_seen(integer, boolean)"])
      expect(sql).toContain(
        `revoke all on function public.${fn} from public, anon, authenticated;`,
      );
    expect(sql).toContain(
      "revoke all on table public.email_sends from public, anon, authenticated;",
    );
  });
});

describe("4. What the office sees on Setup, QR pages", () => {
  it("reads the counts strictly, and marks a count from four fifths and at its limit", () => {
    const u = readUsage({
      quote: { used: 1650, cap: 2000 },
      request: { used: "12", cap: 300 },
      days: [
        { day: "2026-11-24", quote: 1650, request: 12, dropped: 2 },
        { day: "not a day", quote: 9 },
      ],
      email: { used: 81, held: 3, cap: 100, hold: 80 },
      secret: "left out",
    });
    expect(u).toEqual({
      quote: { used: 1650, cap: 2000 },
      request: { used: 12, cap: 300 },
      days: [{ day: "2026-11-24", quote: 1650, request: 12, dropped: 2 }],
      email: { used: 81, held: 3, cap: 100, hold: 80 },
    });
    expect(readUsage(null)).toBeNull();
    expect(usageLine(1650, 2000)).toEqual({ words: "1,650 of 2,000", level: "near" });
    expect(usageLine(1599, 2000).level).toBe("ok");
    expect(usageLine(300, 300).level).toBe("full");
  });
  it("the email line says what waits and why, and what a plan with no daily limit means", () => {
    expect(emailUsageWords({ used: 81, held: 3, cap: 100, hold: 80 })).toBe(
      "81 of 100 sent in the last 24 hours. From 80, emails to staff about notices wait, so the rest is kept for customers. 3 staff notice emails waited: each notice is in the bell.",
    );
    expect(emailUsageWords({ used: 5, held: 0, cap: 0, hold: 0 })).toBe(
      "5 sent in the last 24 hours. No daily limit is set, so nothing waits.",
    );
  });
  it("the page shows today's counts, the last 30 days and the email limit", () => {
    const page = flat(read("src/components/public-forms-setup.tsx"));
    expect(page).toContain(
      '<CardTitle className="text-base">Today on the public pages</CardTitle>',
    );
    expect(page).toContain(
      '<UsageRow name="Quotes shown" used={s.usage.quote.used} cap={s.usage.quote.cap} />',
    );
    expect(page).toContain("The last 30 days");
    expect(page).toContain(
      '<Label htmlFor="email-cap">The most in 24 hours on the email plan</Label>',
    );
    expect(page).toContain("{emailUsageWords(s.usage.email)}");
    const fn = flat(read("src/lib/public-requests.functions.ts"));
    expect(fn).toContain('.rpc("public_form_usage")');
    expect(fn).toContain('"email_daily_cap_set",');
  });
});
