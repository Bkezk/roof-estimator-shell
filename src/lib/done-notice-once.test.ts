/**
 * One notice when a ticket reaches Done (owner, Oct 12, item 2). The first authorizer used to
 * hear it twice: "Ticket #… is done — ready for your review" (ticket_done, ticket-events) and
 * then "Authorize Ticket #… — ready for your review" (the follow-up's "assigned" notice from
 * followups.server announce). The ticket_done wording and the follow-up (the Needs authorization
 * column, the reminders) stay; the follow-up's own start notice is the one dropped, through
 * `quiet` on that sync alone. A later hand-over to another authorizer still announces.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.hoisted(() =>
  vi.fn<(ids: string[], msg: { kind: string; title: string }, sb: unknown) => Promise<number>>(
    async () => 1,
  ),
);
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify,
}));

import { afterTicketStage } from "@/lib/ticket-events.server";
import { syncFollowup } from "@/lib/followups.server";
import type { Client } from "@/lib/notify.server";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const ADMIN = "admin-1";
const ADMIN2 = "admin-2";
const TECH = { id: "tech-1", name: "Ted Tech" };
const row = (over: Row = {}) => ({
  id: "job-1",
  number: 101,
  customer_name: "Acme",
  description: "Leak",
  stage: "done",
  account_id: null,
  technician_id: "tech-1",
  created_by: "office-1",
  deleted_at: null as string | null,
  ...over,
});
const profiles: Row[] = [
  { id: "tech-1", full_name: "Ted Tech", email: "t@x", technician: true },
  { id: "office-1", full_name: "Olive Office", email: "o@x", technician: false },
  { id: ADMIN, full_name: "Ann Admin", email: "a@x", technician: false },
  { id: ADMIN2, full_name: "Al Admin", email: "al@x", technician: false },
];

let tables: Record<string, Row[]>;
let authorizers: string[];
const client = () =>
  fakeSupabase(tables, { rpcs: { ticket_authorizers: () => authorizers } }).db as Client;
/** The database's column default the fake does not apply: a new follow-up row is open. */
const settle = () => {
  for (const f of tables["crm_followups"] ?? []) f["status"] ??= "open";
};
let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  authorizers = [ADMIN, ADMIN2];
  tables = {
    profiles,
    crm_followups: [],
    crm_settings: [
      {
        id: 1,
        opportunity_close_days: 30,
        opportunity_first_days: 3,
        opportunity_every_days: 7,
        ticket_first_days: 1,
        ticket_every_days: 3,
      },
    ],
  };
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe("a ticket reaching Done", () => {
  it("tells the authorizers once — ticket_done, 'is done — ready for your review' — and opens the follow-up without a second notice", async () => {
    await afterTicketStage(row(), "scheduled", TECH, client());
    expect(notify).toHaveBeenCalledTimes(1);
    const [ids, msg] = notify.mock.calls[0]!;
    expect(ids).toEqual([ADMIN, ADMIN2]);
    expect(msg.kind).toBe("ticket_done");
    expect(msg.title).toBe("Ticket #101 Acme — Leak is done — ready for your review");
    // The follow-up is there (the Needs authorization column and the reminders drive on it).
    expect(tables["crm_followups"]).toHaveLength(1);
    expect(tables["crm_followups"]![0]).toMatchObject({
      kind: "invoice",
      item_id: "job-1",
      assignee_id: ADMIN,
      title: "Authorize Ticket #101 Acme — Leak",
    });
    expect(tables["crm_followups"]![0]!["status"] ?? "open").toBe("open");
    expect(notify.mock.calls.map((c) => c[1].kind)).not.toContain("assigned");
  });
  it("a save while it sits at Done sends nothing (the follow-up is unchanged)", async () => {
    await afterTicketStage(row(), "scheduled", TECH, client());
    settle();
    vi.clearAllMocks();
    await afterTicketStage(row(), "done", { id: "office-1", name: "Olive" }, client());
    expect(notify).not.toHaveBeenCalled();
    expect(tables["crm_followups"]).toHaveLength(1);
  });
  it("a hand-over while at Done still announces to the new authorizer (quiet is only for the Done step)", async () => {
    await afterTicketStage(row(), "scheduled", TECH, client());
    settle();
    vi.clearAllMocks();
    authorizers = [ADMIN2, ADMIN];
    await afterTicketStage(row(), "done", { id: "office-1", name: "Olive" }, client());
    expect(notify).toHaveBeenCalledTimes(1);
    const [ids, msg] = notify.mock.calls[0]!;
    expect(ids).toEqual([ADMIN2]);
    expect(msg.kind).toBe("assigned");
    expect(msg.title).toBe("Authorize Ticket #101 Acme — Leak — ready for your review");
    settle();
    const open = tables["crm_followups"]!.filter((f) => f["status"] === "open");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ assignee_id: ADMIN2 });
    expect(tables["crm_followups"]!.find((f) => f["assignee_id"] === ADMIN)).toMatchObject({
      status: "closed",
      closed_reason: "reassigned",
    });
  });
});

describe("syncFollowup's quiet start", () => {
  const args = (over: Partial<Parameters<typeof syncFollowup>[0]> = {}) => ({
    kind: "invoice" as const,
    itemId: "job-1",
    accountId: null,
    assigneeId: ADMIN,
    title: "Authorize Ticket #101 Acme — Leak",
    url: "/service?id=job-1",
    closing: false,
    closeReason: "",
    dueDate: null,
    actorId: "tech-1",
    actorName: "Ted Tech",
    ...over,
  });
  it("quiet: the timer starts, nobody is told; without it the assignee hears 'assigned'", async () => {
    await expect(syncFollowup(args({ quiet: true }), client())).resolves.toBe("started");
    expect(notify).not.toHaveBeenCalled();
    expect(tables["crm_followups"]).toHaveLength(1);
    tables["crm_followups"] = [];
    await expect(syncFollowup(args(), client())).resolves.toBe("started");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![1].kind).toBe("assigned");
  });
  it("ticket-events passes quiet only for the step the ticket became Done", () => {
    const src = readFileSync("src/lib/ticket-events.server.ts", "utf8");
    expect(src).toContain("quiet: becameDone,");
    expect(readFileSync("src/lib/followups.server.ts", "utf8")).toContain(
      "if (!a.assigneeId || a.assigneeId === a.actorId || a.quiet) return;",
    );
  });
});
