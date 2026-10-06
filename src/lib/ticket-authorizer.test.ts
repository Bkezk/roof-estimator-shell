/**
 * Who authorizes Done tickets (service study M9, owner Oct 5: "Brandon is the owner so he will
 * be the go to person to authorize"; "should we have it appear under a Needs authorization tab
 * on the work overview page instead of done - waiting on the office?").
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.hoisted(() =>
  vi.fn<
    (
      ids: string[],
      msg: { kind: string; title: string; body?: string },
      sb: unknown,
    ) => Promise<number>
  >(async () => 1),
);
const syncFollowup = vi.hoisted(() =>
  vi.fn<(a: Record<string, unknown>, sb: unknown) => Promise<string>>(async () => "started"),
);
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify,
}));
vi.mock("@/lib/followups.server", () => ({ syncFollowup }));

import { afterTicketStage } from "./ticket-events.server";
import type { Client } from "@/lib/notify.server";
import { bucketOf, BUCKET_LABELS, followupItem, listGroups, type FollowupIn } from "@/lib/my-work";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

const ROSTER = [
  { id: "tech-1", full_name: "Ted Tech", email: "t@x", technician: true },
  { id: "office-1", full_name: "RoAnna Sims", email: "o@x", technician: false },
  { id: "brandon", full_name: "Brandon Keck", email: "b@x", technician: false },
];
/** technician_options → the roster; ticket_authorizers → `authorizers` (or an error). */
const client = (authorizers: string[] | null) => {
  const rpc = vi.fn(async (fn: string) =>
    fn === "ticket_authorizers"
      ? authorizers
        ? { data: authorizers, error: null }
        : { data: null, error: { message: "function ticket_authorizers does not exist" } }
      : { data: ROSTER, error: null },
  );
  return { rpc } as unknown as Client;
};
const row = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  number: 6012,
  customer_name: "Bell County BOE",
  description: "Leak",
  stage: "done",
  account_id: "acct-1",
  technician_id: "tech-1",
  created_by: "office-1",
  deleted_at: null as string | null,
  ...over,
});
const TECH = { id: "tech-1", name: "Trace Floyd" };

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe("a ticket reaching Done", () => {
  it("tells the authorizer (Brandon), not the whole office, and opens his review timer", async () => {
    await afterTicketStage(row(), "scheduled", TECH, client(["brandon"]));
    expect(notify).toHaveBeenCalledTimes(1);
    const [ids, msg] = notify.mock.calls[0]!;
    expect(ids).toEqual(["brandon"]);
    expect(msg.title).toBe("Ticket #6012 Bell County BOE — Leak is done — ready for your review");
    expect(msg.body).toBe(
      "Trace Floyd marked it done. Review it and mark it Authorized; the invoice is made after that.",
    );
    expect(syncFollowup.mock.calls[0]![0]).toMatchObject({
      kind: "invoice",
      assigneeId: "brandon",
      title: "Authorize Ticket #6012 Bell County BOE — Leak",
      closing: false,
    });
  });
  it("before the migration (no ticket_authorizers): the office, as before", async () => {
    await afterTicketStage(row(), "scheduled", TECH, client(null));
    expect(notify.mock.calls[0]![0]).toEqual(["office-1", "brandon"]);
    expect(syncFollowup.mock.calls[0]![0]).toMatchObject({ assigneeId: "office-1" });
  });
  it("the authorizer who marks it Done himself is not told", async () => {
    await afterTicketStage(
      row(),
      "scheduled",
      { id: "brandon", name: "Brandon Keck" },
      client(["brandon"]),
    );
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("a ticket reaching Authorized", () => {
  it("tells the office (not the one who authorized) it is ready to invoice; the review timer closes", async () => {
    await afterTicketStage(
      row({ stage: "authorized" }),
      "done",
      { id: "brandon", name: "Brandon Keck" },
      client(["brandon"]),
    );
    const [ids, msg] = notify.mock.calls[0]!;
    expect(ids).toEqual(["office-1"]);
    expect(msg.kind).toBe("ticket_authorized");
    expect(msg.title).toBe("Ticket #6012 Bell County BOE — Leak authorized — ready to invoice");
    expect(syncFollowup.mock.calls[0]![0]).toMatchObject({
      kind: "invoice",
      closing: true,
      assigneeId: null,
    });
  });
});

describe("Work Overview: the Needs authorization tab", () => {
  const timer: FollowupIn = {
    id: "f1",
    title: "Authorize Ticket #6012 Bell County BOE — Leak",
    url: "/service?id=job-1",
    due_at: "2026-10-05T14:00:00Z",
    status: "open",
    kind: "invoice",
    item_id: "job-1",
    assignee_id: "brandon",
  };
  it("a Done ticket's review timer sits under Needs authorization", () => {
    const item = followupItem(timer);
    expect(item.needsAuth).toBe(true);
    expect(bucketOf(item, "2026-10-05")).toBe("authorize");
    expect(BUCKET_LABELS.authorize).toBe("Needs authorization");
    expect(bucketOf(followupItem({ ...timer, kind: "ticket" }), "2026-10-05")).toBe("today");
  });
  it("first for the authorizer, even empty; hidden for everyone else unless it has items", () => {
    expect(listGroups([], "2026-10-05", { authorize: true }).map((g) => g.bucket)).toEqual([
      "authorize",
      "overdue",
      "week",
      "later",
      "nodate",
      "done",
    ]);
    expect(listGroups([], "2026-10-05").map((g) => g.bucket)).not.toContain("authorize");
    expect(listGroups([followupItem(timer)], "2026-10-05")[0]!.bucket).toBe("authorize");
  });
  it("the server says whether the caller authorizes; the page passes it on", () => {
    const fns = read("src/lib/my-work.functions.ts");
    expect(fns).toContain('sb.rpc("ticket_authorizers")');
    expect(fns).toContain("(auth.data ?? []).some((id: unknown) => id === context.userId)");
    expect(read("src/components/my-work-page.tsx")).toContain("authorize={!!q.data?.authorizer}");
  });
});

describe("the setting and the database", () => {
  const sql = flat(read("supabase/migrations/20261005150000_ticket_authorizer.sql"));
  it("service_settings.authorizer_id; ticket_authorizers = the set admin / manager, else every admin", () => {
    expect(sql).toContain(
      "alter table public.service_settings add column if not exists authorizer_id uuid references public.profiles(id) on delete set null;",
    );
    expect(sql).toContain("create or replace function public.ticket_authorizers()");
    expect(sql).toContain("where s.id = 1 and p.role in ('admin', 'manager')");
    expect(sql).toContain("security definer");
  });
  // QA audit bug 6 (owner, Oct 6): 20261006210000_default_authorizer.sql is the last word on
  // ticket_authorizers(): the set person, else Brandon (Brandon@flatroofonline.com) once he is
  // an admin or manager, else every admin ordered by created_at, id — so the "Needs
  // authorization" follow-up no longer flips between two admins on every save.
  it("its last definer is 20261006210000, which keeps the set person first and orders the admins", () => {
    const dir = "supabase/migrations";
    const defs = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        readFileSync(`${dir}/${f}`, "utf8").includes(
          "create or replace function public.ticket_authorizers(",
        ),
      );
    const last = defs.at(-1)!;
    expect(last).toBe("20261006210000_default_authorizer.sql");
    const body = flat(read(`${dir}/${last}`));
    expect(body).toContain("where s.id = 1 and p.role in ('admin', 'manager')");
    expect(body).toContain("lower(p.email) = 'brandon@flatroofonline.com'");
    expect(body).toContain("where p.role = 'admin' and not exists (select 1 from chosen)");
    expect(body).toContain("order by created_at, id");
    expect(body).toContain("security definer set search_path = public");
    expect(body).toContain(
      "grant execute on function public.ticket_authorizers() to authenticated, service_role;",
    );
  });
  it("Setup › Service rates: 'Authorizes Done tickets', Every admin or a manager; only admins / managers saved", () => {
    const ui = read("src/components/service-rates-settings.tsx");
    expect(ui).toContain('<Label htmlFor="rates-authorizer">Authorizes Done tickets</Label>');
    expect(ui).toContain("<SelectItem value={ADMINS}>Every admin</SelectItem>");
    const fns = read("src/lib/invoices.functions.ts");
    expect(fns).toContain("authorizer_id: z.string().uuid().nullable(),");
    expect(fns).toContain("throw new Error(AUTHORIZER_NOT_MANAGER);");
  });
});
