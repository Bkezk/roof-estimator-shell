/**
 * Owner, Oct 12, three Account-page asks:
 *
 *   1. The sidebar entry that opens the Account page reads "My account" (the name moves to the
 *      small second line of that footer row, which was already two lines: name over role / pages).
 *   2. The Account page no longer lists which pages the login can open.
 *   3. A per-person "Lead notices" switch, off for everyone by default. Lead notices (kind
 *      'lead', the bid-board stream from saveLeadRows) went to prospect_user_ids(): every admin,
 *      manager and Prospecting login. Now profiles.notify_leads (default false) gates them:
 *      lead_notice_user_ids() is prospect_user_ids() narrowed to the people who opted in, and
 *      the leads pass asks that before notify(), so nobody with the switch off gets an inbox
 *      row, email or push. set_my_notify_prefs gains p_leads; the page saves through it.
 *      Storm notices keep prospect_user_ids().
 *
 * The migration and the pages are checked as text; the leads pass, the prefs save and the prefs
 * read run for real against stand-in clients (the fake database functions mirror the SQL).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notifyMock = vi.hoisted(() =>
  vi.fn(async (ids: string[], _msg: { kind: string; title: string }) => ids.length),
);
vi.mock("@/lib/notify.server", () => ({
  notify: notifyMock,
  serverClient: async (c: unknown) => c,
  hasServiceRole: () => true,
}));
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import type { Client } from "@/lib/notify.server";
import { saveLeadRows } from "@/lib/leads.server";
import { getNotifyPrefs, setNotifyPrefs } from "@/lib/followups.functions";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");

const MIGRATION = "supabase/migrations/20261012160000_notify_leads.sql";

/* ---- the migration ------------------------------------------------------------------------ */

describe(`migration ${MIGRATION}`, () => {
  const sql = flatSql(MIGRATION);
  const fnFrom = (head: string) =>
    sql.slice(sql.indexOf(head), sql.indexOf("$$;", sql.indexOf(head)) + 3);

  it("adds profiles.notify_leads, not null, default false, with the owner's comment", () => {
    expect(sql).toContain(
      "alter table public.profiles add column if not exists notify_leads boolean not null default false;",
    );
    expect(sql).toContain(
      "comment on column public.profiles.notify_leads is 'Owner, Oct 12: lead notices (the bid-board stream) are opt-in; off by default because most people do not use them';",
    );
  });

  it("set_my_notify_prefs(p_email, p_push, p_leads) writes the caller's own row, the three columns", () => {
    const fn = fnFrom(
      "create or replace function public.set_my_notify_prefs(p_email boolean, p_push boolean, p_leads boolean)",
    );
    expect(fn).toMatch(
      /^create or replace function public\.set_my_notify_prefs\(p_email boolean, p_push boolean, p_leads boolean\) returns table \(notify_email boolean, notify_push boolean, notify_leads boolean\) language plpgsql security definer set search_path = public as \$\$/,
    );
    expect(fn).toContain("if auth.uid() is null then raise exception 'Not signed in'");
    expect(fn).toContain(
      "set notify_email = coalesce(p_email, p.notify_email), notify_push = coalesce(p_push, p.notify_push), notify_leads = coalesce(p_leads, p.notify_leads) where p.id = auth.uid() returning p.notify_email, p.notify_push, p.notify_leads into v_email, v_push, v_leads;",
    );
    expect(fn).not.toMatch(/\b(role|access|technician)\s*=/);
    expect(fn.match(/\bupdate\b/g)).toHaveLength(1);
    expect(fn).toContain("if not found then raise exception");
    expect(fn).toContain("notify_leads := v_leads; return next;");
    const sig = "public.set_my_notify_prefs(boolean, boolean, boolean)";
    expect(sql).toContain(`revoke all on function ${sig} from public;`);
    expect(sql).toContain(`revoke all on function ${sig} from anon;`);
    expect(sql).toContain(`grant execute on function ${sig} to authenticated;`);
  });

  it("the two-argument form keeps working as a wrapper (same return type, lead switch untouched)", () => {
    const fn = fnFrom(
      "create or replace function public.set_my_notify_prefs(p_email boolean, p_push boolean) returns table (notify_email boolean, notify_push boolean)",
    );
    expect(fn).toContain(
      "return query select r.notify_email, r.notify_push from public.set_my_notify_prefs(p_email, p_push, null::boolean) as r;",
    );
    expect(fn).not.toContain("update ");
    const sig = "public.set_my_notify_prefs(boolean, boolean)";
    expect(sql).toContain(`revoke all on function ${sig} from public;`);
    expect(sql).toContain(`grant execute on function ${sig} to authenticated;`);
  });

  it("lead_notice_user_ids() is prospect_user_ids() narrowed to the opted-in, security definer", () => {
    const fn = fnFrom("create or replace function public.lead_notice_user_ids()");
    expect(fn).toMatch(
      /^create or replace function public\.lead_notice_user_ids\(\) returns setof uuid language sql stable security definer set search_path = public as \$\$ select p\.id from public\.profiles p where p\.notify_leads and p\.id in \(select public\.prospect_user_ids\(\)\); \$\$;$/,
    );
    expect(sql).toContain("revoke all on function public.lead_notice_user_ids() from public;");
    expect(sql).toContain(
      "grant execute on function public.lead_notice_user_ids() to authenticated, service_role;",
    );
  });

  it("leaves prospect_user_ids and notify_recipients alone, and is idempotent and additive", () => {
    expect(sql).not.toContain("function public.prospect_user_ids()");
    expect(sql).not.toContain("notify_recipients");
    expect(sql).not.toMatch(/\bdrop\b|\bcreate policy\b|\bcreate function\b/i);
    expect(sql.match(/alter table/g)).toHaveLength(1);
    expect(sql.match(/create or replace function/g)).toHaveLength(3);
  });

  it("is typed: the profiles rows and the two functions", () => {
    const types = read("src/integrations/supabase/types.ts");
    const profiles = types.slice(
      types.indexOf("      profiles: {"),
      types.indexOf("      push_subscriptions: {"),
    );
    expect(profiles.match(/notify_leads: boolean;/g)).toHaveLength(1);
    expect(profiles.match(/notify_leads\?: boolean;/g)).toHaveLength(2);
    expect(types).toContain("lead_notice_user_ids: { Args: never; Returns: string[] };");
    expect(types).toContain(
      "set_my_notify_prefs: {\n        Args: { p_email: boolean | null; p_push: boolean | null; p_leads: boolean | null };\n        Returns: { notify_email: boolean; notify_push: boolean; notify_leads: boolean }[];\n      };",
    );
  });
});

