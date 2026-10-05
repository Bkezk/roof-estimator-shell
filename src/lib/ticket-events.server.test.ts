/**
 * afterTicketStage (ticket-events.server.ts): a ticket reaching Done tells the office ("invoice
 * ready to review") and opens an "Invoice ticket #" follow-up, both from the technician_options
 * roster. Audit, Oct 2: under the service role the roster came back empty
 * (20261002090000_service_role_helpers.sql fixes the SQL) and the code then did nothing,
 * silently. These run it with a mocked client and check both paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.hoisted(() =>
  vi.fn<(ids: string[], msg: { kind: string; title: string }, sb: unknown) => Promise<number>>(
    async () => 1,
  ),
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

const ROSTER = [
  { id: "tech-1", full_name: "Ted Tech", email: "t@x", technician: true },
  { id: "office-1", full_name: "Olive Office", email: "o@x", technician: false },
  { id: "admin-1", full_name: "Ann Admin", email: "a@x", technician: false },
];
const client = (result: { data: unknown; error: { message: string } | null }) => {
  const rpc = vi.fn(async () => result);
  return { sb: { rpc } as unknown as Client, rpc };
};
const row = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  number: 101,
  customer_name: "Acme",
  description: "Leak",
  stage: "done",
  account_id: "acct-1",
  technician_id: "tech-1",
  created_by: "office-1",
  deleted_at: null as string | null,
  ...over,
});
const TECH = { id: "tech-1", name: "Ted Tech" };

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe("a ticket reaching Done", () => {
  it("with the office roster: sends the done notice to the office and opens the invoice follow-up", async () => {
    const { sb, rpc } = client({ data: ROSTER, error: null });
    await afterTicketStage(row(), "scheduled", TECH, sb);

    expect(rpc).toHaveBeenCalledWith("technician_options");
    expect(notify).toHaveBeenCalledTimes(1);
    const [ids, msg] = notify.mock.calls[0]!;
    expect(ids.sort()).toEqual(["admin-1", "office-1"]); // office only, not the technician
    expect(msg.kind).toBe("ticket_done");
    expect(msg.title).toContain("Ticket #101 Acme");
    // Since Oct 5 (M9) the Done notice asks for the review; the invoice comes after Authorized.
    expect(msg.title).toContain("ready for your review");

    expect(syncFollowup).toHaveBeenCalledTimes(1);
    expect(syncFollowup.mock.calls[0]![0]).toMatchObject({
      kind: "invoice",
      itemId: "job-1",
      assigneeId: "office-1", // the office user who opened the ticket
      closing: false,
      title: "Authorize Ticket #101 Acme — Leak",
    });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("opened by a technician: the invoice follow-up goes to the first office user", async () => {
    const { sb } = client({ data: ROSTER, error: null });
    await afterTicketStage(row({ created_by: "tech-1" }), "scheduled", TECH, sb);
    expect(syncFollowup.mock.calls[0]![0]).toMatchObject({ assigneeId: "office-1" });
  });

  it("with an empty roster: it says so in the server log instead of doing nothing silently", async () => {
    const { sb } = client({ data: [], error: null });
    await afterTicketStage(row(), "scheduled", TECH, sb);

    expect(notify).not.toHaveBeenCalled();
    expect(syncFollowup.mock.calls[0]![0]).toMatchObject({ assigneeId: null });
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringMatching(/ticket #101 is done but nobody authorizes it/),
    );
  });

  it("when the roster call fails: the error is logged", async () => {
    const { sb } = client({ data: null, error: { message: "permission denied" } });
    await afterTicketStage(row(), "scheduled", TECH, sb);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("technician_options failed — permission denied"),
    );
  });

  it("leaving Done with an empty roster is not an error (nothing to notify, the timer closes)", async () => {
    const { sb } = client({ data: [], error: null });
    await afterTicketStage(row({ stage: "scheduled" }), "done", TECH, sb);
    expect(errorLog).not.toHaveBeenCalled();
    expect(syncFollowup.mock.calls[0]![0]).toMatchObject({ closing: true, assigneeId: null });
  });
});
