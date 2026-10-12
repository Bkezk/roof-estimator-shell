/**
 * The authorizer sees a Done ticket once on Work Overview (owner, Oct 6). On the "Everyone" view
 * a Done ticket showed twice for the person who authorizes: under Needs authorization (its
 * kind-"invoice" follow-up, "Authorize Ticket #…") and again under "Done — waiting on the office"
 * (the ticket row itself). The Needs authorization row is the one to act on. Since Oct 12 the
 * Done group is gone for everyone: a Done ticket row is never listed, so the Needs authorization
 * row is the one place the ticket shows.
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
  it("is listed once: under Needs authorization, and nowhere else", () => {
    const items = mergeWork(
      { tickets: [doneTicket("t1")], tasks: [], followups: [authorizeFollowup("f1", "t1")] },
      utcDay,
    );
    expect(items.map((i) => i.key)).toEqual(["followup:f1"]);
    const groups = listGroups(items, today, { authorize: true });
    expect(groups.find((g) => g.bucket === "authorize")!.items.map((i) => i.key)).toEqual([
      "followup:f1",
    ]);
    expect(groups.map((g) => g.bucket)).not.toContain("done");
    expect(groups.filter((g) => g.items.length > 0).map((g) => g.bucket)).toEqual(["authorize"]);
  });
  it("a Done ticket whose review timer is closed, or missing, is not listed at all (Oct 12: no Done group)", () => {
    const items = mergeWork(
      {
        tickets: [doneTicket("t1"), doneTicket("t2", { number: 102 })],
        tasks: [],
        followups: [authorizeFollowup("f1", "t1", { status: "closed" })],
      },
      utcDay,
    );
    expect(items).toEqual([]);
    expect(listGroups(items, today).every((g) => g.items.length === 0)).toBe(true);
  });
  it("the technician's own view (no Authorize follow-up in their rows) does not list the Done ticket either", () => {
    const items = mergeWork({ tickets: [doneTicket("t1")], tasks: [], followups: [] }, utcDay);
    expect(items).toEqual([]);
    // Their Open / Scheduled tickets are listed as before.
    const open = mergeWork(
      { tickets: [doneTicket("t1", { stage: "scheduled" })], tasks: [], followups: [] },
      utcDay,
    );
    expect(open.map((i) => i.key)).toEqual(["ticket:t1"]);
  });
  it("a ticket's own timer (kind 'ticket') on a Done ticket stands as its own follow-up row", () => {
    // The ticket row is gone (finished work); its open reminder is still the assignee's to-do.
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
    expect(items.map((i) => i.key)).toEqual(["followup:f2"]);
    expect(items[0]!.needsAuth).toBeFalsy();
  });
});
