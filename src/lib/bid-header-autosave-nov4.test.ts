/**
 * Owner, Nov 4: "can we have the status box and due date auto save at change?" — on a saved bid
 * the estimator's Status (with its lost reason and won day) and due date save the moment they
 * change, the header alone, through the Bids list's own setBidStatus and the new setBidDueDate;
 * the body's pending edits stay pending (two baselines). A new bid keeps them for its first Save.
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

import { BID_DUE_KEEP } from "@/lib/bid-status";
import { setBidDueDate } from "@/lib/bids.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const EST = "00000000-0000-4000-8000-00000000000e";
const BID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GONE = "99999999-9999-4999-8999-999999999999";

let env: ReturnType<typeof fakeSupabase>;
function setup(bid: Row = {}) {
  env = fakeSupabase({
    profiles: [{ id: EST, role: "user", access: ["estimate"], full_name: "Eve", email: "e@x" }],
    bids: [
      {
        id: BID,
        name: "A bid",
        status: "draft",
        due_date: "2026-12-01",
        deleted_at: null,
        updated_at: "2026-11-01T10:00:00Z",
        content_saved_at: "2026-11-01T10:00:00Z",
        ...bid,
      },
    ],
  });
}
const call = <T = unknown>(fn: unknown, data: Row) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId: EST },
  });
const bidRow = () => env.tables["bids"]!.find((r) => r["id"] === BID)!;

beforeEach(() => setup());

describe("setBidDueDate (the estimator's due-date box, saved on its own)", () => {
  it("a day replaces the stored one; updated_at and the name move, content_saved_at does not", async () => {
    const r = await call<Row>(setBidDueDate, { id: BID, dueDate: "2026-12-20" });
    expect(r["due_date"]).toBe("2026-12-20");
    expect(typeof r["updated_at"]).toBe("string");
    expect(bidRow()["due_date"]).toBe("2026-12-20");
    expect(bidRow()["updated_by_name"]).toBe("Eve");
    expect(bidRow()["content_saved_at"]).toBe("2026-11-01T10:00:00Z");
  });
  it("clearing it on a draft is refused with the same words as Save; on a won bid it clears", async () => {
    await expect(call(setBidDueDate, { id: BID, dueDate: null })).rejects.toThrow(BID_DUE_KEEP);
    expect(bidRow()["due_date"]).toBe("2026-12-01");
    setup({ status: "won" });
    const r = await call<Row>(setBidDueDate, { id: BID, dueDate: null });
    expect(r["due_date"]).toBeNull();
  });
  it("a bid that is gone, or deleted, is refused; a malformed day is refused before any read", async () => {
    await expect(call(setBidDueDate, { id: GONE, dueDate: "2026-12-20" })).rejects.toThrow(
      "Bid not found",
    );
    setup({ deleted_at: "2026-11-02T00:00:00Z" });
    await expect(call(setBidDueDate, { id: BID, dueDate: "2026-12-20" })).rejects.toThrow(
      "Bid not found",
    );
    await expect(
      Promise.resolve().then(() => call(setBidDueDate, { id: BID, dueDate: "12/20/2026" })),
    ).rejects.toThrow();
  });
});

describe("the estimator (src/routes/estimate.tsx)", () => {
  const page = readFileSync("src/routes/estimate.tsx", "utf8");
  it("two baselines: the body and the header, so a header saved alone leaves the body's edits pending", () => {
    expect(page).toContain("const lastSavedBody = useRef<string | null>(null);");
    expect(page).toContain("const lastSavedHeader = useRef<BidHeader | null>(null);");
    expect(page).toMatch(
      /const dirty =\s*lastSavedBody\.current !== null &&\s*lastSavedHeader\.current !== null &&\s*\(bodyJsonOf\(bidName\) !== lastSavedBody\.current \|\|\s*headerJsonOf\(tabHeader\) !== headerJsonOf\(lastSavedHeader\.current\)\);/,
    );
    expect(page).not.toContain("lastSavedJson");
  });
  it("Status saves at change: the picker, the lost reason and the won day, through setBidStatus", () => {
    expect(page).toContain("const statusSaveFn = useServerFn(setBidStatusFn);");
    expect(page).toMatch(
      /const changeStatus = \(v: string\) => \{[\s\S]*?setLostReason\(null\);\s*void autoSaveStatus\(st, null, wonOn\);\s*\};/,
    );
    expect(page).toMatch(
      /onConfirm=\{\(reason\) => \{\s*setBidStatus\("lost"\);\s*setLostReason\(reason\);\s*setAskLost\(false\);\s*void autoSaveStatus\("lost", reason, ""\);/,
    );
    expect(page).toContain('dayTyped(() => void autoSaveStatus("won", null, v));');
    // Only a saved bid, never read-only; the header baseline and the row stamp move with it.
    expect(page).toMatch(
      /const autoSaveStatus = async \(status: BidStatus, reason: string \| null, wonOn: string\) => \{\s*if \(!bidId \|\| readOnly\) return;/,
    );
    expect(page).toContain("if (updatedAt) loadedUpdatedAt.current = updatedAt;");
    expect(page).toContain(
      "if (lastSavedHeader.current) lastSavedHeader.current = { ...lastSavedHeader.current, ...patch };",
    );
    expect(page).toContain("toast.success(`Status saved: ${STATUS_LABELS[status]}`);");
    // The marker is recomputed, and the bid's cached row carries the saved columns, so reopening
    // the bid in this tab shows what was saved (the full save seeds the cache with its row too).
    expect(page).toContain("setHeaderStamp((n) => n + 1);");
    expect(page).toMatch(
      /qc\.setQueryData\(\["bid", bidId\], \(old: Record<string, unknown> \| undefined\) =>\s*old \? \{ \.\.\.old, \.\.\.cols, \.\.\.\(updatedAt \? \{ updated_at: updatedAt \} : \{\}\) \} : old,/,
    );
    expect(page).toContain('if (row) qc.setQueryData(["bid", row.id], row);');
  });
  it("the due date saves when the typing stops or the box is left, never a half-typed year, with Save's rule", () => {
    expect(page).toContain("const dueDateSaveFn = useServerFn(setBidDueDateFn);");
    expect(page).toContain("const DAY_SAVE_MS = 900;");
    expect(page).toContain(
      'const completeDay = (v: string) => v === "" || (/^\\d{4}-\\d{2}-\\d{2}$/.test(v) && v >= "2000");',
    );
    expect(page).toMatch(
      /const autoSaveDueDate = async \(v: string\) => \{\s*if \(!bidId \|\| readOnly \|\| !completeDay\(v\)\) return;\s*const problem = bidDueDateProblem\(\{\s*isNew: false,/,
    );
    expect(page).toContain("hadDueDate: !!lastSavedHeader.current?.dueDate,");
    const due = page.slice(
      page.indexOf('id="bid-due-date"'),
      page.indexOf("Give the bid a due date before saving"),
    );
    expect(due).toContain("dayTyped(() => void autoSaveDueDate(v));");
    expect(due).toContain("dayLeft(() => void autoSaveDueDate(v));");
    expect(page).toContain("— Save the bid to keep it.");
  });
});
