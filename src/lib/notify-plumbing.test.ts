/**
 * Audit, Oct 2 — notification plumbing, and lead source names:
 *
 * 14a. APP_URL unset sent bare relative links; NOTIFY_FROM_EMAIL unset sent from Resend's
 *      onboarding address (it only reaches the Resend account owner). Now the inbox row records
 *      "APP_URL not set" / "NOTIFY_FROM_EMAIL not set" instead, logged once per pass.
 * 14b. The email was signed "— Bid-O-Matic"; now the company's name, else "JBK Portal".
 * 14c. Task notice failures (tasks.notify_error) were not on Admin › Reminders.
 * 14d. The reminders workflow exited 0 ("skipping") without its secrets.
 * 14e. "Escalate untouched items to every admin" now reaches admins and managers.
 * 10.  lead_sources.name was unique only case-sensitively.
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

import { dispatchDueReminders, notify, type Client } from "@/lib/notify.server";
import { notificationHealth } from "@/lib/followups.functions";
import { addLeadSource } from "@/lib/lead-sources.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function env(company: string | null = "Acme Roofing Co.") {
  const e = fakeSupabase(
    {
      profiles: [
        { id: ADMIN, role: "admin", access: [], full_name: "Ann", email: "ann@example.com" },
      ],
      notifications: [],
      push_subscriptions: [],
      company_settings: [{ id: 1, company_name: company }],
      crm_followups: [],
      crm_settings: [{ id: 1, last_dispatch_at: null }],
    },
    {
      rpc: (fn, args) => {
        if (fn === "notify_recipients")
          return {
            data: ((args?.["ids"] ?? []) as string[]).map((id) => ({
              id,
              email: `${id}@example.com`,
              full_name: id,
              notify_email: true,
              notify_push: false,
            })),
            error: null,
          };
        if (fn === "crm_untouched" || fn === "escalation_recipients")
          return { data: [], error: null };
        if (fn === "stamp_dispatch") return { data: null, error: null };
        return undefined;
      },
    },
  );
  holder.db = e.db;
  return e;
}
const inbox = (e: ReturnType<typeof env>) => e.tables["notifications"]!;

let fetchMock: ReturnType<typeof vi.fn>;
let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-placeholder-not-a-key");
  vi.stubEnv("RESEND_API_KEY", "test-placeholder-not-a-key");
  vi.stubEnv("APP_URL", "https://portal.example.com");
  vi.stubEnv("NOTIFY_FROM_EMAIL", "JBK <reminders@example.com>");
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  errorLog.mockRestore();
});

const msg = {
  kind: "followup",
  title: "Follow up: Reroof gym",
  body: "due today.",
  url: "/opportunities?id=1",
};
/** The first email handed to Resend. */
const sentText = () => {
  const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
  return JSON.parse(String(init.body)) as { text: string; from: string };
};

describe("item 14a — no broken email without APP_URL / NOTIFY_FROM_EMAIL", () => {
  it("APP_URL unset: nothing sent, the row says 'APP_URL not set'", async () => {
    vi.stubEnv("APP_URL", "");
    const e = env();
    await notify([REP], msg, e.db as Client);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(inbox(e)[0]).toMatchObject({ user_id: REP, email_error: "APP_URL not set" });
    expect(inbox(e)[0]!["email_sent_at"] ?? null).toBeNull();
  });
  it("NOTIFY_FROM_EMAIL unset: nothing sent, the row says 'NOTIFY_FROM_EMAIL not set'", async () => {
    vi.stubEnv("NOTIFY_FROM_EMAIL", "");
    const e = env();
    await notify([REP], msg, e.db as Client);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(inbox(e)[0]!["email_error"]).toBe("NOTIFY_FROM_EMAIL not set");
  });
  it("one clear console.error per reminder pass, however many rows", async () => {
    vi.stubEnv("APP_URL", "");
    const e = env();
    const due = new Date(Date.now() - 3600000).toISOString();
    e.tables["crm_followups"] = ["f1", "f2", "f3"].map((id) => ({
      id,
      kind: "ticket",
      item_id: `i-${id}`,
      assignee_id: REP,
      title: id,
      url: `/service?id=${id}`,
      due_at: due,
      next_remind_at: due,
      every_days: 3,
      reminders_sent: 0,
      status: "open",
    }));
    // The fake has no lte: every open row counts as due here.
    const db = e.db as unknown as { from: (t: string) => Record<string, unknown> };
    const from = db.from;
    db.from = (t: string) => {
      const b = from(t);
      b["lte"] = () => b;
      return b;
    };
    const r = await dispatchDueReminders(e.db as Client);
    expect(r.reminded).toBe(3);
    const lines = errorLog.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => /APP_URL not set/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Reminder email not sent: APP_URL not set/);
    expect(inbox(e).every((n) => n["email_error"] === "APP_URL not set")).toBe(true);
  });
  it("both set: sent, with the full link", async () => {
    const e = env();
    await notify([REP], msg, e.db as Client);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentText().text).toContain("Open: https://portal.example.com/opportunities?id=1");
    expect(sentText().from).toBe("JBK <reminders@example.com>");
    expect(inbox(e)[0]!["email_error"] ?? null).toBeNull();
  });
});

