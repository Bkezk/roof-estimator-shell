/**
 * Owner, Nov 13: "have the bid status be able to be updated on the work overview page like how
 * you can assign unassigned jobs on tickets". A bid row on Work Overview carries the Bids page's
 * status select: Submitted saves at once, Won asks the day, Lost asks why. Work Overview lists
 * draft bids only, so the row leaves; the toast says where it went and offers Undo.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BID_STATUSES, STATUS_LABELS } from "@/lib/bid-status";
import { bidItem, type WorkItem } from "@/lib/my-work";
import {
  BID_LEFT_WORK_OVERVIEW,
  BID_STATUS_CHOICES,
  bidStatusAsks,
  bidStatusHere,
  bidStatusToast,
  workId,
} from "@/lib/my-work-actions";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const kindOnly = (kind: WorkItem["kind"]) => ({ kind });

describe("the rules", () => {
  it("only a bid row carries the status select", () => {
    expect(bidStatusHere(kindOnly("bid"))).toBe(true);
    for (const k of ["ticket", "inspection", "task", "followup", "opportunity"] as const)
      expect(bidStatusHere(kindOnly(k))).toBe(false);
  });

  it("the choices are the Bids page's four, in its order, with its labels", () => {
    expect(BID_STATUS_CHOICES.map((c) => c.value)).toEqual([...BID_STATUSES]);
    expect(BID_STATUS_CHOICES.map((c) => c.label)).toEqual(["Draft", "Submitted", "Won", "Lost"]);
    for (const c of BID_STATUS_CHOICES) expect(c.label).toBe(STATUS_LABELS[c.value]);
  });

  it("Won asks the day, Lost asks the reason, Submitted and Draft save at once", () => {
    expect(bidStatusAsks("won")).toBe("day");
    expect(bidStatusAsks("lost")).toBe("reason");
    expect(bidStatusAsks("submitted")).toBeNull();
    expect(bidStatusAsks("draft")).toBeNull();
  });

  it("the toast: the Bids page's words, where the row went, and Undo", () => {
    expect(bidStatusToast("submitted")).toEqual({
      title: "Status: Submitted",
      description: BID_LEFT_WORK_OVERVIEW,
      undo: true,
    });
    expect(bidStatusToast("won").title).toBe("Status: Won");
    expect(bidStatusToast("lost").undo).toBe(true);
    // Undo itself: back to Draft, back on the page, nothing more to undo.
    expect(bidStatusToast("draft")).toEqual({
      title: "Status: Draft",
      description: null,
      undo: false,
    });
    expect(BID_LEFT_WORK_OVERVIEW).toBe(
      "Work Overview lists draft bids only. This one is on the Bids page now.",
    );
  });

  it("a row is a draft bid and its id is the bid's (what the select sends)", () => {
    const row = bidItem({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Acme warehouse",
      status: "draft",
      due_date: "2026-11-20",
      created_by: null,
      account_name: null,
    } as Parameters<typeof bidItem>[0]);
    expect(row).not.toBeNull();
    expect(bidStatusHere(row!)).toBe(true);
    expect(workId(row!)).toBe("11111111-1111-4111-8111-111111111111");
    // Once it is anything but a draft the page does not list it: the row leaves.
    for (const status of ["submitted", "won", "lost"])
      expect(
        bidItem({
          id: "x",
          name: "n",
          status,
          due_date: null,
          created_by: null,
          account_name: null,
        } as Parameters<typeof bidItem>[0]),
      ).toBeNull();
  });
});

describe("the wiring", () => {
  const hook = flat("src/components/my-work-actions.tsx");
  const page = flat("src/components/my-work-page.tsx");
  const control = flat("src/components/work-bid-status.tsx");

  it("the row draws the select beside Assign to…, and the page mounts the questions once", () => {
    expect(page).toContain("const bidNode = actions ? actions.bidStatus(item) : null;");
    expect(page).toContain("{(tick || mapHref || assignNode || bidNode || showClaim) && (");
    expect(page).toContain("{bidNode} {assignNode}");
    expect(page).toContain("{bidDialogs}");
  });

  it("the save is the Bids page's own call, with the day for Won and the reason for Lost", () => {
    expect(hook).toContain('import { setBidStatus } from "@/lib/bids.functions";');
    expect(hook).toContain("const bidStatusFn = useServerFn(setBidStatus);");
    expect(hook).toContain(
      'bidStatus.mutate({ id: wonFor.id, status: "won", wonOn: wonFor.day || null });',
    );
    expect(hook).toContain(
      'bidStatus.mutate({ id: lostFor.id, status: "lost", lostReason: reason });',
    );
    expect(hook).toContain(
      'if (asks === "day") setWonFor({ id, name: item.title, day: bidOfficeToday() });',
    );
    expect(hook).toContain('else if (asks === "reason") setLostFor({ id, name: item.title });');
    expect(hook).toContain("else bidStatus.mutate({ id, status });");
  });

  it("a change refreshes Work Overview and the Bids list; Undo sets the bid back to Draft", () => {
    const at = hook.indexOf("const bidStatus = useMutation({");
    const body = hook.slice(at, hook.indexOf("const [wonFor, setWonFor]", at));
    expect(body).toContain("invalidate();");
    expect(body).toContain('void qc.invalidateQueries({ queryKey: ["bids"] });');
    // Undo is marked as one (the audit, finding 4): the opportunity goes back too.
    expect(body).toContain(
      'onClick: () => bidStatus.mutate({ id: b.id, status: "draft", undo: true }),',
    );
    expect(body).toContain('toast.error(errText(e) || "Could not change status");');
  });

  it("a row whose change is in flight has its select off", () => {
    expect(hook).toContain("bidStatus.isPending ? bidStatus.variables?.id : null,");
    expect(hook).toContain("disabled={pendingIds.has(id)}");
  });

  it("the Won question is the Bids page's, word for word", () => {
    const bids = flat("src/routes/bids.tsx");
    for (const words of [
      "<DialogTitle>When was it won?</DialogTitle>",
      "is being marked Won. The Margin report counts it on this day; it can be changed later in the report or in the estimator.",
      "Mark won",
    ]) {
      expect(control, words).toContain(words);
      expect(bids, words).toContain(words);
    }
    expect(control).toContain('data-select="bid-status"');
    expect(control).toContain("if (v && v !== value) onPick(v as BidStatus);");
  });
});
