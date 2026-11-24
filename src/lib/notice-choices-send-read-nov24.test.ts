/**
 * Which notices, one by one (owner, Nov 24: "Option A on notifications plz"): the sender, the
 * inbox reads and the save, run for real against the stand-in client.
 *
 *   1. notify() leaves out a person who unticked that notice type: no inbox row, no email, no
 *      push. Everybody else gets it as before. A switch that is off still wins.
 *   2. listMyNotifications and unreadNotificationCount leave out the same rows, in SQL: for every
 *      spread of switches and ticks they answer exactly the rows takesNotice keeps.
 *   3. Before the migration is applied (no notify_off anywhere): the sender, the inbox, the page's
 *      read and the five switches all work as they did; only a tick cannot be saved, and says so.
 *   4. getNotifyOff / setNotifyOff: the caller's own list, through set_my_notify_off, known keys
 *      only, checked against what came back.
 */
import { readFileSync } from "node:fs";
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
  getNotifyOff,
  getNotifyPrefs,
  setNotifyOff,
  setNotifyPrefs,
} from "@/lib/followups.functions";
import { NOTICE_CATEGORIES, NOTICE_CATEGORY_COLUMNS } from "@/lib/notice-categories";
import {
  NOTICE_CHOICES_NOT_READY,
  NOTICE_CHOICES_NOT_SAVED,
  NOTICE_TYPE_KEYS,
  takesNotice,
  type NoticePrefs,
} from "@/lib/notice-types";
import { listMyNotifications, unreadNotificationCount } from "@/lib/notifications.functions";
import { notify, type Client } from "@/lib/notify.server";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");

/* ---- 1. the send --------------------------------------------------------------------------- */

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // everything on, nothing unticked
const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // unticked Scheduled and ticket Reminders
const TECH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // the Service switch off, ticks all on
const SALES = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // unticked every tick there is

const person = (id: string, extra: Row): Row => ({
  id,
  email: `${id.slice(0, 4)}@example.com`,
  full_name: id.slice(0, 4),
  notify_email: true,
  notify_push: true,
  ...extra,
});
const PEOPLE: Row[] = [
  person(OWNER, {}),
  person(MANAGER, { notify_off: ["service_scheduled", "service_reminders"] }),
  person(TECH, { notify_service: false }),
  person(SALES, { notify_off: [...NOTICE_TYPE_KEYS] }),
];
const EVERYONE = [OWNER, MANAGER, TECH, SALES];

/** notify_recipients(ids) as 20261124700000 has it: the Oct 13 columns and notify_off. */
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
      notify_off: p["notify_off"] ?? [],
    }));
/** The same read before the migration: the Oct 13 columns only. */
const recipientsBefore: FakeRpc = (args, tables) =>
  (recipients(args, tables) as Row[]).map((r) => {
    const row = { ...r };
    delete row["notify_off"];
    return row;
  });

function sendEnv(rpc: FakeRpc = recipients) {
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
    { rpcs: { notify_recipients: rpc } },
  );
  holder.db = e.db;
  return e;
}
const inbox = (e: ReturnType<typeof sendEnv>) =>
  (e.tables["notifications"] ?? []).map((r) => r["user_id"]).sort();
let fetchMock: ReturnType<typeof vi.fn>;
const emailed = () =>
  fetchMock.mock.calls
    .map((c) => JSON.parse(String((c as [string, RequestInit])[1].body)) as { to: string[] })
    .flatMap((b) => b.to)
    .sort();
const pushed = () =>
  pushMock.mock.calls.map((c) => (c as unknown as [{ endpoint: string }])[0].endpoint).sort();
const emailOf = (id: string) => `${id.slice(0, 4)}@example.com`;
const endpointOf = (id: string) =>
  `https://push.example/${PEOPLE.findIndex((p) => p["id"] === id)}`;
const T = "/service?id=t12";
const step = (start: string) => ({
  kind: "ticket_watch",
  title: `${start}: Ticket #12 Acme — Leak at the drain`,
  body: "Sam did it.",
  url: T,
});