/* ---- the leads pass: only the opted-in hear about new roof jobs --------------------------- */

type Rec = Record<string, unknown>;
type Person = { id: string; role: string; access: string[]; notify_leads: boolean };

/** The leads table and lead_settings, plus profiles for the two user-list functions. */
class FakeDb {
  leads: Rec[] = [];
  settings: Rec = { id: 1, roof_keywords: ["roof"], source_fetched_at: {} };
  rpcs: string[] = [];
  constructor(public people: Person[]) {}
  from(table: string) {
    return new FakeQuery(this, table);
  }
  /** prospect_user_ids as 20260930093000_manager_role.sql has it; lead_notice_user_ids on top. */
  private prospectUserIds() {
    return this.people
      .filter((p) => ["admin", "manager"].includes(p.role) || p.access.includes("prospect"))
      .map((p) => p.id);
  }
  async rpc(name: string) {
    this.rpcs.push(name);
    if (name === "lead_notice_user_ids") {
      const prospect = this.prospectUserIds();
      return {
        data: this.people.filter((p) => p.notify_leads && prospect.includes(p.id)).map((p) => p.id),
        error: null,
      };
    }
    return { data: null, error: { message: `fake: unexpected rpc ${name}` } };
  }
}
class FakeQuery {
  private op: "select" | "update" | "upsert" = "select";
  private patch: Rec = {};
  private filters: ((r: Rec) => boolean)[] = [];
  private single_ = false;
  private window: [number, number] | null = null;
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  select() {
    return this;
  }
  single() {
    this.single_ = true;
    return this;
  }
  update(patch: Rec) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  upsert(rows: Rec[]) {
    this.op = "upsert";
    for (const r of rows) {
      const cur = this.db.leads.find(
        (x) => x["source"] === r["source"] && x["external_id"] === r["external_id"],
      );
      if (cur) Object.assign(cur, r);
      else this.db.leads.push({ status: "new", ...r });
    }
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  is(c: string, v: null) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  not(c: string, _op: string, list: string) {
    const vs = [...list.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\"/g, '"'));
    this.filters.push((r) => !vs.includes(r[c] as string));
    return this;
  }
  order() {
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  then<T>(done: (v: { data: unknown; error: null }) => T) {
    const rows = this.table === "leads" ? this.db.leads : [this.db.settings];
    let hit = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.window) hit = hit.slice(this.window[0], this.window[1] + 1);
    if (this.op === "update") for (const r of hit) Object.assign(r, this.patch);
    const data = this.op === "upsert" ? null : this.single_ ? (hit[0] ?? null) : hit;
    return Promise.resolve({ data, error: null }).then(done);
  }
}

const roofLead = {
  source: "knox_county_bids",
  external_id: "3801",
  title: "Roof Replacement",
  is_roof: true,
  gone_at: null,
  state: "TN",
};
const ADMIN_OFF: Person = { id: "admin-off", role: "admin", access: [], notify_leads: false };
const MANAGER_ON: Person = { id: "manager-on", role: "manager", access: [], notify_leads: true };
const PROSPECT_ON: Person = {
  id: "prospect-on",
  role: "user",
  access: ["prospect"],
  notify_leads: true,
};
const PROSPECT_OFF: Person = {
  id: "prospect-off",
  role: "user",
  access: ["prospect"],
  notify_leads: false,
};
/** Opted in, but not a Prospecting login: the switch alone does not add anyone. */
const TECH_ON: Person = { id: "tech-on", role: "technician", access: [], notify_leads: true };

const pass = (db: FakeDb) =>
  saveLeadRows(db as unknown as Client, [
    { source: "knox_county_bids", rows: [roofLead] as never, count: 1 },
  ]);

describe("saveLeadRows tells only the opted-in Prospecting people about new roof jobs", () => {
  beforeEach(() => {
    notifyMock.mockClear();
  });

  it("asks lead_notice_user_ids, never prospect_user_ids, and notifies exactly those ids", async () => {
    const db = new FakeDb([ADMIN_OFF, MANAGER_ON, PROSPECT_ON, PROSPECT_OFF, TECH_ON]);
    const r = await pass(db);
    expect(r.newRoof.map((x) => x.external_id)).toEqual(["3801"]);
    expect(db.rpcs).toEqual(["lead_notice_user_ids"]);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0]![0]).toEqual(["manager-on", "prospect-on"]);
    expect(notifyMock.mock.calls[0]![1]).toMatchObject({
      kind: "lead",
      title: "Bid Board: 1 new roof job",
    });
    expect(r.notified).toBe(2);
  });

  it("nobody opted in: the lead is saved, nobody is notified", async () => {
    const db = new FakeDb([ADMIN_OFF, PROSPECT_OFF, TECH_ON]);
    const r = await pass(db);
    expect(db.leads.map((l) => l["external_id"])).toEqual(["3801"]);
    expect(db.rpcs).toEqual(["lead_notice_user_ids"]);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(r.notified).toBe(0);
  });

  it("in the source: leads use lead_notice_user_ids; storms still use prospect_user_ids", () => {
    const leads = read("src/lib/leads.server.ts");
    const storms = read("src/lib/storms.server.ts");
    expect(leads).toContain('await admin.rpc("lead_notice_user_ids")');
    expect(leads).not.toContain('rpc("prospect_user_ids")');
    expect(storms).toContain('await admin.rpc("prospect_user_ids")');
    expect(storms).not.toContain("lead_notice_user_ids");
  });
});

