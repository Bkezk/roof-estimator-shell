/**
 * The automatic follow-up sync stays everyone's (owner, Oct 1): a rep finishing, losing or
 * reassigning an item still closes its follow-up, and a moved date still moves the due date.
 * Only the hand-made Snooze / Close are a manager's. These tests run syncFollowup with a plain
 * user's client and check it never asks who the caller is and marks its closes closed_by_sync
 * (the database trigger lets those through).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));

import { syncFollowup } from "./followups.server";
import type { Client } from "@/lib/notify.server";

type Op = { table: string; op: string; args: unknown[] };

/** A minimal chainable stand-in for the Supabase client under a plain user's login. */
function fakeClient(openRow: Record<string, unknown> | null) {
  const ops: Op[] = [];
  const tables: string[] = [];
  const builder = (table: string) => {
    let mode = "select";
    const b: Record<string, unknown> = {};
    const chain =
      (name: string) =>
      (...args: unknown[]) => {
        ops.push({ table, op: name, args });
        if (name === "update" || name === "insert" || name === "delete") mode = name;
        return b;
      };
    for (const n of ["select", "eq", "in", "order", "limit", "update", "insert", "delete"])
      b[n] = chain(n);
    b["maybeSingle"] = async () => ({
      data: table === "crm_followups" ? openRow : { id: 1 },
      error: null,
    });
    b["single"] = async () => ({ data: { id: "new-followup" }, error: null });
    b["then"] = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null, mode }).then(resolve);
    return b;
  };
  const client = {
    from: (table: string) => {
      tables.push(table);
      return builder(table);
    },
    rpc: vi.fn(async () => ({ data: [], error: null })),
  };
  return { client: client as unknown as Client, ops, tables };
}

const OPEN = {
  id: "f1",
  kind: "ticket",
  item_id: "t1",
  assignee_id: "rep-1",
  title: "Ticket #101 Acme",
  due_at: "2026-10-03T12:00:00.000Z",
  reminders_sent: 0,
  status: "open",
};

const args = (over: Partial<Parameters<typeof syncFollowup>[0]>) => ({
  kind: "ticket" as const,
  itemId: "t1",
  accountId: null,
  assigneeId: "rep-1",
  title: "Ticket #101 Acme",
  url: "/service?id=t1",
  closing: false,
  closeReason: "",
  dueDate: "2026-10-03",
  actorId: "rep-1",
  actorName: "Rep",
  ...over,
});

describe("syncFollowup runs for everyone (not behind the manager check)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a rep invoicing / closing the item closes its follow-up, marked closed_by_sync", async () => {
    const { client, ops, tables } = fakeClient(OPEN);
    await expect(
      syncFollowup(args({ closing: true, closeReason: "stage done" }), client),
    ).resolves.toBe("closed");
    const update = ops.find((o) => o.table === "crm_followups" && o.op === "update");
    expect(update?.args[0]).toMatchObject({
      status: "closed",
      closed_reason: "stage done",
      closed_by_sync: true,
    });
    // It never looks up the caller's role: no profiles read, no manager check.
    expect(tables).not.toContain("profiles");
  });

  it("unassigning closes it the same way", async () => {
    const { client, ops } = fakeClient(OPEN);
    await expect(syncFollowup(args({ assigneeId: null }), client)).resolves.toBe("closed");
    expect(ops.find((o) => o.op === "update")?.args[0]).toMatchObject({
      closed_reason: "unassigned",
      closed_by_sync: true,
    });
  });

  it("reassigning closes the old row (closed_by_sync) and starts a new one", async () => {
    const { client, ops } = fakeClient(OPEN);
    await expect(syncFollowup(args({ assigneeId: "rep-2" }), client)).resolves.toBe("reassigned");
    expect(ops.find((o) => o.op === "update")?.args[0]).toMatchObject({
      closed_reason: "reassigned",
      closed_by_sync: true,
    });
    expect(ops.some((o) => o.op === "insert")).toBe(true);
  });

  it("a moved date moves the due date (no snooze, no close)", async () => {
    const { client, ops } = fakeClient(OPEN);
    await expect(syncFollowup(args({ dueDate: "2026-10-10" }), client)).resolves.toBe("unchanged");
    const patch = ops.find((o) => o.op === "update")?.args[0] as Record<string, unknown>;
    expect(patch["due_at"]).toBe("2026-10-10T12:00:00.000Z");
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("snoozed_until");
  });

  it("the sync module does not import the manager rule", () => {
    const src = readFileSync("src/lib/followups.server.ts", "utf8");
    expect(src).not.toMatch(
      /from "@\/lib\/followup-rules"|canManageFollowup\(|FOLLOWUP_MANAGER_ONLY/,
    );
    expect(src).toContain("closed_by_sync: true");
  });
});
