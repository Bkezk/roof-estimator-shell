/**
 * Notice categories (owner, Oct 13): "on notifications on the account, be able to toggle if they
 * see lead notices, opportunity notices, service notices, and bid notices on their notifications
 * bell on the top right, so that people who don't deal with those things don't see them."
 *
 *   1. The send: notify() skips a recipient whose switch for the notice's category is off — no
 *      inbox row, no email, no push. A notice with no category reaches everyone asked.
 *   2. The reads: listMyNotifications and unreadNotificationCount leave out the rows of the
 *      caller's off categories (older rows too), in SQL, so the bell clears at once.
 *   3. The migration: three columns default true, set_my_notify_prefs and notify_recipients
 *      extended, grants kept; the types follow.
 *   4. The prefs functions carry the five flags; the Account page has the five switches
 *      (storm alerts added later on Oct 13: "storms should also be a toggle as well and defaulted
 *      to off").
 *
 * notify() and the inbox reads run for real against the stand-in client (the fake database
 * functions mirror the SQL); the migration, the types and the page are checked as text.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
// The service-role client notify() loads: the fake of the test in progress.
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return holder.db;
  },
}));
// Web push: the signing keys come from app_secrets (below); the send itself is recorded.
const pushMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, status: 201 })));
vi.mock("@/lib/webpush", () => ({
  generateVapidKeys: async () => ({ publicKey: "pub", privateKey: "priv" }),
  sendWebPush: pushMock,
}));

import { notify, type Client } from "@/lib/notify.server";
import { listMyNotifications, unreadNotificationCount } from "@/lib/notifications.functions";
import { getNotifyPrefs, setNotifyPrefs } from "@/lib/followups.functions";
import {
  NOTICE_CATEGORIES,
  NOTICE_CATEGORY_HELP,
  NOTICE_CATEGORY_LABELS,
} from "@/lib/notice-categories";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");

/* ---- the send ----------------------------------------------------------------------------- */

const TECH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // service off, works bids
const ESTIMATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // bids off, works tickets
const OFFICE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // everything on, leads opted in
const PROSPECT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // leads off (the default), opportunities off, storms ON
const HERMIT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // all five off

const person = (id: string, flags: Row): Row => ({
  id,
  email: `${id.slice(0, 4)}@example.com`,
  full_name: id.slice(0, 4),
  notify_email: true,
  notify_push: true,
  ...flags,
});
const PEOPLE: Row[] = [
  person(TECH, { notify_service: false }),
  person(ESTIMATOR, { notify_bids: false }),
  person(OFFICE, { notify_leads: true }),
  person(PROSPECT, { notify_opportunities: false, notify_storms: true }),
  person(HERMIT, {
    notify_leads: false,
    notify_opportunities: false,
    notify_service: false,
    notify_bids: false,
    notify_storms: false,
  }),
];

/** notify_recipients(ids) as the migration has it: channels and the five switches. */
const recipients: FakeRpc = (args, tables) =>
  (tables["profiles"] ?? [])
    .filter((p) => (args["ids"] as string[]).includes(p["id"] as string))
    .map((p) => ({
      id: p["id"],
      email: p["email"],
      full_name: p["full_name"] ?? null,
      notify_email: p["notify_email"] ?? false,
      notify_push: p["notify_push"] ?? false,
      notify_leads: p["notify_leads"] ?? false,
      notify_opportunities: p["notify_opportunities"] ?? true,
      notify_service: p["notify_service"] ?? true,
      notify_bids: p["notify_bids"] ?? true,
      notify_storms: p["notify_storms"] ?? false,
    }));

function sendEnv(rpcs: Record<string, FakeRpc> = { notify_recipients: recipients }) {
  const e = fakeSupabase(
    {
      profiles: PEOPLE.map((p) => ({ ...p })),
      notifications: [],
      push_subscriptions: PEOPLE.map((p, i) => ({
        id: `sub-${i}`,
        user_id: p["id"],
        endpoint: `https://push.example/${i}`,
        p256dh: "k",
        auth: "a",
        failed_at: null,
      })),
      company_settings: [{ id: 1, company_name: "Acme Roofing" }],
      app_secrets: [
        { key: "vapid_public", value: "pub" },
        { key: "vapid_private", value: "priv" },
      ],
    },
    { rpcs },
  );
  holder.db = e.db;
  return e;
}
const inbox = (e: ReturnType<typeof sendEnv>) =>
  (e.tables["notifications"] ?? []).map((r) => r["user_id"]).sort();