/* ---- the prefs functions: a user sets their own flag; off when the row has no value -------- */

const ME = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** set_my_notify_prefs(p_email, p_push, p_leads) as the fake sees it: the caller's row only. */
const setMyNotifyPrefs =
  (uid: string): FakeRpc =>
  (args, tables) => {
    const row = (tables["profiles"] ?? []).find((p) => p["id"] === uid);
    if (!row) return [];
    if (args["p_email"] !== null) row["notify_email"] = args["p_email"];
    if (args["p_push"] !== null) row["notify_push"] = args["p_push"];
    if (args["p_leads"] !== null) row["notify_leads"] = args["p_leads"];
    return [
      {
        notify_email: row["notify_email"],
        notify_push: row["notify_push"],
        notify_leads: row["notify_leads"] ?? false,
      },
    ];
  };

function env(profile: Record<string, unknown>) {
  const e = fakeSupabase(
    { profiles: [{ id: ME, ...profile }], push_subscriptions: [] },
    { rpcs: { set_my_notify_prefs: setMyNotifyPrefs(ME) } },
  );
  const ctx = { supabase: e.db, userId: ME };
  const call = <T>(fn: unknown, data?: unknown) =>
    (fn as (a: unknown) => Promise<T>)({ data, context: ctx });
  return { ...e, call };
}

