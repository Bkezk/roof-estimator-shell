/**
 * Bids, Nov 19, later (owner: "Go on 1, 2"; docs/qa/bids-draft-restore-2026-11-19.md).
 *
 *  1. An estimator's unsaved work is kept in the browser and offered back. Until now whatever
 *     was not saved lived only on the page: a lost sign-in, a closed browser, a computer that
 *     shut down, or a reload of a bid started from PlanSwift threw it away.
 *  2. New custom items show right under the add box, the newest first. Until now an added item
 *     went to the bottom of the list, below every stock row, and the box was a scroll away.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { customRowsShown } from "@/components/nondl-custom-box";
import {
  BID_DRAFT_DELAY_MS,
  BID_DRAFT_VERSION,
  draftKey,
  draftOffer,
  draftQueue,
  draftWords,
  mayWriteDraft,
  memoryDraftStore,
  readDraft,
  worthKeeping,
  type BidDraft,
} from "@/lib/bid-draft";
import { BID_DRAFT_DB, openBidDraftStore } from "@/lib/bid-draft-store";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const ME = "user-1";
const BID = "bid-1";
const header = {
  status: "draft" as const,
  lostReason: null,
  wonOn: "",
  dueDate: "2027-03-01",
  folder: "",
  reminderOn: "",
  reminderNote: "",
};
const draft = (over: Partial<BidDraft> = {}): BidDraft => {
  const bidId = over.bidId === undefined ? BID : over.bidId;
  const userId = over.userId ?? ME;
  return {
    v: BID_DRAFT_VERSION,
    key: draftKey(userId, bidId),
    userId,
    bidId,
    savedAt: "2027-02-10T16:31:00Z",
    baseUpdatedAt: bidId ? "2027-02-10T16:01:00Z" : null,
    name: "North Plant",
    accountId: null,
    siteId: null,
    accountLabel: "",
    linkChanged: false,
    buildingId: null,
    opportunityId: null,
    inspectionId: null,
    header,
    data: { sections: [{ id: "s1" }], markup: 41 },
    print: "work-as-typed",
    ...over,
  };
};

describe("1. the unsaved work is kept and offered back", () => {
  it("one draft for each person and each bid; a bid never saved shares one slot", () => {
    expect(draftKey(ME, BID)).toBe("bid-draft:user-1:bid-1");
    expect(draftKey(ME, null)).toBe("bid-draft:user-1:new");
    expect(draftKey(ME, undefined)).toBe(draftKey(ME, null));
    expect(draftKey("user-2", BID)).not.toBe(draftKey(ME, BID));
  });

  it("opening the bid asks about a draft, and never when there is none", () => {
    const page = { updatedAt: "2027-02-10T16:01:00Z", print: "as-saved" };
    expect(draftOffer(null, page)).toBeNull();
    expect(draftOffer(draft(), page)).toEqual({ draft: draft(), changedSince: false });
  });

  it("a draft that is the very work the page shows is not asked about", () => {
    expect(
      draftOffer(draft(), { updatedAt: "2027-02-10T16:01:00Z", print: "work-as-typed" }),
    ).toBeNull();
  });

  it("a bid saved again since the draft's work began still asks, and says so", () => {
    const o = draftOffer(draft(), { updatedAt: "2027-02-11T09:00:00Z", print: "as-saved" })!;
    expect(o.changedSince).toBe(true);
    const w = draftWords(o, "America/New_York");
    expect(w.title).toBe("Restore your unsaved work?");
    expect(w.body).toBe(
      "Unsaved work on this bid from Wed, Feb 10, 11:31 AM was kept on this computer. It was never saved. Restore it to carry on where you stopped, or discard it and keep the bid as it was last saved. This bid has been saved again since that work was done. If you restore it and press Save, your work replaces what was saved since.",
    );
    // The same saved bid: nothing about anyone else.
    const same = draftOffer(draft(), { updatedAt: "2027-02-10T16:01:00.000Z", print: "as-saved" })!;
    expect(same.changedSince).toBe(false);
    expect(draftWords(same, "America/New_York").body).not.toContain("saved again");
  });

  it("a new bid's draft is named, and is never 'changed since'", () => {
    const d = draft({ bidId: null });
    const o = draftOffer(d, { updatedAt: null, print: "blank-new-bid" })!;
    expect(o.changedSince).toBe(false);
    expect(draftWords(o, "America/New_York").body).toBe(
      "Unsaved work on a new bid, “North Plant”, from Wed, Feb 10, 11:31 AM was kept on this computer. It was never saved. Restore it to carry on where you stopped, or discard it and start fresh.",
    );
    const untitled = draftOffer(draft({ bidId: null, name: "Untitled bid" }), {
      updatedAt: null,
      print: "x",
    })!;
    expect(draftWords(untitled, "America/New_York").body).toContain(
      "Unsaved work on a new bid from",
    );
  });

  it("another person's draft on a shared computer is never offered, nor one for another bid", () => {
    const stored = JSON.parse(JSON.stringify(draft()));
    expect(readDraft(stored, { userId: ME, bidId: BID })).toEqual(draft());
    expect(readDraft(stored, { userId: "user-2", bidId: BID })).toBeNull();
    expect(readDraft(stored, { userId: ME, bidId: "bid-2" })).toBeNull();
    expect(readDraft(stored, { userId: ME, bidId: null })).toBeNull();
    // Kept under someone's key with another person's name inside: not offered either.
    expect(
      readDraft({ ...stored, key: draftKey("user-2", BID) }, { userId: ME, bidId: BID }),
    ).toBeNull();
  });

  it("anything that is not a whole draft is no draft", () => {
    const stored = JSON.parse(JSON.stringify(draft()));
    for (const bad of [
      null,
      "text",
      {},
      { ...stored, v: 0 },
      { ...stored, savedAt: "not a time" },
      { ...stored, data: { markup: 41 } },
      { ...stored, data: null },
      { ...stored, header: null },
      { ...stored, print: "" },
      { ...stored, name: 7 },
    ])
      expect(readDraft(bad, { userId: ME, bidId: BID })).toBeNull();
  });

  it("nothing is written before the question is answered, from a read-only page, or mid-save", () => {
    const ok = { gate: "open" as const, dirty: true, readOnly: false, saving: false };
    expect(mayWriteDraft(ok)).toBe(true);
    expect(mayWriteDraft({ ...ok, gate: "checking" })).toBe(false);
    expect(mayWriteDraft({ ...ok, gate: "asking" })).toBe(false);
    expect(mayWriteDraft({ ...ok, dirty: false })).toBe(false);
    expect(mayWriteDraft({ ...ok, readOnly: true })).toBe(false);
    expect(mayWriteDraft({ ...ok, saving: true })).toBe(false);
    expect(BID_DRAFT_DELAY_MS).toBe(1500);
  });

  it("a new bid nobody has typed into is not kept: it holds only its starting fills", () => {
    // A saved bid's unsaved page is always kept.
    expect(worthKeeping("changed", false, null)).toBe(true);
    // A new bid as it stood before the first key or click: nothing of anyone's work.
    expect(worthKeeping("start", true, "start")).toBe(false);
    expect(worthKeeping("start-plus-typing", true, "start")).toBe(true);
    expect(worthKeeping("", true, "start")).toBe(false);
    expect(worthKeeping("", false, null)).toBe(false);
  });

  it("the store keeps a copy, and a removal asked after a write always wins", async () => {
    const store = memoryDraftStore();
    const live = draft();
    await store.put(live);
    // A copy, as real storage keeps one.
    (live.data as Record<string, unknown>)["markup"] = 99;
    expect(
      (
        readDraft(await store.get(live.key), { userId: ME, bidId: BID })!.data as Record<
          string,
          unknown
        >
      )["markup"],
    ).toBe(41);
    // A slow write followed at once by the removal that Save asks for.
    const run = draftQueue();
    let release = () => {};
    const slow = new Promise<void>((r) => (release = r));
    void run(async () => {
      await slow;
      await store.put(draft());
    });
    const removed = run(() => store.remove(draftKey(ME, BID)));
    release();
    await removed;
    expect(await store.get(draftKey(ME, BID))).toBeUndefined();
  });

  it("a failed write does not stop what follows", async () => {
    const seen: unknown[] = [];
    const run = draftQueue((e) => seen.push(e));
    const store = memoryDraftStore();
    void run(async () => {
      throw new Error("storage is full");
    });
    await run(() => store.put(draft()));
    expect(seen).toHaveLength(1);
    expect(await store.get(draftKey(ME, BID))).toBeDefined();
  });

  it("with no browser storage the page carries on with a store that lasts while it is open", async () => {
    const none = await openBidDraftStore(undefined);
    expect(none.fallback).toBe(true);
    await none.store.put(draft());
    expect(await none.store.get(draftKey(ME, BID))).toBeDefined();
    const blocked = await openBidDraftStore({
      open: () => {
        throw new Error("blocked");
      },
    } as unknown as IDBFactory);
    expect(blocked.fallback).toBe(true);
    expect(BID_DRAFT_DB).toBe("jbk-bid-drafts");
  });

  describe("the estimator", () => {
    const page = flat(read("routes/estimate.tsx"));
    it("writes what Save sends, a moment after a change, and only once the question is answered", () => {
      expect(page).toContain(
        'mayWriteDraft({ gate: draftGate, dirty, readOnly, saving }) && worthKeeping(printNow, !bidParam, newBidStart.current) ? printNow : "";',
      );
      // A new bid nobody has typed into is only its starting fills.
      expect(page).toContain(
        "if (!bidParam && !draftTouched.current) newBidStart.current = printNow;",
      );
      expect(page).toContain("const t = setTimeout(writeDraftNow, BID_DRAFT_DELAY_MS);");
      // The frozen prices go with it, as Save sends them.
      expect(page).toContain("data: { ...saved, ...(snapshot ? { adminSnapshot: snapshot.admin,");
      // The tab hidden or the page closed: written at once.
      expect(page).toContain('document.addEventListener("visibilitychange", flush);');
      expect(page).toContain('window.addEventListener("pagehide", writeDraftNow);');
    });
    it("asks once the bid is on the page and this tab holds it, and never restores unasked", () => {
      expect(page).toContain(
        "? hydratedFor.current === bidParam && lockMineFor === bidParam && !readOnly : true;",
      );
      expect(page).toContain('setDraftGate(offer ? "asking" : "open");');
      expect(page).toContain("<AlertDialog open={!!draftAsk && !readOnly}>");
      expect(page).toContain('<AlertDialogContent data-dialog="bid-draft"');
      // Only the two buttons put the draft on the page or remove it.
      expect(page.split("hydrateSaved(d.data as unknown as").length - 1).toBe(1);
      expect(page).toContain('onClick={restoreDraft} data-action="draft-restore"');
      expect(page).toContain('onClick={discardDraft} data-action="draft-discard"');
    });
    it("a restored draft stays unsaved: the page is not re-baselined, and the draft is kept until Save", () => {
      const restore = page.slice(
        page.indexOf("const restoreDraft = () => {"),
        page.indexOf("const discardDraft = () => {"),
      );
      expect(restore).not.toContain("setHydrationStamp");
      expect(restore).not.toContain("lastSavedBody.current");
      expect(restore).not.toContain("dropDraft(");
      expect(restore).toContain("toast.success(DRAFT_RESTORED");
    });
    it("a new bid's own starting fills do not land on top of the restored work", () => {
      expect(page).toContain("if (planswiftParam) planswiftSeededFor.current = planswiftParam;");
      expect(page).toContain("if (takeoffParam) takeoffSeededFor.current = `|${takeoffParam}`;");
      expect(page).toContain("if (combineParam) combinedFor.current = combineParam;");
      expect(page).toContain(
        "appliedDefaultTemplate.current = true; appliedDefaultPreset.current = true;",
      );
    });
    it("Save, Discard and Leave without saving remove it", () => {
      expect(page).toContain(
        "dirtyRef.current = false; // Saved: the unsaved draft in the browser has nothing left to keep. dropDraft();",
      );
      expect(page).toContain("const discardDraft = () => { dropDraft();");
      expect(page).toContain(
        'draftLeft.current = true; dropDraft(); if (blocker.status === "blocked") blocker.proceed();',
      );
      // Left on purpose: nothing waiting is written on the way out.
      expect(page).toContain(
        "draftWaiting.current = draftPrint && !draftLeft.current ? buildDraft : null;",
      );
    });
    it("a new bid restored from its draft still links what it was started from on its first Save", () => {
      expect(page).toContain("const oppId = search.opportunity ?? draftLinks.current.opportunity;");
      expect(page).toContain("if (oppId) linkOpportunity(oppId, row.id);");
    });
  });
});

describe("2. new custom items show right under the add box", () => {
  it("the newest first, each with its place in the saved list", () => {
    expect(customRowsShown(["a", "b", "c"])).toEqual([
      { row: "c", index: 2 },
      { row: "b", index: 1 },
      { row: "a", index: 0 },
    ]);
    expect(customRowsShown([])).toEqual([]);
  });
  const src = flat(read("components/nondl-screens.tsx"));
  const grid = src.slice(src.indexOf("function GroupGrid("));
  const body = grid.slice(grid.indexOf("<TableBody>"), grid.indexOf("</TableBody>"));
  it("the custom rows are drawn between the box and the stock rows", () => {
    const box = body.indexOf("data-nondl-add-row");
    const custom = body.indexOf("{customRowsShown(customRows).map(({ row: c, index: i }) =>");
    const stock = body.indexOf("{refRows.map((row) =>");
    expect(box).toBeGreaterThan(-1);
    expect(custom).toBeGreaterThan(box);
    expect(stock).toBeGreaterThan(custom);
  });
  it("what is saved does not move: a new item joins the end, and the cursor lands in its Quantity", () => {
    expect(grid).toContain(
      "onCustom([ ...customRows, { description: d, qty: 0, unitCost: 0, laborPerUnit: 0, laborRate: lastRate }, ]);",
    );
    expect(grid).toContain("setFocusQtyRow(focusQty ? customRows.length : null);");
    expect(body).toContain("autoFocus={focusQtyRow === i}");
    // Edits and removals still go by the row's place in the saved list.
    expect(body).toContain("onCustom(customRows.filter((_, j) => j !== i))");
  });
});
