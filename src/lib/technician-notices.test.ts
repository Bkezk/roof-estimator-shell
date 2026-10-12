/**
 * The technician's own notices (owner, Oct 12, item 9; ticket-events.server.ts
 * afterTicketDispatch): a ticket taken from A and given to B tells A "Ticket #N was reassigned"
 * (kind `reassigned`, naming B); a ticket whose day moves while the technician stays tells them
 * "Ticket #N moved to <long day>" (kind `date_moved`) — never the person who made the change,
 * nothing when taken off to nobody (B hears "assigned" through the follow-up as before). Every
 * path that changes the technician or the date reaches it once, through syncTicketFollowup.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.hoisted(() =>
  vi.fn<
    (
      ids: string[],
      msg: { kind: string; title: string; body?: string | null; url?: string | null },
      sb: unknown,
    ) => Promise<number>
  >(async () => 1),
);
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify,
}));

import { afterTicketDispatch } from "@/lib/ticket-events.server";
import type { Client } from "@/lib/notify.server";

const ROSTER = [
  { id: "tech-a", full_name: "Alan Able", email: "a@x", technician: true },
  { id: "tech-b", full_name: "Bob Baker", email: "b@x", technician: true },
  { id: "office-1", full_name: "Olive Office", email: "o@x", technician: false },
];
const sb = { rpc: vi.fn(async () => ({ data: ROSTER, error: null })) } as unknown as Client;
const OFFICE = { id: "office-1", name: "Olive Office" };
const row = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  number: 6010,
  customer_name: "Acme",
  description: "Leak",
  stage: "scheduled",
  account_id: null,
  technician_id: "tech-b",
  scheduled_date: "2026-10-14",
  created_by: "office-1",
  deleted_at: null as string | null,
  ...over,
});

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe("reassigned", () => {
  it("A → B: A hears 'Ticket #N was reassigned', naming B and the ticket, with the ticket's link", async () => {
    await afterTicketDispatch(
      row(),
      { technician_id: "tech-a", scheduled_date: "2026-10-14" },
      OFFICE,
      sb,
    );
    expect(notify).toHaveBeenCalledTimes(1);
    const [ids, msg] = notify.mock.calls[0]!;
    expect(ids).toEqual(["tech-a"]);
    expect(msg).toEqual({
      kind: "reassigned",
      title: "Ticket #6010 was reassigned",
      body: "Olive Office reassigned Ticket #6010 Acme — Leak to Bob Baker. It is off your list.",
      url: "/service?id=job-1",
    });
  });
  it("A → B with the day moved too is one notice (reassigned), not two", async () => {
    await afterTicketDispatch(
      row(),
      { technician_id: "tech-a", scheduled_date: "2026-10-10" },
      OFFICE,
      sb,
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![1].kind).toBe("reassigned");
  });
  it("nobody → B, and A → nobody, send nothing here (B hears 'assigned' from the follow-up)", async () => {
    await afterTicketDispatch(
      row(),
      { technician_id: null, scheduled_date: "2026-10-14" },
      OFFICE,
      sb,
    );
    await afterTicketDispatch(
      row({ technician_id: null }),
      { technician_id: "tech-a", scheduled_date: "2026-10-14" },
      OFFICE,
      sb,
    );
    expect(notify).not.toHaveBeenCalled();
  });
  it("A reassigning their own ticket away is not told", async () => {
    await afterTicketDispatch(
      row(),
      { technician_id: "tech-a", scheduled_date: "2026-10-14" },
      { id: "tech-a", name: "Alan Able" },
      sb,
    );
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("date moved", () => {
  it("the technician stays and the day moves: 'Ticket #N moved to <long day>'", async () => {
    await afterTicketDispatch(
      row(),
      { technician_id: "tech-b", scheduled_date: "2026-10-10" },
      OFFICE,
      sb,
    );
    expect(notify).toHaveBeenCalledTimes(1);
    const [ids, msg] = notify.mock.calls[0]!;
    expect(ids).toEqual(["tech-b"]);
    expect(msg).toEqual({
      kind: "date_moved",
      title: "Ticket #6010 moved to Oct 14, 2026",
      body: "Olive Office moved Ticket #6010 Acme — Leak from Oct 10, 2026 to Oct 14, 2026.",
      url: "/service?id=job-1",
    });
  });
  it("a first date on an undated ticket reads 'moved to', without a from", async () => {
    await afterTicketDispatch(row(), { technician_id: "tech-b", scheduled_date: null }, OFFICE, sb);
    expect(notify.mock.calls[0]![1].body).toBe(
      "Olive Office moved Ticket #6010 Acme — Leak to Oct 14, 2026.",
    );
  });
  it("not when the technician moved it themselves, when nothing changed, when the date was cleared, or when the ticket is deleted", async () => {
    await afterTicketDispatch(
      row(),
      { technician_id: "tech-b", scheduled_date: "2026-10-10" },
      { id: "tech-b", name: "Bob Baker" },
      sb,
    );
    await afterTicketDispatch(
      row(),
      { technician_id: "tech-b", scheduled_date: "2026-10-14" },
      OFFICE,
      sb,
    );
    await afterTicketDispatch(
      row({ scheduled_date: null }),
      { technician_id: "tech-b", scheduled_date: "2026-10-14" },
      OFFICE,
      sb,
    );
    await afterTicketDispatch(
      row({ deleted_at: "2026-10-12T00:00:00Z" }),
      { technician_id: "tech-a", scheduled_date: "2026-10-10" },
      OFFICE,
      sb,
    );
    expect(notify).not.toHaveBeenCalled();
  });
  it("a failed notice is logged, never thrown (the dispatch is already saved)", async () => {
    notify.mockRejectedValueOnce(new Error("inbox down"));
    await expect(
      afterTicketDispatch(
        row(),
        { technician_id: "tech-b", scheduled_date: "2026-10-10" },
        OFFICE,
        sb,
      ),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("inbox down"));
  });
});

describe("every path reaches it once", () => {
  const svc = readFileSync("src/lib/service.functions.ts", "utf8");
  it("syncTicketFollowup runs afterTicketDispatch when it is handed the row as it was", () => {
    expect(svc).toContain(
      "before?: { technician_id: string | null; scheduled_date: string | null },",
    );
    expect(svc).toContain("if (before) await afterTicketDispatch(row, before, actor, sb);");
    expect(svc.split("afterTicketDispatch(").length - 1).toBe(1); // the one call
  });
  it("the save and the Board's drop hand it the technician and day they read first", () => {
    const save = svc.slice(
      svc.indexOf("export const saveServiceJob"),
      svc.indexOf("async function saveCrew"),
    );
    expect(save).toContain('.select("technician_id, stage, scheduled_date")');
    expect(save).toContain(
      "await syncTicketFollowup(saved, { id: context.userId, name: nameOf(p) }, sb, cur.stage, cur);",
    );
    const assign = svc.slice(
      svc.indexOf("export const assignServiceJob"),
      svc.indexOf("export const claimServiceJob"),
    );
    expect(assign).toContain('.select("stage, scheduled_date, technician_id")');
    expect(assign).toContain(
      "await syncTicketFollowup(row, { id: context.userId, name: nameOf(p) }, sb, cur.stage, cur);",
    );
    // No PO notice, no Closed notice (owner).
    const events = readFileSync("src/lib/ticket-events.server.ts", "utf8");
    expect(events).not.toMatch(/kind: "(po|purchase_order|ticket_closed)"/);
  });
});