describe("item 14b — signed with the company's name", () => {
  it("company_settings.company_name", async () => {
    const e = env("Acme Roofing Co.");
    await notify([REP], msg, e.db as Client);
    expect(sentText().text.endsWith("\n\n— Acme Roofing Co.")).toBe(true);
    expect(sentText().text).not.toContain("Bid-O-Matic");
  });
  it("no company name: JBK Portal", async () => {
    const e = env(null);
    await notify([REP], msg, e.db as Client);
    expect(sentText().text.endsWith("\n\n— JBK Portal")).toBe(true);
  });
});

describe("item 14c — task notice failures on Admin › Reminders", () => {
  it("notificationHealth lists tasks.notify_error, and the email problem", async () => {
    vi.stubEnv("NOTIFY_FROM_EMAIL", "");
    const e = env();
    e.tables["tasks"] = [
      {
        id: "t1",
        title: "Call Bell County",
        notify_error: "Resend 403: domain not verified",
        updated_at: "2026-10-02T12:00:00Z",
        assignee_name: "Rae",
      },
      {
        id: "t2",
        title: "Fine task",
        notify_error: null,
        updated_at: "2026-10-02T12:00:00Z",
        assignee_name: "Rae",
      },
    ];
    const h = await (notificationHealth as unknown as (a: { context: unknown }) => Promise<Row>)({
      context: { supabase: e.db, userId: ADMIN },
    });
    expect(h["task_failures"]).toEqual([
      {
        id: "t1",
        title: "Call Bell County",
        notify_error: "Resend 403: domain not verified",
        updated_at: "2026-10-02T12:00:00Z",
        assignee_name: "Rae",
      },
    ]);
    expect(h["email_problem"]).toBe("NOTIFY_FROM_EMAIL not set");
  });
  it("the Reminders page shows them", () => {
    const c = read("src/components/reminders-settings.tsx");
    expect(c).toContain('data-health="task-failures"');
    expect(c).toContain("health.data.task_failures.map((t) => (");
    expect(c).toContain("{t.notify_error}</TableCell>");
    expect(c).toContain('data-health="email-problem"');
  });
});

describe("item 14d — the reminders workflow fails without its secrets", () => {
  it("exit 1, not exit 0 / skipping", () => {
    const y = read(".github/workflows/reminders.yml");
    const branch = y.slice(y.indexOf('if [ -z "$APP_URL" ]'), y.indexOf("fi\n"));
    expect(branch).toContain("exit 1");
    expect(branch).not.toContain("exit 0");
    expect(branch).toContain("::error::");
    expect(y).not.toMatch(/skipping"; exit 0/);
  });
});

describe("item 14e — escalation reaches every admin and manager", () => {
  it("escalation_recipients takes managers too; the toggle says so", () => {
    const m = read("supabase/migrations/20261002140000_followup_guard.sql");
    const fn = m.slice(m.indexOf("create or replace function public.escalation_recipients()"));
    expect(fn).toContain("(s.escalate_to_admins and p.role in ('admin', 'manager'))");
    const c = read("src/components/reminders-settings.tsx");
    expect(c).toContain("Escalate untouched items to every admin and manager");
    expect(c).not.toMatch(/Escalate untouched items to every admin\n/);
  });
});

describe("item 10 — one lead source name whatever its case", () => {
  it("the migration collapses duplicates (lowest id kept) and adds the case-blind index", () => {
    const m = read("supabase/migrations/20261002140000_followup_guard.sql");
    expect(m).toContain("window w as (partition by lower(btrim(name)) order by id)");
    expect(m).toMatch(/update public\.crm_opportunities o\s+set lead_source = r\.keep_name/);
    expect(m).toMatch(
      /delete from public\.lead_sources l\s+using ranked r\s+where l\.id = r\.id and r\.id <> r\.keep_id;/,
    );
    expect(m).toContain(
      "create unique index if not exists lead_sources_name_ci_key\n  on public.lead_sources (lower(btrim(name)));",
    );
  });
  /** A client whose insert hits the case-blind index (another tab added "referral" first). */
  function racing(afterInsert: { id: string; name: string; sort: number }[]) {
    let reads = 0;
    const list = (rows: unknown[]) => ({
      order: () => ({ order: async () => ({ data: rows, error: null }) }),
    });
    return {
      from: (t: string) =>
        t === "profiles"
          ? {
              select: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: { role: "admin", access: [] } }) }),
              }),
            }
          : {
              select: () => list(reads++ === 0 ? [] : afterInsert),
              insert: () => ({
                select: () => ({
                  single: async () => ({
                    data: null,
                    error: {
                      code: "23505",
                      message:
                        'duplicate key value violates unique constraint "lead_sources_name_ci_key"',
                    },
                  }),
                }),
              }),
            },
    };
  }
  const add = (db: unknown, name: string) =>
    (addLeadSource as unknown as (a: { data: Row; context: unknown }) => Promise<Row>)({
      data: { name },
      context: { supabase: db, userId: ADMIN },
    });
  it("adding 'Referral' when 'referral' just landed returns that one", async () => {
    const r = await add(racing([{ id: "x", name: "referral", sort: 10 }]), "Referral");
    expect(r).toEqual({ id: "x", name: "referral", sort: 10 });
  });
  it("otherwise the plain message, never the database's text", async () => {
    await expect(add(racing([]), "Referral")).rejects.toThrow(/^Referral is already on the list$/);
  });
});