describe("the prefs functions carry notify_leads", () => {
  it("a user turns their own lead notices on through set_my_notify_prefs (no direct profiles write)", async () => {
    const e = env({ role: "user", access: ["prospect"], notify_email: true, notify_push: false });
    await expect(e.call(setNotifyPrefs, { notify_leads: true })).resolves.toEqual({
      notify_email: true,
      notify_push: false,
      notify_leads: true,
    });
    expect(e.rpcCalls).toEqual([
      { fn: "set_my_notify_prefs", args: { p_email: null, p_push: null, p_leads: true } },
    ]);
    expect(e.writes.filter((w) => w.table === "profiles")).toEqual([]);
    expect(e.tables["profiles"]![0]).toMatchObject({ notify_leads: true, notify_email: true });
    // And off again, leaving the other two switches alone.
    await e.call(setNotifyPrefs, { notify_leads: false });
    expect(e.tables["profiles"]![0]).toMatchObject({
      notify_leads: false,
      notify_email: true,
      notify_push: false,
    });
  });

  it("a save that did not land on the lead switch is an error, not a silent success", async () => {
    const e = fakeSupabase(
      { profiles: [{ id: ME }] },
      { rpcs: { set_my_notify_prefs: () => [{ notify_email: true, notify_push: true }] } },
    );
    await expect(
      (setNotifyPrefs as unknown as (a: unknown) => Promise<unknown>)({
        data: { notify_leads: true },
        context: { supabase: e.db, userId: ME },
      }),
    ).rejects.toThrow("Your notification settings were not saved. Please try again.");
  });

  it("getNotifyPrefs reads the flag, and a row with no value is off", async () => {
    const on = env({ notify_email: true, notify_push: true, notify_leads: true });
    await expect(on.call(getNotifyPrefs)).resolves.toEqual({
      notify_email: true,
      notify_push: true,
      notify_leads: true,
      devices: 0,
    });
    const none = env({ notify_email: true, notify_push: true });
    await expect(none.call(getNotifyPrefs)).resolves.toMatchObject({ notify_leads: false });
    const nulled = env({ notify_email: true, notify_push: true, notify_leads: null });
    await expect(nulled.call(getNotifyPrefs)).resolves.toMatchObject({ notify_leads: false });
  });
});

/* ---- the pages ---------------------------------------------------------------------------- */

describe("the sidebar's account entry", () => {
  const src = read("src/components/app-sidebar.tsx");
  const footer = src.slice(src.indexOf("<SidebarFooter>"), src.indexOf("</SidebarFooter>"));
  const link = footer.slice(
    footer.indexOf('<Link to="/account"'),
    footer.indexOf("</Link>", footer.indexOf('<Link to="/account"')),
  );

  it('reads "My account", with the name as the small second line', () => {
    expect(flat(link)).toContain(
      '<span className="block truncate font-medium text-foreground">My account</span> <span className="block truncate text-muted-foreground"> {profile.full_name || profile.email} </span>',
    );
    expect(link).toContain('<UserRound className="h-4 w-4 shrink-0" />');
    expect(footer).toContain('tooltip="My account"');
  });

  it("no longer spells out the role or the pages", () => {
    expect(footer).not.toMatch(/ROLE_LABELS|PAGE_LABELS|No pages|profile\.access|profile\.role/);
    expect(src).not.toMatch(/\bPAGE_LABELS\b|\bROLE_LABELS\b/);
  });
});

describe("the Account page", () => {
  const src = read("src/routes/account.tsx");

  it("no longer lists the pages the login can open; the rest of the profile card stays", () => {
    expect(src).not.toMatch(/Pages: |PAGE_LABELS|profile\.access|"none yet"/);
    expect(src).toContain("<CardTitle>{profile.full_name || profile.email}</CardTitle>");
    expect(flat(src)).toContain(
      '<span className="text-muted-foreground">Email: </span> {profile.email}',
    );
    expect(src).toContain(
      "An admin changes names, roles and pages under Admin › Users &amp; access.",
    );
    for (const kept of [
      "<CardTitle>Change password</CardTitle>",
      "<CardTitle>Appearance</CardTitle>",
      '<ThemeToggle variant="account" />',
      '<Link to="/notifications">',
      "Send me a test",
      "{devicesLine(p.devices)}",
    ])
      expect(src).toContain(kept);
  });

  it("has the Lead notices switch under the email / push switches, off by default, saved the same way", () => {
    const card = src.slice(src.indexOf("function NotificationsCard()"));
    const email = card.indexOf('id="notify-email"');
    const push = card.indexOf('id="notify-push"');
    const leads = card.indexOf('id="notify-leads"');
    const device = card.indexOf('<p className="text-sm font-medium">This device</p>');
    expect(email).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(email);
    expect(leads).toBeGreaterThan(push);
    expect(device).toBeGreaterThan(leads);
    expect(flat(card)).toContain(
      '<Label htmlFor="notify-leads">Lead notices</Label> <p className="text-xs text-muted-foreground"> New leads from the bid boards. Off unless you work them. </p>',
    );
    expect(flat(card)).toContain(
      '<Switch id="notify-leads" checked={p?.notify_leads ?? false} disabled={!p} onCheckedChange={(v) => save.mutate({ notify_leads: v })} />',
    );
    // One save path, one toast: the mutation the other two switches use, typed for the third.
    expect(card.match(/save\.mutate\(/g)).toHaveLength(3);
    expect(flat(src)).toContain(
      "type Prefs = { notify_email: boolean; notify_push: boolean; notify_leads: boolean; devices: number; };",
    );
    expect(flat(card)).toContain(
      "mutationFn: (patch: { notify_email?: boolean; notify_push?: boolean; notify_leads?: boolean; }) => setFn({ data: patch }),",
    );
  });
});
