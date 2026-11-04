/**
 * Owner, Nov 4 ("go with item 5"): the Opportunities list row says who still needs a call —
 * "Last contact: Called Nov 4, 5:41 PM by Claude — <note>" from the latest contact logged, or
 * "No contact yet" while the opportunity is open, and "Next reminder Nov 7" from the open
 * follow-up. Both come with the list in the same read (listOpportunities → withNames: one
 * follow-up query, one contact-log query for every row), not one request per row.
 * Fails on the old code.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));

import { getOpportunity, listOpportunities } from "@/lib/opportunities.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const REP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPP = "11111111-1111-4111-8111-111111111111";
const OPP2 = "22222222-2222-4222-8222-222222222222";
const ACC = "55555555-5555-4555-8555-555555555555";

let env: ReturnType<typeof fakeSupabase>;
beforeEach(() => {
  env = fakeSupabase({
    profiles: [
      {
        id: REP,
        role: "user",
        access: ["customers"],
        technician: false,
        full_name: "Rae",
        email: "r@x",
      },
    ],
    crm_accounts: [{ id: ACC, name: "Gym" }],
    crm_sites: [],
    bids: [],
    crm_opportunities: [
      {
        id: OPP,
        title: "Reroof gym",
        account_id: ACC,
        assignee_id: REP,
        status: "open",
        deleted_at: null,
        updated_at: "2026-11-04T10:00:00Z",
      },
      {
        id: OPP2,
        title: "Quiet one",
        account_id: ACC,
        assignee_id: REP,
        status: "open",
        deleted_at: null,
        updated_at: "2026-11-03T10:00:00Z",
      },
    ],
    crm_followups: [
      {
        id: "f1",
        kind: "opportunity",
        item_id: OPP,
        status: "open",
        snoozed_until: null,
        next_remind_at: "2026-11-07T22:41:00Z",
      },
      {
        id: "f0",
        kind: "opportunity",
        item_id: OPP2,
        status: "closed",
        snoozed_until: null,
        next_remind_at: "2026-10-01T12:00:00Z",
      },
    ],
    crm_contact_log: [
      {
        id: 1,
        kind: "opportunity",
        item_id: OPP,
        method: "emailed",
        at: "2026-11-01T12:00:00Z",
        by_name: "Rae",
        note: null,
      },
      {
        id: 2,
        kind: "opportunity",
        item_id: OPP,
        method: "called",
        at: "2026-11-04T22:41:00Z",
        by_name: "Claude",
        note: "left a message",
      },
      // A comment and a note are not contacts: they never count as the last one.
      {
        id: 3,
        kind: "opportunity",
        item_id: OPP,
        method: "comment",
        at: "2026-11-05T09:00:00Z",
        by_name: "Rae",
        note: "later",
      },
      {
        id: 4,
        kind: "opportunity",
        item_id: OPP2,
        method: "note",
        at: "2026-11-05T09:00:00Z",
        by_name: "Rae",
        note: "Expected close moved",
      },
      // Another kind's row with the same id is someone else's.
      {
        id: 5,
        kind: "ticket",
        item_id: OPP2,
        method: "visited",
        at: "2026-11-05T09:00:00Z",
        by_name: "Tim",
        note: null,
      },
    ],
  });
});
const call = <T = unknown>(fn: unknown, data: Row) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId: REP },
  });

describe("listOpportunities carries the latest contact and the next reminder", () => {
  it("the newest contact (not a comment or a note), and the open follow-up's next reminder", async () => {
    // Count the table reads the list makes.
    const db = env.db as unknown as { from: (t: string) => unknown };
    const from = db.from;
    const reads: string[] = [];
    db.from = (t: string) => {
      reads.push(t);
      return from(t);
    };
    const list = await call<Row[]>(listOpportunities, {});
    const a = list.find((r) => r["id"] === OPP)!;
    expect(a["last_contact"]).toEqual({
      method: "called",
      at: "2026-11-04T22:41:00Z",
      by_name: "Claude",
      note: "left a message",
    });
    expect(a["next_remind_at"]).toBe("2026-11-07T22:41:00Z");
    const b = list.find((r) => r["id"] === OPP2)!;
    expect(b["last_contact"]).toBeNull();
    expect(b["next_remind_at"]).toBeNull();
    // One follow-up read and one contact-log read for the whole list, never one per row.
    expect(reads.filter((t) => t === "crm_followups")).toHaveLength(1);
    expect(reads.filter((t) => t === "crm_contact_log")).toHaveLength(1);
  });
  it("getOpportunity carries them too (the same shaping)", async () => {
    const o = await call<Row>(getOpportunity, { id: OPP });
    expect(o["last_contact"]).toMatchObject({ method: "called" });
    expect(o["next_remind_at"]).toBe("2026-11-07T22:41:00Z");
  });
});

describe("the list row (src/components/opportunities-page.tsx)", () => {
  const page = readFileSync("src/components/opportunities-page.tsx", "utf8");
  const start = page.indexOf('data-line="contact"');
  const line = page.slice(
    page.lastIndexOf("{(o.last_contact ||", start),
    page.indexOf("</p>", start),
  );
  it("says the last contact (method, when, who, the note cut short) or 'No contact yet' while open", () => {
    expect(start).toBeGreaterThan(0);
    expect(line).toContain("{(o.last_contact || isOpenOppStatus(status)) && (");
    expect(line).toContain("Last contact:");
    expect(line).toContain("{contactMethodLabel(o.last_contact.method)}");
    expect(line).toContain("{whenShort(o.last_contact.at)}");
    expect(line).toContain('{o.last_contact.by_name ? ` by ${o.last_contact.by_name}` : ""}');
    expect(line).toContain('{o.last_contact.note ? ` — ${cutNote(o.last_contact.note)}` : ""}');
    expect(line).toContain('"No contact yet"');
  });
  it("and the next reminder on an open one with a timer, not while on hold", () => {
    expect(line).toContain("isOpenOppStatus(status) && o.next_remind_at && !isOppHeld(o, today)");
    expect(line).toContain("` · Next reminder ${dayShort(o.next_remind_at)}`");
    expect(page).toContain("const NOTE_CUT = 90;");
  });
});