let fetchMock: ReturnType<typeof vi.fn>;
/** Who was emailed (Resend's "to"). */
const emailed = () =>
  fetchMock.mock.calls
    .map((c) => JSON.parse(String((c as [string, RequestInit])[1].body)) as { to: string[] })
    .flatMap((b) => b.to)
    .sort();
const pushed = () =>
  pushMock.mock.calls.map((c) => (c as unknown as [{ endpoint: string }])[0].endpoint).sort();
const endpointOf = (id: string) =>
  `https://push.example/${PEOPLE.findIndex((p) => p["id"] === id)}`;
const emailOf = (id: string) => `${id.slice(0, 4)}@example.com`;

describe("notify() skips a recipient whose switch for the notice's category is off", () => {
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

  it("a ticket notice: the technician with service off gets no row, no email, no push", async () => {
    const e = sendEnv();
    const n = await notify(
      [TECH, ESTIMATOR, OFFICE],
      { kind: "ticket_done", title: "Ticket #12 done", url: "/service?id=t12" },
      e.db as Client,
    );
    expect(n).toBe(2);
    expect(inbox(e)).toEqual([ESTIMATOR, OFFICE].sort());
    expect(emailed()).toEqual([emailOf(ESTIMATOR), emailOf(OFFICE)].sort());
    expect(pushed()).toEqual([endpointOf(ESTIMATOR), endpointOf(OFFICE)].sort());
    expect(e.rpcCalls).toEqual([
      { fn: "notify_recipients", args: { ids: [TECH, ESTIMATOR, OFFICE] } },
    ]);
  });

  it("a bid notice: the same technician gets it; the estimator with bids off does not", async () => {
    const e = sendEnv();
    const n = await notify(
      [TECH, ESTIMATOR, OFFICE],
      { kind: "bid_due", title: "Bid due tomorrow: Gym reroof", url: "/estimate?bid=b1" },
      e.db as Client,
    );
    expect(n).toBe(2);
    expect(inbox(e)).toEqual([TECH, OFFICE].sort());
    expect(emailed()).toEqual([emailOf(TECH), emailOf(OFFICE)].sort());
    expect(pushed()).toEqual([endpointOf(TECH), endpointOf(OFFICE)].sort());
  });

  it("bid_overdue and bid_reminder are bid notices too", async () => {
    for (const kind of ["bid_overdue", "bid_reminder"]) {
      const e = sendEnv();
      expect(
        await notify(
          [ESTIMATOR, TECH],
          { kind, title: kind, url: "/estimate?bid=b1" },
          e.db as Client,
        ),
      ).toBe(1);
      expect(inbox(e)).toEqual([TECH]);
    }
  });

  it("a lead notice: leads off (the default) → no row; opted in → a row (belt and braces with lead_notice_user_ids)", async () => {
    const e = sendEnv();
    const n = await notify(
      [PROSPECT, OFFICE, TECH],
      { kind: "lead", title: "Bid Board: 1 new roof job", url: "/prospect/leads?roof=1" },
      e.db as Client,
    );
    expect(n).toBe(1);
    expect(inbox(e)).toEqual([OFFICE]);
    expect(emailed()).toEqual([emailOf(OFFICE)]);
    expect(pushed()).toEqual([endpointOf(OFFICE)]);
  });

  it("a storm alert goes only to people with Storm alerts on (off by default); it is not a lead notice", async () => {
    const e = sendEnv();
    // PROSPECT: leads off but storms on → gets it. OFFICE: leads on, storms at the default (off) → no.
    expect(
      await notify(
        [PROSPECT, OFFICE, TECH],
        { kind: "storm", title: "Storm: 3 buildings", url: "/prospect?storm=1" },
        e.db as Client,
      ),
    ).toBe(1);
    expect(inbox(e)).toEqual([PROSPECT]);
    expect(emailed()).toEqual([emailOf(PROSPECT)]);
    expect(pushed()).toEqual([endpointOf(PROSPECT)]);
  });

  it("the shared kinds go by the link: a follow-up on a ticket, an opportunity, a bid", async () => {
    const ticket = sendEnv();
    await notify(
      [TECH, ESTIMATOR, PROSPECT],
      { kind: "followup", title: "Follow up: Ticket #3", url: "/service?id=t3" },
      ticket.db as Client,
    );
    expect(inbox(ticket)).toEqual([ESTIMATOR, PROSPECT].sort());

    const opp = sendEnv();
    await notify(
      [TECH, ESTIMATOR, PROSPECT],
      { kind: "assigned", title: "Opportunity assigned to you", url: "/opportunities?id=o1" },
      opp.db as Client,
    );
    expect(inbox(opp)).toEqual([TECH, ESTIMATOR].sort());

    const bid = sendEnv();
    await notify(
      [TECH, ESTIMATOR, PROSPECT],
      { kind: "untouched", title: "Untouched: Gym reroof bid", url: "/estimate?bid=b1" },
      bid.db as Client,
    );
    expect(inbox(bid)).toEqual([TECH, PROSPECT].sort());

    const reminder = sendEnv();
    await notify(
      [TECH, ESTIMATOR, PROSPECT],
      { kind: "reminder", title: "Reminder", url: "/opportunities?id=o2" },
      reminder.db as Client,
    );
    expect(inbox(reminder)).toEqual([TECH, ESTIMATOR].sort());
  });

  it("no category — tasks, mentions, the test, a shared kind with no placed link — reaches everyone, even with all five off", async () => {
    const all = [TECH, ESTIMATOR, OFFICE, PROSPECT, HERMIT];
    for (const msg of [
      { kind: "task_today", title: "Due today: call Bell County", url: "/my-work" },
      { kind: "mention", title: "Ann mentioned you", url: "/service?id=t1" },
      { kind: "test", title: "Test", url: "/account" },
      { kind: "followup", title: "Follow up", url: null },
      { kind: "assigned", title: "Assigned", url: "/my-work" },
    ]) {
      const e = sendEnv();
      expect(await notify(all, msg, e.db as Client)).toBe(5);
      expect(inbox(e)).toEqual([...all].sort());
      expect(emailed()).toEqual(all.map(emailOf).sort());
      fetchMock.mockClear();
    }
  });

  it("everyone asked has the category off: nothing is written, nothing sent, 0", async () => {
    const e = sendEnv();
    const n = await notify(
      [TECH, HERMIT],
      { kind: "date_moved", title: "Ticket #5 moved", url: "/service?id=t5" },
      e.db as Client,
    );
    expect(n).toBe(0);
    expect(e.tables["notifications"]).toEqual([]);
    expect(e.writes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("a recipients row without the switches (the function before the migration) is delivered to", async () => {
    const e = sendEnv({
      notify_recipients: (args) =>
        (args["ids"] as string[]).map((id) => ({
          id,
          email: emailOf(id),
          full_name: null,
          notify_email: false,
          notify_push: false,
        })),
    });
    expect(
      await notify(
        [TECH, HERMIT],
        { kind: "ticket_done", title: "Done", url: "/service?id=t1" },
        e.db as Client,
      ),
    ).toBe(2);
    expect(inbox(e)).toEqual([TECH, HERMIT].sort());
  });

  it("in the source: the category is computed once from kind and url, the people filtered before the insert", () => {
    const src = read("src/lib/notify.server.ts");
    const fn = src.slice(
      src.indexOf("export async function notify("),
      src.indexOf("export type FollowupRow"),
    );
    expect(src).toContain('import { noticeCategory, wantsNotice } from "@/lib/notice-categories";');
    expect(fn).toContain("const category = noticeCategory(msg.kind, msg.url ?? null);");
    expect(fn).toContain(
      "const people = (everyone ?? []).filter((p) => wantsNotice(p, category));",
    );
    expect(fn.indexOf("wantsNotice(p, category)")).toBeLessThan(fn.indexOf("const inserts ="));
    expect(fn).toContain("const ids = people.map((p) => p.id);");
    expect(fn).toContain('.in("user_id", ids)');
  });
});

/* ---- the reads: the bell and the inbox leave out what the caller turned off ---------------- */

const ME = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const nrow = (id: number, kind: string, url: string | null, extra: Row = {}): Row => ({
  id,
  user_id: ME,
  kind,
  title: `${kind} ${id}`,
  body: null,
  url,
  followup_id: null,
  created_at: `2026-10-${String(id).padStart(2, "0")}T09:00:00+00:00`,
  read_at: null,
  email_sent_at: null,
  email_error: null,
  push_sent_at: null,
  push_error: null,
  ...extra,
});
/** Newest first, as the server orders them (the stand-in keeps insertion order). */
const ROWS: Row[] = [
  nrow(12, "task", "/my-work"),
  nrow(11, "mention", "/service?id=t1"), // a mention on a ticket is not a service notice
  nrow(10, "ticket_done", "/service?id=t1"), // service
  nrow(9, "assigned", "/service?id=t2"), // service, by the link
  nrow(8, "assigned", "/opportunities?id=o1"), // opportunities
  nrow(7, "followup", "/estimate?bid=b1"), // bids
  nrow(6, "followup", null), // nowhere: always shown
  nrow(5, "bid_due", "/estimate?bid=b1", { read_at: "2026-10-05T10:00:00Z" }), // bids, read
  nrow(4, "lead", "/prospect/leads?roof=1"), // leads
  nrow(3, "untouched", "/service?id=t3"), // service, by the link
  nrow(2, "reminder", "/my-work"), // nowhere
  nrow(1, "date_moved", "/service?id=t4", { read_at: "2026-10-01T10:00:00Z" }), // service, read
  nrow(0, "storm", "/prospect?storm=1"), // storms (oldest)
];
const ids = (rows: Row[]) => rows.map((r) => r["id"]);

function readEnv(profile: Row | null) {
  const e = fakeSupabase({
    profiles: profile ? [{ id: ME, ...profile }] : [],
    notifications: ROWS.map((r) => ({ ...r })),
  });
  const call = <T>(fn: unknown, data?: unknown) =>
    (fn as (a: unknown) => Promise<T>)({ data, context: { supabase: e.db, userId: ME } });
  return { ...e, call };
}
const list = (e: ReturnType<typeof readEnv>, data?: unknown) =>
  e.call<Row[]>(listMyNotifications, data);
const count = (e: ReturnType<typeof readEnv>) => e.call<number>(unreadNotificationCount);

describe("listMyNotifications and unreadNotificationCount leave out the caller's off categories", () => {
  it("everything on (or no flags at all): every row, the whole count", async () => {
    const on = readEnv({
      notify_leads: true,
      notify_opportunities: true,
      notify_service: true,
      notify_bids: true,
      notify_storms: true,
    });
    expect(ids(await list(on))).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(await count(on)).toBe(11);
    // The migration not applied yet (no columns) or no profile row: nothing is hidden.
    expect(ids(await list(readEnv({})))).toHaveLength(13);
    expect(await count(readEnv(null))).toBe(11);
  });

  it("service off: ticket kinds and the shared kinds linking to /service go; mentions stay", async () => {
    const e = readEnv({ notify_service: false });
    expect(ids(await list(e))).toEqual([12, 11, 8, 7, 6, 5, 4, 2, 0]);
    expect(await count(e)).toBe(8);
  });

  it("opportunities off: only the shared kinds linking to /opportunities go", async () => {
    const e = readEnv({ notify_opportunities: false });
    expect(ids(await list(e))).toEqual([12, 11, 10, 9, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(await count(e)).toBe(10);
  });

  it("bids off: bid_due and the follow-up linking to /estimate go", async () => {
    const e = readEnv({ notify_bids: false });
    expect(ids(await list(e))).toEqual([12, 11, 10, 9, 8, 6, 4, 3, 2, 1, 0]);
    expect(await count(e)).toBe(10);
  });

  it("leads off (the default): the lead row goes; the storm row stays", async () => {
    const e = readEnv({ notify_leads: false });
    expect(ids(await list(e))).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 3, 2, 1, 0]);
    expect(await count(e)).toBe(10);
  });

  it("storms off (the default): the storm row goes; the lead row stays", async () => {
    const e = readEnv({ notify_storms: false });
    expect(ids(await list(e))).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(await count(e)).toBe(10);
  });

  it("all five off: tasks, mentions and the unplaced follow-ups remain", async () => {
    const e = readEnv({
      notify_leads: false,
      notify_opportunities: false,
      notify_service: false,
      notify_bids: false,
      notify_storms: false,
    });
    expect(ids(await list(e))).toEqual([12, 11, 6, 2]);
    expect(await count(e)).toBe(4);
  });

  it("paging, unreadOnly and the kind filter still work with the exclusion", async () => {
    const e = readEnv({ notify_service: false });
    expect(ids(await list(e, { limit: 3 }))).toEqual([12, 11, 8]);
    expect(
      ids(await list(e, { limit: 3, before: { created_at: ROWS[4]!["created_at"], id: 8 } })),
    ).toEqual([7, 6, 5]);
    expect(ids(await list(e, { unreadOnly: true }))).toEqual([12, 11, 8, 7, 6, 4, 2, 0]);
    // "Assigned" with service off: the opportunity one only.
    expect(ids(await list(e, { kind: "assigned" }))).toEqual([8]);
    expect(ids(await list(e, { kind: ["assigned", "untouched", "ticket_done"] }))).toEqual([8]);
  });

  it("in the source: both functions read the caller's flags and apply the SQL exclusion", () => {
    const src = read("src/lib/notifications.functions.ts");
    const fn = (name: string) => {
      const start = src.indexOf(`export const ${name}`);
      return src.slice(start, src.indexOf("\n  });\n", start));
    };
    for (const name of ["listMyNotifications", "unreadNotificationCount"]) {
      expect(fn(name)).toContain("const off = await myOffCategories(sb, context.userId);");
      expect(fn(name)).toContain("excludeOff(");
    }
    // The caller's own row, the five columns.
    expect(flat(src)).toContain(
      '.from("profiles") .select("notify_leads, notify_opportunities, notify_service, notify_bids, notify_storms") .eq("id", userId) .maybeSingle();',
    );
    // The exclusion itself: kind not in (…), and per link prefix an or() over the shared kinds.
    expect(src).toContain('if (ex.kinds.length) q = q.not("kind", "in", inList(ex.kinds));');
    expect(src).toContain(
      "q = q.or(`kind.not.in.${inList(SHARED_KINDS)},url.is.null,url.not.like.${prefix}%`);",
    );
    // The count stays a head request.
    expect(fn("unreadNotificationCount")).toContain(
      '.select("id", { count: "exact", head: true })',
    );
  });
});

/* ---- the migration ------------------------------------------------------------------------ */

const MIGRATION = "supabase/migrations/20261013170000_notice_categories.sql";

describe(`migration ${MIGRATION}`, () => {
  const sql = flatSql(MIGRATION);
  const fnFrom = (head: string) =>
    sql.slice(sql.indexOf(head), sql.indexOf("$$;", sql.indexOf(head)) + 3);
  const SEVEN =
    "public.set_my_notify_prefs(boolean, boolean, boolean, boolean, boolean, boolean, boolean)";
  const SIX = "public.set_my_notify_prefs(boolean, boolean, boolean, boolean, boolean, boolean)";
  const THREE = "public.set_my_notify_prefs(boolean, boolean, boolean)";

  it("adds three columns default true and notify_storms default false (leads keeps its opt-in column)", () => {
    for (const col of ["notify_opportunities", "notify_service", "notify_bids"])
      expect(sql).toContain(
        `alter table public.profiles add column if not exists ${col} boolean not null default true;`,
      );
    expect(sql).toContain(
      "alter table public.profiles add column if not exists notify_storms boolean not null default false;",
    );
    expect(sql).not.toContain("add column if not exists notify_leads");
    expect(sql.match(/alter table/g)).toHaveLength(4);
    expect(sql).toMatch(
      /comment on column public\.profiles\.notify_opportunities is 'Owner, Oct 13/,
    );
    expect(sql).toMatch(/comment on column public\.profiles\.notify_service is 'Owner, Oct 13/);
    expect(sql).toMatch(/comment on column public\.profiles\.notify_bids is 'Owner, Oct 13/);
    expect(sql).toMatch(
      /comment on column public\.profiles\.notify_storms is 'Owner, Oct 13: storm alerts [^']*off by default';/,
    );
  });

  it("set_my_notify_prefs takes the seven switches (the caller's own row, null keeps a column); the six-argument first cut is dropped first", () => {
    const drop = sql.indexOf(`drop function if exists ${SIX};`);
    const create = sql.indexOf(
      "create or replace function public.set_my_notify_prefs( p_email boolean",
    );
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
    const fn = fnFrom("create or replace function public.set_my_notify_prefs( p_email boolean");
    expect(fn).toMatch(
      /^create or replace function public\.set_my_notify_prefs\( p_email boolean, p_push boolean, p_leads boolean, p_opportunities boolean, p_service boolean, p_bids boolean, p_storms boolean\) returns table \( notify_email boolean, notify_push boolean, notify_leads boolean, notify_opportunities boolean, notify_service boolean, notify_bids boolean, notify_storms boolean\) language plpgsql security definer set search_path = public as \$\$/,
    );
    expect(fn).toContain("if auth.uid() is null then raise exception 'Not signed in'");
    expect(fn).toContain(
      "set notify_email = coalesce(p_email, p.notify_email), notify_push = coalesce(p_push, p.notify_push), notify_leads = coalesce(p_leads, p.notify_leads), notify_opportunities = coalesce(p_opportunities, p.notify_opportunities), notify_service = coalesce(p_service, p.notify_service), notify_bids = coalesce(p_bids, p.notify_bids), notify_storms = coalesce(p_storms, p.notify_storms) where p.id = auth.uid()",
    );
    expect(fn).toContain(
      "returning p.notify_email, p.notify_push, p.notify_leads, p.notify_opportunities, p.notify_service, p.notify_bids, p.notify_storms into v_email, v_push, v_leads, v_opportunities, v_service, v_bids, v_storms;",
    );
    expect(fn).not.toMatch(/\b(role|access|technician)\s*=/);
    expect(fn.match(/\bupdate\b/g)).toHaveLength(1);
    expect(fn).toContain("if not found then raise exception");
    expect(fn).toContain("notify_storms := v_storms; return next;");
    expect(sql).toContain(`revoke all on function ${SEVEN} from public;`);
    expect(sql).toContain(`revoke all on function ${SEVEN} from anon;`);
    expect(sql).toContain(`grant execute on function ${SEVEN} to authenticated;`);
    // The six-argument form is only ever dropped: never created, never granted.
    expect(sql).not.toContain(`grant execute on function ${SIX}`);
    expect(sql).not.toContain("p_bids boolean) returns");
  });

  it("the three-argument form keeps working as a wrapper (same return type, new switches untouched)", () => {
    const fn = fnFrom(
      "create or replace function public.set_my_notify_prefs(p_email boolean, p_push boolean, p_leads boolean) returns table (notify_email boolean, notify_push boolean, notify_leads boolean)",
    );
    expect(fn).toContain(
      "return query select r.notify_email, r.notify_push, r.notify_leads from public.set_my_notify_prefs(p_email, p_push, p_leads, null::boolean, null::boolean, null::boolean, null::boolean) as r;",
    );
    expect(fn).not.toContain("update ");
    expect(sql).toContain(`revoke all on function ${THREE} from public;`);
    expect(sql).toContain(`revoke all on function ${THREE} from anon;`);
    expect(sql).toContain(`grant execute on function ${THREE} to authenticated;`);
  });

  it("notify_recipients returns the five switches: dropped and created again, same rule, same grants", () => {
    expect(sql).toContain("drop function if exists public.notify_recipients(uuid[]);");
    const fn = fnFrom("create function public.notify_recipients(ids uuid[])");
    expect(fn).toMatch(
      /^create function public\.notify_recipients\(ids uuid\[\]\) returns table \( id uuid, email text, full_name text, notify_email boolean, notify_push boolean, notify_leads boolean, notify_opportunities boolean, notify_service boolean, notify_bids boolean, notify_storms boolean\) language sql stable security definer set search_path = public as \$\$ select p\.id, p\.email, p\.full_name, p\.notify_email, p\.notify_push, p\.notify_leads, p\.notify_opportunities, p\.notify_service, p\.notify_bids, p\.notify_storms from public\.profiles p where p\.id = any\(ids\) and \(auth\.role\(\) = 'service_role' or auth\.uid\(\) is not null\); \$\$;$/,
    );
    expect(sql).toContain("revoke all on function public.notify_recipients(uuid[]) from public;");
    expect(sql).toContain("revoke all on function public.notify_recipients(uuid[]) from anon;");
    expect(sql).toContain(
      "grant execute on function public.notify_recipients(uuid[]) to authenticated, service_role;",
    );
  });

  it("touches nothing else: no policies, two drops only, lead_notice_user_ids and the two-argument form alone", () => {
    expect(sql).not.toContain("lead_notice_user_ids");
    expect(sql).not.toContain("prospect_user_ids");
    expect(sql).not.toContain("set_my_notify_prefs(p_email boolean, p_push boolean)");
    expect(sql).not.toMatch(/\bcreate policy\b|\bdrop policy\b|\bdrop table\b|\bdrop column\b/i);
    // The six-argument first cut of set_my_notify_prefs, and notify_recipients.
    expect(sql.match(/\bdrop function\b/g)).toHaveLength(2);
    expect(sql.match(/create or replace function/g)).toHaveLength(2);
    expect(sql.match(/create function/g)).toHaveLength(1);
  });

  it("is typed: the profiles rows and the two functions", () => {
    const types = read("src/integrations/supabase/types.ts");
    const profiles = types.slice(
      types.indexOf("      profiles: {"),
      types.indexOf("      push_subscriptions: {"),
    );
    for (const col of ["notify_opportunities", "notify_service", "notify_bids", "notify_storms"]) {
      expect(profiles.match(new RegExp(`${col}: boolean;`, "g"))).toHaveLength(1);
      expect(profiles.match(new RegExp(`${col}\\?: boolean;`, "g"))).toHaveLength(2);
    }
    expect(flat(types)).toContain(
      "set_my_notify_prefs: { Args: { p_email: boolean | null; p_push: boolean | null; p_leads: boolean | null; p_opportunities: boolean | null; p_service: boolean | null; p_bids: boolean | null; p_storms: boolean | null; }; Returns: { notify_email: boolean; notify_push: boolean; notify_leads: boolean; notify_opportunities: boolean; notify_service: boolean; notify_bids: boolean; notify_storms: boolean; }[]; };",
    );
    expect(flat(types)).toContain(
      "notify_recipients: { Args: { ids: string[] }; Returns: { email: string; full_name: string | null; id: string; notify_email: boolean; notify_push: boolean; notify_leads: boolean; notify_opportunities: boolean; notify_service: boolean; notify_bids: boolean; notify_storms: boolean; }[]; };",
    );
  });
});

/* ---- the prefs functions ------------------------------------------------------------------ */

/** set_my_notify_prefs(seven) as the fake sees it: the caller's row only, null keeps a column. */
const setMyNotifyPrefs =
  (uid: string): FakeRpc =>
  (args, tables) => {
    const row = (tables["profiles"] ?? []).find((p) => p["id"] === uid);
    if (!row) return [];
    const map = {
      p_email: "notify_email",
      p_push: "notify_push",
      p_leads: "notify_leads",
      p_opportunities: "notify_opportunities",
      p_service: "notify_service",
      p_bids: "notify_bids",
      p_storms: "notify_storms",
    } as const;
    for (const [arg, col] of Object.entries(map)) if (args[arg] !== null) row[col] = args[arg];
    return [
      {
        notify_email: row["notify_email"],
        notify_push: row["notify_push"],
        notify_leads: row["notify_leads"] ?? false,
        notify_opportunities: row["notify_opportunities"] ?? true,
        notify_service: row["notify_service"] ?? true,
        notify_bids: row["notify_bids"] ?? true,
        notify_storms: row["notify_storms"] ?? false,
      },
    ];
  };

function prefsEnv(
  profile: Row,
  rpcs: Record<string, FakeRpc> = { set_my_notify_prefs: setMyNotifyPrefs(ME) },
) {
  const e = fakeSupabase({ profiles: [{ id: ME, ...profile }], push_subscriptions: [] }, { rpcs });
  const call = <T>(fn: unknown, data?: unknown) =>
    (fn as (a: unknown) => Promise<T>)({ data, context: { supabase: e.db, userId: ME } });
  return { ...e, call };
}
const NOT_SAVED = "Your notification settings were not saved. Please try again.";
/** The seven rpc arguments, every one null (unchanged) but those given. */
const args = (over: Record<string, boolean>) => ({
  p_email: null,
  p_push: null,
  p_leads: null,
  p_opportunities: null,
  p_service: null,
  p_bids: null,
  p_storms: null,
  ...over,
});

describe("the prefs functions carry the five categories", () => {
  it("getNotifyPrefs: leads and storms off unless true; the other three on unless false", async () => {
    const bare = prefsEnv({ notify_email: true, notify_push: false });
    await expect(bare.call(getNotifyPrefs)).resolves.toEqual({
      notify_email: true,
      notify_push: false,
      notify_leads: false,
      notify_opportunities: true,
      notify_service: true,
      notify_bids: true,
      notify_storms: false,
      devices: 0,
    });
    const some = prefsEnv({
      notify_email: true,
      notify_push: true,
      notify_leads: true,
      notify_opportunities: null,
      notify_service: false,
      notify_bids: false,
      notify_storms: true,
    });
    await expect(some.call(getNotifyPrefs)).resolves.toMatchObject({
      notify_leads: true,
      notify_opportunities: true,
      notify_service: false,
      notify_bids: false,
      notify_storms: true,
    });
    const nulled = prefsEnv({ notify_email: true, notify_push: true, notify_storms: null });
    await expect(nulled.call(getNotifyPrefs)).resolves.toMatchObject({ notify_storms: false });
  });

  it("setNotifyPrefs saves one switch through the seven-argument rpc, the rest null (unchanged)", async () => {
    const e = prefsEnv({ notify_email: true, notify_push: true, notify_leads: false });
    await expect(e.call(setNotifyPrefs, { notify_service: false })).resolves.toEqual({
      notify_email: true,
      notify_push: true,
      notify_leads: false,
      notify_opportunities: true,
      notify_service: false,
      notify_bids: true,
      notify_storms: false,
    });
    await e.call(setNotifyPrefs, { notify_bids: false });
    await e.call(setNotifyPrefs, { notify_opportunities: false });
    await e.call(setNotifyPrefs, { notify_storms: true });
    await e.call(setNotifyPrefs, { notify_service: true, notify_leads: true });
    expect(e.rpcCalls.map((c) => c.args)).toEqual([
      args({ p_service: false }),
      args({ p_bids: false }),
      args({ p_opportunities: false }),
      args({ p_storms: true }),
      args({ p_leads: true, p_service: true }),
    ]);
    expect(e.rpcCalls.every((c) => c.fn === "set_my_notify_prefs")).toBe(true);
    expect(e.writes.filter((w) => w.table === "profiles")).toEqual([]);
    expect(e.tables["profiles"]![0]).toMatchObject({
      notify_email: true,
      notify_push: true,
      notify_leads: true,
      notify_opportunities: false,
      notify_service: true,
      notify_bids: false,
      notify_storms: true,
    });
  });

  it("a save that did not land on the new switch is an error, not a silent success", async () => {
    const old = prefsEnv(
      { notify_email: true, notify_push: true },
      {
        // The three-argument function's answer (the migration not applied yet).
        set_my_notify_prefs: () => [{ notify_email: true, notify_push: true, notify_leads: false }],
      },
    );
    await expect(old.call(setNotifyPrefs, { notify_bids: false })).rejects.toThrow(NOT_SAVED);
    await expect(old.call(setNotifyPrefs, { notify_service: true })).rejects.toThrow(NOT_SAVED);
    await expect(old.call(setNotifyPrefs, { notify_storms: true })).rejects.toThrow(NOT_SAVED);
    // The old switches still save through it.
    await expect(old.call(setNotifyPrefs, { notify_email: true })).resolves.toMatchObject({
      notify_email: true,
      notify_bids: true,
      notify_storms: false,
    });
  });
});

/* ---- the Account page ---------------------------------------------------------------------- */

describe("the Account page's Notifications card", () => {
  const src = read("src/routes/account.tsx");
  const card = src.slice(src.indexOf("function NotificationsCard()"));

  it("has the five switches from the pure module, in its order (storms last), under the two channel switches and above This device", () => {
    expect(src).toContain('} from "@/lib/notice-categories";');
    for (const name of [
      "NOTICE_CATEGORIES",
      "NOTICE_CATEGORY_COLUMNS",
      "NOTICE_CATEGORY_HELP",
      "NOTICE_CATEGORY_LABELS",
    ])
      expect(src).toContain(`  ${name},\n`);
    const email = card.indexOf('id="notify-email"');
    const push = card.indexOf('id="notify-push"');
    const heading = card.indexOf("Which notices you get");
    const five = card.indexOf("{NOTICE_CATEGORIES.map((category) => {");
    const device = card.indexOf('<p className="text-sm font-medium">This device</p>');
    expect(email).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(email);
    expect(heading).toBeGreaterThan(push);
    expect(five).toBeGreaterThan(heading);
    expect(device).toBeGreaterThan(five);
    // The map renders one switch per category: five, leads first, storms last.
    expect(NOTICE_CATEGORIES).toHaveLength(5);
    expect(NOTICE_CATEGORIES[0]).toBe("leads");
    expect(NOTICE_CATEGORIES[4]).toBe("storms");
    expect(NOTICE_CATEGORY_LABELS.storms).toBe("Storm alerts");
    expect(flat(card)).toContain(
      '<Label htmlFor={`notify-${category}`}> {NOTICE_CATEGORY_LABELS[category]} </Label> <p className="text-xs text-muted-foreground"> {NOTICE_CATEGORY_HELP[category]} </p>',
    );
    expect(flat(card)).toContain(
      "<Switch id={`notify-${category}`} checked={p?.[column] ?? false} disabled={!p} onCheckedChange={(v) => save.mutate({ [column]: v })} />",
    );
    expect(card).toContain("const column = NOTICE_CATEGORY_COLUMNS[category];");
    // The old single switch is gone; the labels and help come from the module, not the page.
    expect(card).not.toContain('id="notify-leads"');
    for (const c of NOTICE_CATEGORIES) {
      expect(card).not.toContain(NOTICE_CATEGORY_LABELS[c]);
      expect(card).not.toContain(NOTICE_CATEGORY_HELP[c]);
    }
    // Still one save path: the two channel switches and the map.
    expect(card.match(/save\.mutate\(/g)).toHaveLength(3);
  });

  it("the prefs type follows the server's, and a save re-reads the bell", () => {
    expect(src).toContain("type Prefs = NotifyPrefs & { devices: number };");
    expect(src).toContain("type PrefsPatch = Partial<NotifyPrefs>;");
    expect(card).toContain("mutationFn: (patch: PrefsPatch) => setFn({ data: patch }),");
    const save = card
      .slice(card.indexOf("const save = useMutation({"), card.indexOf("// Push on THIS device"))
      .replace(/^\s*\/\/[^\n]*$/gm, "");
    expect(flat(save)).toContain(
      "onSettled: () => { void qc.invalidateQueries({ queryKey: PREFS_KEY }); void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }); },",
    );
    expect(src).toContain(
      'import { NOTIFICATIONS_QUERY_KEY } from "@/components/notifications-bell";',
    );
    // The unread count's key lives under the list's, so that one invalidation covers both.
    const bell = read("src/components/notifications-bell.tsx");
    expect(bell).toContain('export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;');
    expect(bell).toContain(
      'export const UNREAD_COUNT_QUERY_KEY = ["notifications", "unread-count"] as const;',
    );
  });
});
