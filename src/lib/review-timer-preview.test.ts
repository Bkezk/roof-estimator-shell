/**
 * Seventh audit, Oct 21 (bug 5): the database now lets only the service role, an admin or a
 * manager start or close the review timer (follow-up kind "invoice",
 * 20261021101000_followup_sync_invoice_caller.sql). The published app runs the sync as the
 * system (server key). The preview has no key and runs as the signed-in user, so a technician
 * marking a ticket Done there is refused with 42501 after the stage was written — syncFollowup
 * must fail safely (a warning, no throw) for that one kind, and only without the key; every
 * other refusal still surfaces.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const env = { serviceRole: false };
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
  hasServiceRole: () => env.serviceRole,
}));

import { syncFollowup } from "./followups.server";
import type { Client } from "@/lib/notify.server";

const FORBIDDEN = { code: "42501", message: "Only the office starts or closes a review timer" };

function client(openRow: Record<string, unknown> | null, rpcError: unknown) {
  const b: Record<string, unknown> = {};
  for (const n of ["select", "eq", "in", "order", "limit", "update", "insert", "delete"])
    b[n] = () => b;
  b["maybeSingle"] = async () => ({ data: openRow, error: null });
  b["single"] = async () => ({ data: { id: "x" }, error: null });
  b["then"] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(resolve);
  const rpc = vi.fn(async () => ({ data: null, error: rpcError }));
  return { client: { from: () => b, rpc } as unknown as Client, rpc };
}

const invoice = (over: Record<string, unknown> = {}) => ({
  kind: "invoice" as const,
  itemId: "t1",
  accountId: null,
  assigneeId: "mgr-1",
  title: "Authorize Ticket #101 Acme",
  url: "/service?id=t1",
  closing: false,
  closeReason: "",
  dueDate: null,
  actorId: "tech-1",
  actorName: "Tech",
  ...over,
});

describe("the review timer in the preview (no server key)", () => {
  afterEach(() => {
    env.serviceRole = false;
    vi.restoreAllMocks();
  });

  it("a refused start is a warning, not an error — the Done save still succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client: sb, rpc } = client(null, FORBIDDEN);
    await expect(syncFollowup(invoice(), sb)).resolves.toBe("unchanged");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("a refused close is a warning too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const open = { id: "f1", kind: "invoice", item_id: "t1", assignee_id: "mgr-1", status: "open" };
    const { client: sb } = client(open, FORBIDDEN);
    await expect(
      syncFollowup(invoice({ closing: true, closeReason: "stage authorized" }), sb),
    ).resolves.toBe("closed");
  });

  it("WITH the server key the same refusal is an error (something is wrong, say so)", async () => {
    env.serviceRole = true;
    const { client: sb } = client(null, FORBIDDEN);
    await expect(syncFollowup(invoice(), sb)).rejects.toThrow(/review timer/);
  });

  it("a ticket follow-up refusal is never swallowed", async () => {
    const { client: sb } = client(null, FORBIDDEN);
    await expect(
      syncFollowup(invoice({ kind: "ticket", dueDate: "2026-10-22" }), sb),
    ).rejects.toThrow(/review timer/);
  });

  it("any other error on the review timer still surfaces", async () => {
    const { client: sb } = client(null, { code: "XX000", message: "boom" });
    await expect(syncFollowup(invoice(), sb)).rejects.toThrow(/boom/);
  });
});
