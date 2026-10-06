/**
 * The authorizer sees a Done ticket once on Work Overview (owner, Oct 6). On the "Everyone" view
 * a Done ticket showed twice for the person who authorizes: under Needs authorization (its
 * kind-"invoice" follow-up, "Authorize Ticket #…") and again under "Done — waiting on the office"
 * (the ticket row itself). The Needs authorization row is the one to act on; the Done row is
 * dropped when the viewer has that follow-up for the same ticket.
 */
import { describe, expect, it } from "vitest";

import { listGroups, mergeWork, type FollowupIn, type TicketIn } from "./my-work";

const ME = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const today = "2026-10-06";
const utcDay = (iso: string) => iso.slice(0, 10);

const doneTicket = (id: string, over: Partial<TicketIn> = {}): TicketIn => ({
  id,
  number: 101,
  customer_name: "Acme",
  site_name: "Plant 2",
  site_address: "1 Main St",
  description: "Leak over office",
  service_type: "leak",
  stage: "done",
  scheduled_date: "2026-10-05",
  technician_id: BOB,
  ...over,
});
const authorizeFollowup = (
  id: string,
  ticketId: string,
  over: Partial<FollowupIn> = {},
): FollowupIn => ({
  id,
  title: "Authorize Ticket #101 Acme — Leak over office",
  url: `/service?id=${ticketId}`,
  due_at: "2026-10-06T12:00:00Z",
  status: "open",
  kind: "invoice",
  item_id: ticketId,
  assignee_id: ME,
  account_name: "Acme",
  ...over,
});

describe("a Done ticket with an open Authorize follow-up (the Everyone view)", () => {
  it("is listed once: under Needs authorization, not under Done", () => {
    const items = mergeWork(
      { tickets: [doneTicket("t1")], tasks: [], followups: [authorizeFollowup("f1", "t1")] },
      utcDay,
    );
    expect(items.map((i) => i.key)).toEqual(["followup:f1"]);
    const groups = listGroups(items, today, { authorize: true });
    expect(groups.find((g) => g.bucket === "authorize")!.items.map((i) => i.key)).toEqual([
      "followup:f1",
    ]);
    expect(groups.find((g) => g.bucket === "done")!.items).toEqual([]);
  });
  it("a Done ticket whose review timer is closed, or missing, still waits on the office", () => {
    const items = mergeWork(
      {
        tickets: [doneTicket("t1"), doneTicket("t2", { number: 102 })],
        tasks: [],
        followups: [authorizeFollowup("f1", "t1", { status: "closed" })],
      },
      utcDay,
    );
    expect(items.map((i) => i.key).sort()).toEqual(["ticket:t1", "ticket:t2"]);
    const done = listGroups(items, today).find((g) => g.bucket === "done")!;
    expect(done.items.map((i) => i.key)).toEqual(["ticket:t1", "ticket:t2"]);
  });
  it("the technician's own view (no Authorize follow-up in their rows) keeps the Done ticket", () => {
    const items = mergeWork({ tickets: [doneTicket("t1")], tasks: [], followups: [] }, utcDay);
    expect(items.map((i) => i.key)).toEqual(["ticket:t1"]);
  });
  it("a ticket's own timer (kind 'ticket') does not hide it: only the Authorize follow-up does", () => {
    const items = mergeWork(
      {
        tickets: [doneTicket("t1")],
        tasks: [],
        followups: [
          authorizeFollowup("f2", "t1", { kind: "ticket", assignee_id: BOB, title: "Follow up" }),
        ],
      },
      utcDay,
    );
    expect(items.map((i) => i.key)).toEqual(["ticket:t1"]);
    expect(items[0]!.followup?.id).toBe("f2");
  });
});
