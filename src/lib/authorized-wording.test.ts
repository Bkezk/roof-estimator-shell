/**
 * Wording around the Authorized stage (owner, Oct 6). Three notices said the wrong thing after M9
 * added the stage: (a) voiding an invoice sends the ticket back to Authorized, and the office read
 * "Ticket #… authorized — ready to invoice. <voider> authorized it."; (b) the authorizer's
 * follow-up notice read "To invoice assigned to you: Authorize Ticket #…" though nothing is to be
 * invoiced yet; (c) a technician on an Authorized ticket read "The office has invoiced or closed
 * this ticket" while the office was still reviewing it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const notify = vi.hoisted(() =>
  vi.fn<
    (
      ids: string[],
      msg: { kind: string; title: string; body: string },
      sb: unknown,
    ) => Promise<number>
  >(async () => 1),
);
const syncFollowup = vi.hoisted(() => vi.fn(async () => "unchanged"));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify,
}));
vi.mock("@/lib/followups.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/followups.server")>()),
  syncFollowup,
}));

import { afterTicketStage } from "@/lib/ticket-events.server";
import { startNotice } from "@/lib/followups.server";
import { officeStageMessage } from "@/lib/office-stage-message";
import type { Client } from "@/lib/notify.server";

const ROSTER = [
  { id: "tech-1", full_name: "Ted Tech", email: "t@x", technician: true },
  { id: "office-1", full_name: "Olive Office", email: "o@x", technician: false },
  { id: "admin-1", full_name: "Ann Admin", email: "a@x", technician: false },
];
const sb = { rpc: vi.fn(async () => ({ data: ROSTER, error: null })) } as unknown as Client;
const row = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  number: 101,
  customer_name: "Acme",
  description: "Leak",
  stage: "authorized",
  account_id: "acct-1",
  technician_id: "tech-1",
  created_by: "office-1",
  deleted_at: null as string | null,
  ...over,
});
const ANN = { id: "admin-1", name: "Ann Admin" };

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe("(a) a void that sends the ticket back to Authorized", () => {
  it("tells the office the invoice was voided, not that the ticket was authorized", async () => {
    await afterTicketStage(row(), "invoiced", ANN, sb, { reason: "void" });
    expect(notify).toHaveBeenCalledTimes(1);
    const [ids, msg] = notify.mock.calls[0]!;
    expect(ids.sort()).toEqual(["office-1"]); // the office, less the voider
    expect(msg.kind).toBe("ticket_authorized");
    expect(msg.title).toBe(
      "Ticket #101 Acme — Leak back to Authorized — its invoice was voided by Ann Admin.",
    );
    expect(msg.title).not.toContain("ready to invoice");
    expect(msg.body).not.toContain("authorized it");
    expect(msg.body).toContain("voided");
  });
  it("a real authorization (Done → Authorized) still reads 'authorized — ready to invoice'", async () => {
    await afterTicketStage(row(), "done", ANN, sb);
    const [, msg] = notify.mock.calls[0]!;
    expect(msg.title).toBe("Ticket #101 Acme — Leak authorized — ready to invoice");
    expect(msg.body).toContain("Ann Admin authorized it.");
  });
});

describe("(b) the authorizer's follow-up notice", () => {
  const base = {
    reopened: false,
    actorName: "Ted Tech",
    due: new Date("2026-10-07T12:00:00Z"),
    every: 3,
  };
  it("reads 'Authorize Ticket #… — ready for your review'", () => {
    const n = startNotice({ ...base, kind: "invoice", title: "Authorize Ticket #101 Acme — Leak" });
    expect(n.title).toBe("Authorize Ticket #101 Acme — Leak — ready for your review");
    expect(n.title).not.toContain("To invoice");
    expect(n.body).toContain("Ted Tech assigned this to you.");
  });
  it("other kinds are unchanged", () => {
    expect(startNotice({ ...base, kind: "ticket", title: "Ticket #7" }).title).toBe(
      "Ticket assigned to you: Ticket #7",
    );
    expect(startNotice({ ...base, kind: "opportunity", title: "Re-roof" }).title).toBe(
      "Opportunity assigned to you: Re-roof",
    );
    expect(
      startNotice({ ...base, kind: "opportunity", title: "Re-roof", reopened: true }).title,
    ).toBe("Opportunity reopened: Re-roof");
  });
});

describe("(c) what a technician reads on a ticket the office holds", () => {
  it("Authorized: the office is reviewing it", () => {
    expect(officeStageMessage("authorized")).toBe(
      "The office is reviewing this ticket — it is Authorized",
    );
  });
  it("Invoiced / Closed: as before", () => {
    for (const s of ["invoiced", "closed"])
      expect(officeStageMessage(s)).toBe("The office has invoiced or closed this ticket");
  });
  it("the close-out screen and the inspection save both use it", () => {
    const closeout = readFileSync("src/components/service/closeout.tsx", "utf8");
    expect(closeout).toContain('import { officeStageMessage } from "@/lib/office-stage-message";');
    expect(closeout).toContain(
      "`${officeStageMessage(job.stage)}; ask the office if something needs changing.`",
    );
    expect(closeout).not.toContain('"The office has invoiced or closed this ticket;');
    const inspection = readFileSync("src/lib/service-inspection.functions.ts", "utf8");
    expect(inspection).toContain(
      'import { officeStageMessage } from "@/lib/office-stage-message";',
    );
    expect(inspection).toContain("`${officeStageMessage(job.stage)}; ask the office to change it`");
    expect(inspection).not.toContain('"The office has invoiced or closed this ticket;');
  });
});