describe("notify() leaves out a person who unticked that notice type", () => {
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

  it("the owner's example: Scheduled unticked. No row, no email, no push for that one step", async () => {
    const e = sendEnv();
    expect(await notify(EVERYONE, step("Scheduled"), e.db as Client)).toBe(1);
    // The manager unticked it, the technician's switch is off, sales unticked everything.
    expect(inbox(e)).toEqual([OWNER]);
    expect(emailed()).toEqual([emailOf(OWNER)]);
    expect(pushed()).toEqual([endpointOf(OWNER)]);
  });

  it("the same manager still hears Opened and Closed", async () => {
    for (const start of ["Opened", "Closed"]) {
      const e = sendEnv();
      fetchMock.mockClear();
      pushMock.mockClear();
      expect(await notify(EVERYONE, step(start), e.db as Client)).toBe(2);
      expect(inbox(e)).toEqual([OWNER, MANAGER].sort());
      expect(emailed()).toEqual([emailOf(OWNER), emailOf(MANAGER)].sort());
      expect(pushed()).toEqual([endpointOf(OWNER), endpointOf(MANAGER)].sort());
    }
  });

  it("a reminder is told apart by where it opens: the ticket one is left out, the opportunity one sent", async () => {
    const ticket = sendEnv();
    await notify(
      [OWNER, MANAGER],
      { kind: "followup", title: "Ticket #12 is due tomorrow", url: T },
      ticket.db as Client,
    );
    expect(inbox(ticket)).toEqual([OWNER]);
    const opp = sendEnv();
    await notify(
      [OWNER, MANAGER],
      { kind: "followup", title: "New roof is due tomorrow", url: "/opportunities?id=o1" },
      opp.db as Client,
    );
    expect(inbox(opp)).toEqual([OWNER, MANAGER].sort());
  });

  it("what is under no switch reaches everyone, even the one who unticked everything", async () => {
    for (const msg of [
      { kind: "mention", title: "Sam mentioned you", url: T },
      { kind: "task", title: "New task", url: "/my-work" },
      { kind: "test", title: "Test notification", url: "/account" },
      // Nov 24, later the same day: a request from the public pages and the Roof Care plan
      // notices are under a switch now, each with a tick (the owner: "wouldnt those both be
      // under opportunities?"), so they are no longer in this list.
    ]) {
      const e = sendEnv();
      expect(await notify(EVERYONE, msg, e.db as Client), msg.kind).toBe(4);
    }
  });

  it("never one more: for every notice, the people told are among those the old rule told", async () => {
    const kinds = [
      step("Opened"),
      step("Scheduled"),
      step("Deleted"),
      { kind: "ticket_done", title: "Ticket #12 is done", url: T },
      { kind: "assigned", title: "Assigned to you: Ticket #12", url: T },
      { kind: "bid_due", title: "Bid due tomorrow", url: "/estimate?bid=b1" },
      { kind: "opportunity_watch", title: "Won: New roof", url: "/opportunities?id=o1" },
      { kind: "lead", title: "3 new leads", url: "/prospect/leads" },
    ];
    for (const msg of kinds) {
      const old = sendEnv(recipientsBefore);
      await notify(EVERYONE, msg, old.db as Client);
      const now = sendEnv();
      await notify(EVERYONE, msg, now.db as Client);
      const told = inbox(now);
      for (const id of told) expect(inbox(old), msg.title).toContain(id);
      expect(told.length).toBeLessThanOrEqual(inbox(old).length);
    }
  });

  it("before the migration (the read hands back no notify_off): exactly as it was", async () => {
    const e = sendEnv(recipientsBefore);
    // Everybody whose Service switch is on, ticks or no ticks: the column is not there to read.
    expect(await notify(EVERYONE, step("Scheduled"), e.db as Client)).toBe(3);
    expect(inbox(e)).toEqual([OWNER, MANAGER, SALES].sort());
    expect(e.rpcCalls.filter((c) => c.fn === "notify_recipients")).toEqual([
      { fn: "notify_recipients", args: { ids: EVERYONE } },
    ]);
  });

  it("in the source: one read, one rule, and only the reading and the filtering changed", () => {
    const src = read("src/lib/notify.server.ts");
    const fn = src.slice(
      src.indexOf("export async function notify("),
      src.indexOf("export type FollowupRow"),
    );
    expect(fn).toContain('await databaseRpc(admin)("notify_recipients", {');
    expect(fn).toContain("const people = (everyone ?? []).filter((p) => takesNotice(p, msg));");
    expect(fn.match(/takesNotice\(/g)).toHaveLength(1);
    // The row that is written carries the same kind, title and link the rule was asked about.
    expect(fn).toContain("kind: msg.kind,");
    expect(fn).toContain("title: msg.title,");
    expect(fn).toContain("url: msg.url ?? null,");
  });
});

/* ---- 2. the reads --------------------------------------------------------------------------- */

const ME = "ffffffff-ffff-4fff-8fff-ffffffffffff";
let nextId = 0;
const nrow = (kind: string, url: string | null, title: string, extra: Row = {}): Row => {
  const id = ++nextId;
  return {
    id,
    user_id: ME,
    kind,
    title,
    body: null,
    url,
    followup_id: null,
    // A minute apart, oldest first.
    created_at: `2026-11-20T09:${String(id).padStart(2, "0")}:00+00:00`,
    read_at: null,
    email_sent_at: null,
    email_error: null,
    push_sent_at: null,
    push_error: null,
    ...extra,
  };
};
const O = "/opportunities?id=o1";
/** One row of every notice a tick can name, and the ones no tick can. Oldest first. */
const ROWS: Row[] = [
  nrow("ticket_watch", T, "Opened: Ticket #12 Acme"),
  nrow("ticket_watch", "/service", "3 Roof Care plan inspection tickets opened"),
  nrow("assigned", T, "Assigned to you: Ticket #12 Acme"),
  nrow("reassigned", T, "Ticket #12 was reassigned"),
  nrow("ticket_watch", T, "Reassigned: Ticket #12 Acme"),
  nrow("ticket_watch", T, "Assigned: Ticket #12 Acme"),
  nrow("ticket_watch", T, "Unassigned: Ticket #12 Acme"),
  nrow("ticket_watch", T, "Scheduled: Ticket #12 Acme", { read_at: "2026-11-08T10:00:00Z" }),
  nrow("date_moved", T, "Ticket #12 moved to Friday, Nov 27, 2026"),
  nrow("ticket_watch", T, "Date set: Ticket #12 Acme"),
  nrow("ticket_watch", T, "Date moved: Ticket #12 Acme"),
  nrow("followup", T, "Ticket #12 is due tomorrow"),
  nrow("reminder", T, "An older reminder"),
  nrow("untouched", T, "Not started: Ticket #12"),
  nrow("ticket_unassigned", T, "Nobody on Ticket #12"),
  nrow("ticket_done", T, "Ticket #12 is done, ready for your review"),
  nrow("ticket_watch", T, "Authorized: Ticket #12 Acme"),
  nrow("ticket_authorized", T, "Ticket #12 authorized — ready to invoice"),
  nrow("ready_to_invoice", T, "An older ready to invoice"),
  nrow("ticket_watch", T, "Invoiced: Ticket #12 Acme"),
  nrow("ticket_watch", T, "Closed: Ticket #12 Acme", { read_at: "2026-11-21T10:00:00Z" }),
  nrow("ticket_watch", T, "Reopened: Ticket #12 Acme"),
  nrow("ticket_watch", T, "Back to Open: Ticket #12 Acme"),
  nrow("ticket_watch", T, "Deleted: Ticket #12 Acme"),
  nrow("ticket_watch", T, "On hold: a step no tick names"),
  nrow("ticket_watch", T, "opened: capitals matter"),
  nrow("assigned", O, "Opportunity assigned to you: New roof"),
  nrow("followup", O, "New roof is due tomorrow"),
  nrow("untouched", O, "No contact logged: New roof"),
  nrow("opportunity_unassigned", O, "Nobody on New roof"),
  nrow("opportunity_watch", O, "Opened: New roof"),
  // Nov 24, later the same day: the four ticks the owner added.
  nrow("opportunity_new", O, "Opened: Another roof"),
  nrow("public_request", O, "Service request from the public page: Acme"),
  nrow("plan_expired", "/properties/p1", "Guard plan expired: Acme"),
  nrow("care_no_access", T, "No access for a Guard inspection: Acme"),
  nrow("bid_due", "/estimate?bid=b1", "Bid due tomorrow: Acme"),
  nrow("bid_overdue", "/trade-bids?bid=b2", "Bid past due: Gutters"),
  nrow("bid_reminder", "/estimate?bid=b1", "Bid reminder: Acme"),
  nrow("bid_watch", "/estimate?bid=b1", "Started: Bid Acme"),
  nrow("followup", "/estimate?bid=b1", "A bid follow-up no tick names"),
  nrow("lead", "/prospect/leads?roof=1", "3 new leads"),
  nrow("storm", "/prospect?storm=1", "Hail in Jefferson County"),
  nrow("task", "/my-work", "New task: Opened: not a ticket step"),
  nrow("mention", T, "Scheduled: said in a mention"),
  nrow("public_request", O, "Service request from the public page: Acme"),
  nrow("plan_expired", "/properties/p1", "Guard plan expired: Acme"),
  nrow("followup", null, "A reminder with no link"),
];
const ids = (rows: Row[]) => rows.map((r) => r["id"] as number);
/** What the rule keeps, newest first, as the server orders the inbox. */
const kept = (prefs: NoticePrefs) =>
  ROWS.filter((r) =>
    takesNotice(prefs, {
      kind: r["kind"] as string,
      url: r["url"] as string | null,
      title: r["title"] as string,
    }),
  ).reverse();

/** A profiles select that names notify_off, on a database that does not have it yet. */
const noColumn = {
  data: null,
  error: { code: "42703", message: "column profiles.notify_off does not exist" },
};
function withoutNotifyOff<T extends { from: (t: string) => unknown }>(db: T): T {
  return {
    ...db,
    from: (table: string) => {
      const b = db.from(table) as { select: (c?: string, o?: unknown) => unknown };
      if (table !== "profiles") return b;
      return {
        ...b,
        select: (c?: string, o?: unknown) => {
          if (!(c ?? "").includes("notify_off")) return b.select(c, o);
          const failed = {
            eq: () => failed,
            maybeSingle: async () => noColumn,
            then: (res: (v: typeof noColumn) => unknown) => Promise.resolve(noColumn).then(res),
          };
          return failed;
        },
      };
    },
  } as T;
}

function readEnv(profile: Row | null, opts: { migrated?: boolean } = {}) {
  const e = fakeSupabase({
    profiles: profile ? [{ id: ME, ...profile }] : [],
    notifications: [...ROWS].reverse().map((r) => ({ ...r })),
    push_subscriptions: [],
  });
  const db = opts.migrated === false ? withoutNotifyOff(e.db) : e.db;
  const call = <T>(fn: unknown, data?: unknown) =>
    (fn as (a: unknown) => Promise<T>)({ data, context: { supabase: db, userId: ME } });
  return { ...e, call };
}
const list = (e: ReturnType<typeof readEnv>, data: unknown = { limit: 200 }) =>
  e.call<Row[]>(listMyNotifications, data);
const count = (e: ReturnType<typeof readEnv>) => e.call<number>(unreadNotificationCount);
const unread = (rows: Row[]) => rows.filter((r) => r["read_at"] === null).length;

describe("the bell and the inbox leave out the rows of an unticked notice type", () => {
  it("nothing unticked: every row, as before", async () => {
    const e = readEnv({ notify_leads: true, notify_storms: true, notify_off: [] });
    expect(ids(await list(e))).toEqual(ids([...ROWS].reverse()));
    expect(await count(e)).toBe(unread(ROWS));
  });

  it("the owner's example: Scheduled unticked hides the Scheduled step only", async () => {
    const prefs = { notify_leads: true, notify_storms: true, notify_off: ["service_scheduled"] };
    const e = readEnv(prefs);
    const got = await list(e);
    const gone = ROWS.filter((r) => !ids(got).includes(r["id"] as number));
    expect(gone.map((r) => r["title"])).toEqual(["Scheduled: Ticket #12 Acme"]);
    // A mention that happens to start "Scheduled:" is not a ticket step: it stays.
    expect(got.map((r) => r["title"])).toContain("Scheduled: said in a mention");
    // The hidden row was read already, so the count does not move.
    expect(await count(e)).toBe(unread(ROWS));
  });

  it("Opened unticked: both ways the site says it, and nothing that only looks like it", async () => {
    const e = readEnv({ notify_leads: true, notify_storms: true, notify_off: ["service_opened"] });
    const got = (await list(e)).map((r) => r["title"]);
    expect(got).not.toContain("Opened: Ticket #12 Acme");
    expect(got).not.toContain("3 Roof Care plan inspection tickets opened");
    expect(got).toContain("Reopened: Ticket #12 Acme");
    expect(got).toContain("opened: capitals matter");
    expect(got).toContain("Opened: New roof"); // an opportunity's step: another tick
    expect(got).toContain("New task: Opened: not a ticket step");
    expect(await count(e)).toBe(unread(ROWS) - 2);
  });

  it("each tick alone hides exactly the rows the rule drops, list and count", async () => {
    for (const key of NOTICE_TYPE_KEYS) {
      const prefs = { notify_leads: true, notify_storms: true, notify_off: [key] };
      const e = readEnv(prefs);
      const want = kept(prefs);
      expect(ids(await list(e)), key).toEqual(ids(want));
      expect(await count(e), key).toBe(unread(want));
      // Every tick has at least one row here, so each one is really tried.
      expect(want.length, key).toBeLessThan(ROWS.length);
    }
  });

  it("every spread of switches with a mix of ticks: the SQL and the rule never disagree", async () => {
    const mixes: string[][] = [
      [...NOTICE_TYPE_KEYS],
      NOTICE_TYPE_KEYS.filter((_, i) => i % 2 === 0),
      NOTICE_TYPE_KEYS.filter((_, i) => i % 2 === 1),
      ["service_reminders", "opportunities_follow_up", "bids_steps", "service_moved_back"],
    ];
    for (let n = 0; n < 32; n++) {
      const flags = Object.fromEntries(
        NOTICE_CATEGORIES.map((c, i) => [NOTICE_CATEGORY_COLUMNS[c], ((n >> i) & 1) === 1]),
      );
      for (const notify_off of mixes) {
        const prefs = { ...flags, notify_off } as NoticePrefs & Row;
        const e = readEnv(prefs);
        const want = kept(prefs);
        expect(ids(await list(e)), `${n} ${notify_off.length}`).toEqual(ids(want));
        expect(await count(e), `${n} ${notify_off.length}`).toBe(unread(want));
      }
    }
  });

  it("a switch that is off hides all of its rows whatever the ticks say; ticking back shows them", async () => {
    const off = readEnv({ notify_service: false, notify_off: [] });
    const titles = (await list(off)).map((r) => r["title"]);
    expect(titles).not.toContain("Opened: Ticket #12 Acme");
    expect(titles).not.toContain("On hold: a step no tick names");
    expect(titles).toContain("Scheduled: said in a mention");
    const back = readEnv({ notify_service: true, notify_off: [] });
    expect((await list(back)).map((r) => r["title"])).toContain("Opened: Ticket #12 Acme");
  });

  it("paging, unread only and the kind filter still work with a tick off", async () => {
    const prefs = { notify_leads: true, notify_storms: true, notify_off: ["service_closed"] };
    const e = readEnv(prefs);
    const want = kept(prefs);
    expect(ids(await list(e, { limit: 5 }))).toEqual(ids(want.slice(0, 5)));
    const fifth = want[4]!;
    expect(
      ids(
        await list(e, {
          limit: 5,
          before: { created_at: fifth["created_at"], id: fifth["id"] },
        }),
      ),
    ).toEqual(ids(want.slice(5, 10)));
    expect(ids(await list(e, { limit: 200, unreadOnly: true }))).toEqual(
      ids(want.filter((r) => r["read_at"] === null)),
    );
    expect(ids(await list(e, { limit: 200, kind: "ticket_watch" }))).toEqual(
      ids(want.filter((r) => r["kind"] === "ticket_watch")),
    );
  });

  it("in the source: both reads ask the one rule's SQL form", () => {
    const src = read("src/lib/notifications.functions.ts");
    expect(src).toContain("const ex = noticeFilters(prefs);");
    expect(src).toContain("for (const rule of ex.rules) q = q.or(noticeRuleFilter(rule));");
    expect(src.match(/const off = await myNoticePrefs\(sb, context\.userId\);/g)).toHaveLength(2);
    // The function itself and its two callers: the list and the count.
    expect(src.match(/excludeOff[<(]/g)).toHaveLength(3);
  });
});

/* ---- 3. before the migration is applied ------------------------------------------------------ */

describe("a database that does not have notify_off yet", () => {
  it("the inbox still reads, and the five switches still hide what they hid", async () => {
    const on = readEnv({ notify_leads: true, notify_storms: true }, { migrated: false });
    expect(ids(await list(on))).toEqual(ids([...ROWS].reverse()));
    expect(await count(on)).toBe(unread(ROWS));
    const prefs = { notify_service: false, notify_bids: false };
    const off = readEnv(prefs, { migrated: false });
    const want = kept(prefs);
    expect(want.length).toBeLessThan(ROWS.length);
    expect(ids(await list(off))).toEqual(ids(want));
    expect(await count(off)).toBe(unread(want));
  });

  it("a row with no notify_off at all (the column there, the key missing) turns nothing off", async () => {
    const e = readEnv({ notify_leads: true, notify_storms: true });
    expect(ids(await list(e))).toEqual(ids([...ROWS].reverse()));
  });

  it("the page's reads: the list is empty, the switches read as before", async () => {
    const e = readEnv(
      { role: "user", access: [], notify_email: true, notify_push: false, notify_service: false },
      { migrated: false },
    );
    await expect(e.call(getNotifyOff)).resolves.toEqual({ notify_off: [] });
    await expect(e.call(getNotifyPrefs)).resolves.toEqual({
      notify_email: true,
      notify_push: false,
      notify_leads: false,
      notify_opportunities: true,
      notify_service: false,
      notify_bids: true,
      notify_storms: false,
      devices: 0,
    });
  });

  it("a switch still saves; a tick says plainly that it could not be saved yet", async () => {
    const missing = {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.set_my_notify_off" },
    };
    const e = fakeSupabase(
      { profiles: [{ id: ME, notify_email: true, notify_push: true, notify_service: true }] },
      {
        rpc: (fn) => (fn === "set_my_notify_off" ? missing : undefined),
        rpcs: {
          set_my_notify_prefs: (args, tables) => {
            const row = tables["profiles"]![0]!;
            if (args["p_service"] !== null) row["notify_service"] = args["p_service"];
            return [
              {
                notify_email: true,
                notify_push: true,
                notify_leads: false,
                notify_opportunities: true,
                notify_service: row["notify_service"],
                notify_bids: true,
                notify_storms: false,
              },
            ];
          },
        },
      },
    );
    const call = <T>(fn: unknown, data?: unknown) =>
      (fn as (a: unknown) => Promise<T>)({ data, context: { supabase: e.db, userId: ME } });
    await expect(call(setNotifyPrefs, { notify_service: false })).resolves.toMatchObject({
      notify_service: false,
    });
    await expect(call(setNotifyOff, { off: ["service_scheduled"] })).rejects.toThrow(
      NOTICE_CHOICES_NOT_READY,
    );
    expect(e.tables["profiles"]![0]!["notify_off"]).toBeUndefined();
  });
});

/* ---- 4. the page's read and save ------------------------------------------------------------- */

/** set_my_notify_off as the migration has it: the caller's row, known keys only, A to Z. */
const setMyNotifyOff =
  (uid: string): FakeRpc =>
  (args, tables) => {
    const list = args["p_off"] as string[] | null;
    if (list === null) throw new Error("the list is required");
    if (list.some((k) => !NOTICE_TYPE_KEYS.includes(k))) throw new Error("not a notice type");
    const row = (tables["profiles"] ?? []).find((p) => p["id"] === uid);
    if (!row) throw new Error("Your profile was not found");
    row["notify_off"] = [...new Set(list)].sort();
    return row["notify_off"];
  };

function saveEnv(
  profile: Row,
  rpcs: Record<string, FakeRpc> = { set_my_notify_off: setMyNotifyOff(ME) },
) {
  const e = fakeSupabase(
    {
      profiles: [
        { id: ME, role: "technician", access: ["service"], ...profile },
        { id: OWNER, role: "admin", access: [], notify_off: [] },
      ],
    },
    { rpcs },
  );
  const call = <T>(fn: unknown, data?: unknown) =>
    (fn as (a: unknown) => Promise<T>)({ data, context: { supabase: e.db, userId: ME } });
  return { ...e, call };
}

describe("getNotifyOff and setNotifyOff", () => {
  it("reads the caller's own list: known keys, each once, in list order", async () => {
    const e = saveEnv({ notify_off: ["bids_steps", "gone_key", "service_opened", "bids_steps"] });
    await expect(e.call(getNotifyOff)).resolves.toEqual({
      notify_off: ["service_opened", "bids_steps"],
    });
    await expect(saveEnv({}).call(getNotifyOff)).resolves.toEqual({ notify_off: [] });
    await expect(saveEnv({ notify_off: null }).call(getNotifyOff)).resolves.toEqual({
      notify_off: [],
    });
  });

  it("saves through set_my_notify_off: a technician's own row, nobody else's, no direct write", async () => {
    const e = saveEnv({ notify_off: [] });
    await expect(
      e.call(setNotifyOff, { off: ["service_scheduled", "service_opened"] }),
    ).resolves.toEqual({ notify_off: ["service_opened", "service_scheduled"] });
    expect(e.rpcCalls).toEqual([
      { fn: "set_my_notify_off", args: { p_off: ["service_opened", "service_scheduled"] } },
    ]);
    expect(e.tables["profiles"]!.find((p) => p["id"] === ME)!["notify_off"]).toEqual([
      "service_opened",
      "service_scheduled",
    ]);
    expect(e.tables["profiles"]!.find((p) => p["id"] === OWNER)!["notify_off"]).toEqual([]);
    // Only the database function wrote: the server function never updates profiles itself.
    expect(e.writes).toEqual([]);
    // Ticking everything back on saves an empty list.
    await expect(e.call(setNotifyOff, { off: [] })).resolves.toEqual({ notify_off: [] });
    expect(e.tables["profiles"]!.find((p) => p["id"] === ME)!["notify_off"]).toEqual([]);
  });

  it("the server function takes a list of keys and nothing else: no id, no other column", () => {
    const src = read("src/lib/followups.functions.ts");
    const fn = src.slice(
      src.indexOf("export const setNotifyOff"),
      src.indexOf("/** The public VAPID key"),
    );
    expect(fn).toContain('databaseRpc(context.supabase)("set_my_notify_off", {');
    expect(fn).not.toContain(".from(");
    expect(fn).not.toContain("userId");
    expect(fn.match(/p_\w+:/g)).toEqual(["p_off:"]);
  });

  it("junk is refused before the database is asked", async () => {
    const e = saveEnv({ notify_off: ["service_opened"] });
    for (const off of [
      ["service_opened", "made_up"],
      ["ticket_watch"],
      [""],
      ["service_opened; drop table profiles"],
      [7],
      "service_opened",
      null,
    ])
      await expect(async () => e.call(setNotifyOff, { off })).rejects.toThrow();
    await expect(async () => e.call(setNotifyOff, {})).rejects.toThrow();
    await expect(async () =>
      e.call(setNotifyOff, { off: Array.from({ length: 29 }, () => "service_opened") }),
    ).rejects.toThrow();
    expect(e.rpcCalls).toEqual([]);
    expect(e.tables["profiles"]!.find((p) => p["id"] === ME)!["notify_off"]).toEqual([
      "service_opened",
    ]);
  });

  it("a save the database refused, or that came back as something else, is said and never passes", async () => {
    const refused = saveEnv(
      {},
      {
        set_my_notify_off: () => {
          throw new Error("permission denied");
        },
      },
    );
    await expect(refused.call(setNotifyOff, { off: ["bids_steps"] })).rejects.toThrow(
      NOTICE_CHOICES_NOT_SAVED,
    );
    for (const answer of [
      [],
      ["bids_due_soon"],
      ["bids_steps", "bids_due_soon"],
      null,
      "bids_steps",
    ]) {
      const odd = saveEnv({}, { set_my_notify_off: () => answer });
      await expect(odd.call(setNotifyOff, { off: ["bids_steps"] }), String(answer)).rejects.toThrow(
        NOTICE_CHOICES_NOT_SAVED,
      );
    }
    // The database's own list is behind the site's (a type added later): "not yet", not "try again".
    const behind = fakeSupabase(
      { profiles: [{ id: ME }] },
      {
        rpc: (fn) =>
          fn === "set_my_notify_off"
            ? { data: null, error: { code: "22023", message: "not a notice type" } }
            : undefined,
      },
    );
    await expect(
      (setNotifyOff as unknown as (a: unknown) => Promise<unknown>)({
        data: { off: ["bids_steps"] },
        context: { supabase: behind.db, userId: ME },
      }),
    ).rejects.toThrow(NOTICE_CHOICES_NOT_READY);
  });
});
