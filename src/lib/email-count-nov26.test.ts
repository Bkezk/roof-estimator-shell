/**
 * The day's email count (the audit of Nov 25, 2026, fix 25; owner: "go on ... 25 (ill do the
 * plan change later)"). Nov 26, 2026. The email plan and its limit are not changed.
 *
 *  a. Only an email the service accepted counts. A send that is refused, or never reaches the
 *     service, gives its count back, and the "four fifths" notice goes only once the email
 *     that reached it was accepted. Before, every failed try stayed counted: a service that
 *     refused every email had staff emails held and the admins told "80 of today's 100 are
 *     used" with nothing delivered.
 *  b. An email to somebody with no bell is never held. A task's outside person was counted as
 *     staff, held from four fifths of the day, and never sent.
 *  c. A staff email that waited is not a failure: it is not kept on its notice, so Admin ›
 *     Reminders does not list it under Recent failures.
 *
 * Every test of a, b and c here fails on the code of Nov 25. Names and addresses are made up.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  EMAIL_DAY_FULL,
  EMAIL_HELD,
  countedEmail,
  notify,
  sendEmail,
  type Client,
} from "@/lib/notify.server";
import type { TaskRow } from "@/lib/tasks";
import { sendTaskNotice } from "@/lib/tasks-notify.server";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const MIGRATION = "supabase/migrations/20261125500000_email_count_and_pay_reminder.sql";

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
      notify_push: false,
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
      push_subscriptions: [],
      company_settings: [{ id: 1, company_name: "Acme Roofing" }],
      buildings: [],
    },
    { rpcs: { notify_recipients: recipients, ...rpcs } },
  );
  holder.db = e.db;
  return e;
}

let fetchMock: ReturnType<typeof vi.fn>;
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-placeholder-not-a-key");
  vi.stubEnv("RESEND_API_KEY", "test-placeholder-not-a-key");
  vi.stubEnv("APP_URL", "https://portal.example.com");
  vi.stubEnv("NOTIFY_FROM_EMAIL", "JBK <reminders@example.com>");
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  pushMock.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  errors.mockRestore();
});

const mail = { to: "pat@example.com", subject: "Hello", text: "Hi" };
const calls = (e: ReturnType<typeof emailEnv>, fn: string) =>
  e.rpcCalls.filter((c) => c.fn === fn).map((c) => c.args);

describe("a. only an email the service accepted counts", () => {
  it("an email the service refuses gives its count back", async () => {
    const e = emailEnv({
      email_take: () => ({ send: true, alert: null, used: 12, cap: 100, id: 41 }),
      email_give_back: () => true,
    });
    fetchMock.mockImplementationOnce(
      async () => new Response("The domain is not verified", { status: 403 }),
    );
    expect(await sendEmail({ ...mail, kind: "customer" })).toEqual({
      ok: false,
      error: "Resend 403: The domain is not verified",
    });
    expect(calls(e, "email_give_back")).toEqual([{ p_id: 41, p_alerted: false }]);
  });
  it("so does one that never reaches the service", async () => {
    const e = emailEnv({
      email_take: () => ({ send: true, alert: null, used: 12, cap: 100, id: 42 }),
      email_give_back: () => true,
    });
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    expect(await sendEmail({ ...mail, kind: "customer" })).toEqual({
      ok: false,
      error: "network down",
    });
    expect(calls(e, "email_give_back")).toEqual([{ p_id: 42, p_alerted: false }]);
  });
  it("and one the service turns down for going too fast, which is not the day's limit", async () => {
    const e = emailEnv({
      email_take: () => ({ send: true, alert: null, used: 12, cap: 100, id: 43 }),
      email_give_back: () => true,
    });
    fetchMock.mockImplementationOnce(
      async () => new Response('{"name":"rate_limit_exceeded"}', { status: 429 }),
    );
    const r = await sendEmail({ ...mail, kind: "staff" });
    expect(r.ok).toBe(false);
    expect(calls(e, "email_give_back")).toEqual([{ p_id: 43, p_alerted: false }]);
    expect(calls(e, "email_seen")).toEqual([]);
  });
  it("an email that went stays counted: nothing is given back", async () => {
    const e = emailEnv({
      email_take: () => ({ send: true, alert: null, used: 12, cap: 100, id: 44 }),
      email_give_back: () => true,
    });
    expect(await sendEmail({ ...mail, kind: "customer" })).toEqual({ ok: true });
    expect(calls(e, "email_give_back")).toEqual([]);
  });
  it("the admins hear 'four fifths' only when the email that reached it went", async () => {
    const e = emailEnv({
      email_take: () => ({ send: true, alert: "near", used: 80, cap: 100, id: 45 }),
      email_give_back: () => true,
    });
    // The email that would have reached four fifths is refused: nobody is told, and the stamp
    // is cleared with the count, so the email that really gets there tells them.
    fetchMock.mockImplementationOnce(async () => new Response("no", { status: 500 }));
    expect((await sendEmail({ ...mail, kind: "customer" })).ok).toBe(false);
    expect(e.tables["notifications"] ?? []).toEqual([]);
    expect(calls(e, "email_give_back")).toEqual([{ p_id: 45, p_alerted: true }]);
    // The next one goes: now they are told, once.
    expect(await sendEmail({ ...mail, kind: "customer" })).toEqual({ ok: true });
    const rows = e.tables["notifications"] ?? [];
    expect(rows.map((r) => [r["user_id"], r["title"]])).toEqual([
      [ADMIN, "Email: 80 of today's 100 are used"],
    ]);
    expect(calls(e, "email_give_back").length).toBe(1);
  });
  it("when the service says the day is full, that stays as it was: counted, and said once", async () => {
    const e = emailEnv({
      email_take: () => ({ send: true, alert: null, used: 70, cap: 100, id: 46 }),
      email_seen: (a) => ({ alert: a["p_refused"] ? "full" : null, cap: 100 }),
      email_give_back: () => true,
    });
    fetchMock.mockImplementationOnce(
      async () => new Response('{"name":"daily_quota_exceeded"}', { status: 429 }),
    );
    expect(await sendEmail({ ...mail, kind: "customer" })).toEqual({
      ok: false,
      error: EMAIL_DAY_FULL,
    });
    expect(calls(e, "email_seen")).toEqual([{ p_used: null, p_refused: true }]);
    expect(calls(e, "email_give_back")).toEqual([]);
    expect((e.tables["notifications"] ?? []).map((r) => r["title"])).toEqual([
      "Email has reached today's limit",
    ]);
  });
  it("a count that cannot be given back never changes what the sender is told", async () => {
    emailEnv({
      email_take: () => ({ send: true, alert: null, used: 3, cap: 100, id: 47 }),
      email_give_back: () => {
        throw new Error("database away");
      },
    });
    fetchMock.mockImplementationOnce(async () => new Response("bad address", { status: 422 }));
    expect(await sendEmail({ ...mail, kind: "customer" })).toEqual({
      ok: false,
      error: "Resend 422: bad address",
    });
    // And an email still goes when the give-back would fail but is not needed.
    expect(await sendEmail({ ...mail, kind: "customer" })).toEqual({ ok: true });
  });
  it("a database from before this change names no row: nothing is given back, and the admins are told as before", async () => {
    const e = emailEnv({
      email_take: () => ({ send: true, alert: "near", used: 80, cap: 100 }),
    });
    fetchMock.mockImplementationOnce(async () => new Response("no", { status: 500 }));
    expect((await sendEmail({ ...mail, kind: "customer" })).ok).toBe(false);
    expect(calls(e, "email_give_back")).toEqual([]);
    expect((e.tables["notifications"] ?? []).map((r) => r["kind"])).toEqual(["email_limit"]);
  });
  it("the preview, with no server key, counts nothing and gives nothing back", async () => {
    const e = emailEnv({ email_take: () => ({ send: true, id: 48 }), email_give_back: () => true });
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(await countedEmail("staff", async () => new Response("no", { status: 500 }))).toEqual({
      ok: false,
      error: "Resend 500: no",
    });
    expect(e.rpcCalls).toEqual([]);
  });

  describe("the database's side", () => {
    const sql = flat(read(MIGRATION));
    const fn = (name: string) => {
      const from = sql.indexOf(`create or replace function public.${name}(`);
      expect(from).toBeGreaterThan(-1);
      return sql.slice(from, sql.indexOf("$function$;", from));
    };
    it("the count names the row it took, and nothing else about it changed", () => {
      const take = fn("email_take");
      expect(take).toContain(
        "insert into public.email_sends (kind) values (p_kind) returning id into v_id;",
      );
      expect(take).toContain("'cap', v_cap, 'id', v_id);");
      expect(take).toContain("'cap', 0, 'id', v_id);");
      // The limit, the four fifths, a customer never held, a limit of 0 never holding: the
      // lines of Nov 24, word for word.
      const before = flat(
        read("supabase/migrations/20261124900000_public_limits_and_email_count.sql"),
      );
      for (const line of [
        "v_cap := coalesce(v_cap, 100);",
        "v_hold := floor(v_cap * 0.8)::integer;",
        "if p_kind = 'staff' and v_used >= v_hold then",
        "insert into public.email_sends (kind, held) values ('staff', true);",
        "return jsonb_build_object('send', false, 'why', 'held', 'used', v_used, 'cap', v_cap);",
        "if v_cap <= 0 then",
        "where at > now() - interval '24 hours' and not held;",
        "and (s.near_told_at is null or s.near_told_at < now() - interval '24 hours')",
      ]) {
        expect(before).toContain(line);
        expect(take).toContain(line);
      }
      // A held email names no row: there is nothing to give back.
      expect(take.match(/'id', v_id/g)?.length).toBe(2);
    });
    it("giving back takes the row out of the count, for the site's server alone", () => {
      const back = fn("email_give_back");
      expect(back).toContain("email_give_back(p_id bigint, p_alerted boolean default false)");
      expect(back).toContain("if coalesce(auth.role(), '') <> 'service_role' then");
      expect(back).toContain("security definer set search_path = public");
      // Only a row counted as sent, never one that records a held email.
      expect(back).toContain(
        "delete from public.email_sends where id = p_id and not held and at > now() - interval '1 hour';",
      );
      // The "told at four fifths" stamp goes back with it, only when a row did.
      expect(back).toContain(
        "if v_n > 0 and coalesce(p_alerted, false) then update public.email_state set near_told_at = null where id = 1;",
      );
      expect(sql).toContain(
        "revoke all on function public.email_give_back(bigint, boolean) from public, anon, authenticated;",
      );
      expect(sql).toContain(
        "grant execute on function public.email_give_back(bigint, boolean) to service_role;",
      );
      expect(sql).toContain(
        "revoke all on function public.email_take(text) from public, anon, authenticated;",
      );
      expect(sql).toContain("grant execute on function public.email_take(text) to service_role;");
    });
    it("no limit's number is changed", () => {
      expect(sql).not.toMatch(/email_daily_cap\s*=/);
      expect(sql).not.toContain("update public.public_form_settings");
    });
  });
});

describe("b. an email to somebody with no bell is never held", () => {
  const task = {
    id: "t1",
    title: "Meet the adjuster",
    details: null,
    due_date: "2027-12-20",
    all_day: true,
    start_time: null,
    end_time: null,
    account_name: "Made Up Storage Co",
    site_name: "Unit 2",
    created_by_name: "Olive Office",
    building_id: null,
  } as unknown as TaskRow;

  it("a task's outside person gets their email when staff emails are waiting", async () => {
    // From four fifths of the day: a staff email is held, a customer's goes.
    const e = emailEnv({
      email_take: (a) =>
        a["p_kind"] === "staff"
          ? { send: false, why: "held", used: 80, cap: 100 }
          : { send: true, alert: null, used: 81, cap: 100, id: 60 },
    });
    const r = await sendTaskNotice(
      task,
      "created",
      { users: [], emails: ["adjuster@example.com"] },
      e.db as Client,
    );
    expect(r).toEqual({ users: 0, emails: 1, errors: [], inboxFailed: false });
    expect(calls(e, "email_take")).toEqual([{ p_kind: "customer" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as { to: string[] };
    expect(sent.to).toEqual(["adjuster@example.com"]);
  });
  it("every email the site sends says who it is for", () => {
    // Each call of sendEmail in the site's own code names its kind: an email to a person
    // outside the staff that is left to the default would wait, and they have no bell.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    const found: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/\b(?:sendEmail|send)\(\{/g)) {
        const call = text.slice(m.index, text.indexOf("});", m.index));
        if (!/\bsubject\b/.test(call)) continue; // not an email
        const kind = /kind: "(staff|customer)"/.exec(call)?.[1] ?? "NOT SAID";
        found.push(`${f.slice(process.cwd().length + 1)}: ${kind}`);
      }
    }
    expect(found.sort()).toEqual([
      // A notice to one of us, who has it in the bell too: the only one that may wait.
      "src/lib/notify.server.ts: staff",
      // The Roof Care agreement and receipt.
      "src/lib/roof-care-email.server.ts: customer",
      // "We measured your roof", and the card payment link.
      "src/lib/roof-care-pay-link.functions.ts: customer",
      "src/lib/roof-care-pay-link.functions.ts: customer",
      // A task's outside person.
      "src/lib/tasks-notify.server.ts: customer",
    ]);
    // The invoice and a document's PDF go through the same count, as a customer's.
    expect(flat(read("src/lib/invoices.server.ts"))).toContain(
      'return countedEmail("customer", () =>',
    );
    expect(flat(read("src/lib/documents/email.server.ts"))).toContain(
      "return emailInvoice(input);",
    );
    // Nothing else reaches the email service.
    const posts = files.filter((f) => readFileSync(f, "utf8").includes("api.resend.com/emails"));
    expect(posts.map((f) => f.slice(process.cwd().length + 1)).sort()).toEqual([
      "src/lib/invoices.server.ts",
      "src/lib/notify.server.ts",
    ]);
  });
});

describe("c. a staff email that waited is not a failure", () => {
  it("nothing is kept on the notice for it, so Admin › Reminders does not list it", async () => {
    const e = emailEnv({
      email_take: () => ({ send: false, why: "held", used: 80, cap: 100 }),
    });
    await notify([MANAGER], { kind: "task", title: "A task" }, e.db as Client);
    const rows = e.tables["notifications"] ?? [];
    expect(rows.length).toBe(1);
    // The notice is in the bell. Its email neither went nor failed.
    expect(rows[0]!["email_error"] ?? null).toBeNull();
    expect(rows[0]!["email_sent_at"] ?? null).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    // What the sender is told has not changed.
    expect(await sendEmail({ ...mail, kind: "staff" })).toEqual({ ok: false, error: EMAIL_HELD });
  });
  it("a real failure is still kept, and still listed", async () => {
    const e = emailEnv({
      email_take: () => ({ send: true, alert: null, used: 3, cap: 100, id: 70 }),
      email_give_back: () => true,
    });
    fetchMock.mockImplementationOnce(async () => new Response("bad address", { status: 422 }));
    await notify([MANAGER], { kind: "task", title: "A task" }, e.db as Client);
    expect((e.tables["notifications"] ?? [])[0]!["email_error"]).toBe("Resend 422: bad address");
    // The failures list reads every notice with an email error: a waited one has none.
    expect(flat(read("src/lib/followups.functions.ts"))).toContain(
      '.or("email_error.not.is.null,push_error.not.is.null")',
    );
  });
  it("the ones written before today are cleared by the database change, by their own words", () => {
    const sql = flat(read(MIGRATION));
    expect(sql).toContain(
      "update public.notifications set email_error = null where email_error like 'Not emailed: most of today''s email limit is used%';",
    );
    expect(EMAIL_HELD.startsWith("Not emailed: most of today's email limit is used")).toBe(true);
  });
});
