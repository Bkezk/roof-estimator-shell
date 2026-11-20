/**
 * Bids, Nov 20 (owner: "fix on 1"; docs/qa/bids-new-draft-slots-2026-11-20.md).
 *
 * Until now every new, never-saved bid of a person kept its unsaved work in one shared slot in
 * the browser. Two new bids open at once in two windows wrote over each other's draft, and each
 * was offered the other's work. Now each new bid has a slot of its own, held by the window it
 * is open in: another window is never offered it while that window is open, and is offered it,
 * by name, once that window is gone.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BID_DRAFT_VERSION,
  DRAFT_TAKEN,
  NEW_DRAFT_MAX_AGE_DAYS,
  NEW_DRAFT_MAX_KEPT,
  claimNewSlot,
  draftKey,
  draftLabel,
  draftListWords,
  draftWords,
  isNewDraftKey,
  isSlotId,
  memoryDraftStore,
  memoryPresence,
  newDraftKey,
  newSlotId,
  readDraft,
  readNewDraft,
  slotOfKey,
  takeOverDraft,
  waitingNewDrafts,
  type BidDraft,
  type TabSlot,
} from "@/lib/bid-draft";
import {
  HEARTBEAT_MS,
  HEARTBEAT_PREFIX,
  HEARTBEAT_STALE_MS,
  LOCK_PREFIX,
  TAB_SLOT_KEY,
  heartbeatPresence,
  openDraftPresence,
  tabSlotStore,
  webLocksPresence,
  type LocksLike,
  type StorageLike,
} from "@/lib/bid-draft-presence";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const ME = "user-1";
const SLOT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const SLOT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const SLOT_C = "cccccccc-0000-4000-8000-000000000003";
const NOW = new Date("2027-02-10T18:00:00Z");
const header = {
  status: "draft" as const,
  lostReason: null,
  wonOn: "",
  dueDate: "",
  folder: "",
  reminderOn: "",
  reminderNote: "",
};
/** A new bid's draft under a slot; `slot` null is the old shared key. */
const draft = (slot: string | null, over: Partial<BidDraft> = {}): BidDraft => {
  const userId = over.userId ?? ME;
  return {
    v: BID_DRAFT_VERSION,
    key: slot ? newDraftKey(userId, slot) : draftKey(userId, null),
    userId,
    bidId: null,
    savedAt: "2027-02-10T16:31:00Z",
    baseUpdatedAt: null,
    name: "North Plant",
    accountId: null,
    siteId: null,
    accountLabel: "",
    linkChanged: false,
    buildingId: null,
    opportunityId: null,
    inspectionId: null,
    header,
    data: { sections: [{ id: "s1" }] },
    print: `work-of-${slot ?? "old"}`,
    ...over,
  };
};
const stored = (d: BidDraft) => JSON.parse(JSON.stringify(d)) as unknown;
const tab = (start: string | null = null): TabSlot & { value: string | null } => {
  const t = {
    value: start,
    get: () => t.value,
    set: (v: string) => {
      t.value = v;
    },
  };
  return t;
};
const ask = (rows: unknown[], mySlot: string | null, live: string[], pagePrint = "blank") =>
  waitingNewDrafts(rows, { userId: ME, mySlot, live: new Set(live), now: NOW, pagePrint });

describe("each new bid keeps its own draft", () => {
  it("a new bid's key names the person and the slot of its window", () => {
    expect(newDraftKey(ME, SLOT_A)).toBe(`bid-draft:user-1:new:${SLOT_A}`);
    expect(newDraftKey(ME, SLOT_A)).not.toBe(newDraftKey(ME, SLOT_B));
    expect(slotOfKey(ME, newDraftKey(ME, SLOT_A))).toBe(SLOT_A);
    // The old shared key is still one of this person's new bids, with no slot.
    expect(isNewDraftKey(ME, draftKey(ME, null))).toBe(true);
    expect(slotOfKey(ME, draftKey(ME, null))).toBeNull();
    // A saved bid's key, another person's, and a made-up slot are not.
    expect(isNewDraftKey(ME, draftKey(ME, "bid-1"))).toBe(false);
    expect(isNewDraftKey(ME, newDraftKey("user-2", SLOT_A))).toBe(false);
    expect(isNewDraftKey(ME, "bid-draft:user-1:new:../x")).toBe(false);
    expect(isNewDraftKey(ME, 7)).toBe(false);
  });

  it("a fresh slot id is one the key takes", () => {
    const a = newSlotId();
    expect(isSlotId(a)).toBe(true);
    expect(newSlotId()).not.toBe(a);
    expect(isSlotId(newSlotId(() => "ABCDEF12-3456"))).toBe(true);
    expect(isSlotId("short")).toBe(false);
    expect(isSlotId(null)).toBe(false);
  });

  it("a draft is read under its own slot, and under no one else's", () => {
    const d = draft(SLOT_A);
    expect(readNewDraft(stored(d), ME)).toEqual(d);
    expect(readNewDraft(stored(draft(null)), ME)).toEqual(draft(null));
    // Another person's on a shared computer.
    expect(readNewDraft(stored(d), "user-2")).toBeNull();
    expect(readNewDraft(stored(draft(SLOT_A, { userId: "user-2" })), ME)).toBeNull();
    // Kept under one slot's key but asked for as another's.
    expect(
      readDraft(stored(d), { userId: ME, bidId: null, key: newDraftKey(ME, SLOT_B) }),
    ).toBeNull();
    // A saved bid never has a key of its own.
    expect(
      readDraft(stored({ ...d, bidId: "bid-1" }), { userId: ME, bidId: "bid-1", key: d.key }),
    ).toBeNull();
    expect(readNewDraft({ ...(stored(d) as object), print: "" }, ME)).toBeNull();
  });

  it("two new bids open at once in two windows are never offered each other's work", () => {
    const rows = [stored(draft(SLOT_A)), stored(draft(SLOT_B, { name: "South Depot" }))];
    // Window A holds slot A, window B holds slot B; both are open.
    const live = [SLOT_A, SLOT_B];
    // A third window opens a new bid: neither is offered.
    expect(ask(rows, SLOT_C, [...live, SLOT_C])).toEqual({ offers: [], drop: [] });
    // Window B reloads: it is offered its own, and not A's.
    const b = ask(rows, SLOT_B, live);
    expect(b.offers.map((o) => o.draft.name)).toEqual(["South Depot"]);
    expect(b.drop).toEqual([]);
  });

  it("a new bid whose window is gone is offered the next time a new bid is opened", () => {
    const rows = [stored(draft(SLOT_A))];
    // Window A was closed: nothing holds slot A.
    const w = ask(rows, SLOT_B, [SLOT_B]);
    expect(w.offers).toEqual([{ draft: draft(SLOT_A), changedSince: false }]);
    expect(w.drop).toEqual([]);
  });

  it("several waiting are each offered, the newest first", () => {
    const rows = [
      stored(draft(SLOT_A, { savedAt: "2027-02-08T15:00:00Z" })),
      stored(draft(SLOT_B, { name: "South Depot", savedAt: "2027-02-10T15:00:00Z" })),
      stored(draft(null, { name: "Old Mill", savedAt: "2027-02-09T15:00:00Z" })),
    ];
    const w = ask(rows, SLOT_C, [SLOT_C]);
    expect(w.offers.map((o) => o.draft.name)).toEqual(["South Depot", "Old Mill", "North Plant"]);
    expect(w.drop).toEqual([]);
  });

  it("a draft under the old shared key is still offered", () => {
    const w = ask([stored(draft(null))], SLOT_A, [SLOT_A]);
    expect(w.offers.map((o) => o.draft.key)).toEqual(["bid-draft:user-1:new"]);
  });

  it("this tab's own draft that is the very work on the page is removed, not asked about", () => {
    const mine = draft(SLOT_A, { print: "same" });
    expect(ask([stored(mine)], SLOT_A, [SLOT_A], "same")).toEqual({ offers: [], drop: [mine.key] });
    // Another window's draft that happens to read the same is still its own work.
    expect(ask([stored(mine)], SLOT_B, [SLOT_B], "same").offers).toHaveLength(1);
  });

  it("old drafts do not pile up: by age, and by count", () => {
    expect(NEW_DRAFT_MAX_AGE_DAYS).toBe(30);
    expect(NEW_DRAFT_MAX_KEPT).toBe(10);
    const old = draft(SLOT_A, { savedAt: "2027-01-10T17:00:00Z" }); // 31 days
    const kept = draft(SLOT_B, { savedAt: "2027-01-12T17:00:00Z" }); // 29 days
    const w = ask([stored(old), stored(kept)], SLOT_C, [SLOT_C]);
    expect(w.offers.map((o) => o.draft.key)).toEqual([kept.key]);
    expect(w.drop).toEqual([old.key]);
    // An old one a window still holds is that window's, and is not touched.
    expect(ask([stored(old)], SLOT_C, [SLOT_A, SLOT_C])).toEqual({ offers: [], drop: [] });
    // This tab's own is never aged out.
    expect(ask([stored(old)], SLOT_A, [SLOT_A]).offers).toHaveLength(1);
    // Twelve waiting: the ten newest are offered, the two oldest go.
    const many = Array.from({ length: 12 }, (_, i) => {
      const slot = `dddddddd-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
      return draft(slot, { savedAt: `2027-02-${String(i + 1).padStart(2, "0")}T15:00:00Z` });
    });
    const capped = ask(many.map(stored), SLOT_C, [SLOT_C]);
    expect(capped.offers).toHaveLength(10);
    expect(capped.offers[0]!.draft.key).toBe(many[11]!.key);
    expect(capped.drop.sort()).toEqual([many[0]!.key, many[1]!.key].sort());
  });

  it("only this person's new bids are looked at; a broken one is removed", () => {
    const saved = { ...(stored(draft(SLOT_A)) as object), key: draftKey(ME, "bid-1"), bidId: "b" };
    const theirs = stored(draft(SLOT_A, { userId: "user-2" }));
    const broken = { key: newDraftKey(ME, SLOT_B), v: 0 };
    const w = ask([saved, theirs, broken, null, "text"], SLOT_C, [SLOT_C]);
    expect(w.offers).toEqual([]);
    expect(w.drop).toEqual([broken.key]);
  });
});

describe("which window holds a slot", () => {
  it("one window holds a slot; another cannot until it lets go", async () => {
    const registry = new Map<string, object>();
    const a = memoryPresence(registry);
    const b = memoryPresence(registry);
    const release = await a.hold(SLOT_A);
    expect(release).not.toBeNull();
    expect(await b.hold(SLOT_A)).toBeNull();
    expect([...(await b.live())]).toEqual([SLOT_A]);
    // The same window may hold its own again.
    const again = await a.hold(SLOT_A);
    expect(again).not.toBeNull();
    release!();
    expect(await b.hold(SLOT_A)).toBeNull();
    again!();
    again!(); // letting go twice is once
    expect((await b.live()).size).toBe(0);
    expect(await b.hold(SLOT_A)).not.toBeNull();
  });

  it("a fresh tab gets a slot of its own and remembers it", async () => {
    const registry = new Map<string, object>();
    const t = tab();
    const c = await claimNewSlot(memoryPresence(registry), t, () => SLOT_A);
    expect(c.slot).toBe(SLOT_A);
    expect(t.value).toBe(SLOT_A);
    expect(registry.has(SLOT_A)).toBe(true);
    c.release();
    expect(registry.has(SLOT_A)).toBe(false);
  });

  it("a reload of the same tab gets its own slot back", async () => {
    const registry = new Map<string, object>();
    const t = tab(SLOT_A); // what the tab remembered before the reload; its old window is gone
    const c = await claimNewSlot(memoryPresence(registry), t, () => SLOT_B);
    expect(c.slot).toBe(SLOT_A);
  });

  it("a duplicated tab carries the first one's slot, and gets one of its own instead", async () => {
    const registry = new Map<string, object>();
    const first = await claimNewSlot(memoryPresence(registry), tab(), () => SLOT_A);
    const copy = tab(SLOT_A);
    const second = await claimNewSlot(memoryPresence(registry), copy, () => SLOT_B);
    expect(first.slot).toBe(SLOT_A);
    expect(second.slot).toBe(SLOT_B);
    expect(copy.value).toBe(SLOT_B);
    expect([...registry.keys()].sort()).toEqual([SLOT_A, SLOT_B]);
  });

  it("a remembered slot that is not a slot id is not used", async () => {
    const c = await claimNewSlot(memoryPresence(), tab("../../x"), () => SLOT_B);
    expect(c.slot).toBe(SLOT_B);
  });

  // The browser's own locks: a lock is let go by the browser when its window goes.
  function fakeLocks() {
    const held = new Map<string, { client: number; done: () => void }>();
    const client = (id: number): LocksLike => ({
      request: async (name, _o, cb) => {
        if (held.has(name)) {
          await cb(null);
          return;
        }
        let done = () => {};
        const kept = new Promise<void>((r) => (done = r));
        held.set(name, { client: id, done });
        const p = cb({ name });
        void Promise.resolve(p).then(() => {
          if (held.get(name)?.client === id) held.delete(name);
        });
        void kept;
      },
      query: async () => ({ held: [...held.keys()].map((name) => ({ name })) }),
    });
    /** The window closes or crashes: the browser lets go of all it held. */
    const close = (id: number) => {
      for (const [name, h] of held) if (h.client === id) held.delete(name);
    };
    return { held, client, close };
  }
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it("with the browser's locks: held while the window is open, free the moment it is gone", async () => {
    const locks = fakeLocks();
    const a = webLocksPresence(locks.client(1));
    const b = webLocksPresence(locks.client(2));
    const release = await a.hold(SLOT_A);
    expect(release).not.toBeNull();
    expect([...locks.held.keys()]).toEqual([LOCK_PREFIX + SLOT_A]);
    expect(await b.hold(SLOT_A)).toBeNull();
    expect((await b.live()).has(SLOT_A)).toBe(true);
    // Window A crashes: nothing was let go by the page, the browser did it.
    locks.close(1);
    expect((await b.live()).has(SLOT_A)).toBe(false);
    expect(await b.hold(SLOT_A)).not.toBeNull();
  });

  it("with the browser's locks: letting go frees it, and holding again at once keeps it", async () => {
    const locks = fakeLocks();
    const a = webLocksPresence(locks.client(1));
    const first = await a.hold(SLOT_A);
    first!();
    const again = await a.hold(SLOT_A); // the same breath: the lock was never given up
    expect(again).not.toBeNull();
    await tick();
    expect(locks.held.has(LOCK_PREFIX + SLOT_A)).toBe(true);
    again!();
    await tick();
    expect(locks.held.has(LOCK_PREFIX + SLOT_A)).toBe(false);
    // A browser that refuses is "not held", never an error.
    const broken = webLocksPresence({
      request: () => Promise.reject(new Error("no")),
      query: () => Promise.reject(new Error("no")),
    });
    expect(await broken.hold(SLOT_A)).toBeNull();
    expect((await broken.live()).size).toBe(0);
  });

  function fakeStorage(): StorageLike & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      key: (i) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    };
  }

  it("without them: a mark the open window renews, stale once it stops", async () => {
    const storage = fakeStorage();
    let now = 1_000_000;
    const timers: (() => void)[] = [];
    const clock = {
      now: () => now,
      every: (f: () => void, ms: number) => {
        expect(ms).toBe(HEARTBEAT_MS);
        timers.push(f);
        return () => void timers.splice(timers.indexOf(f), 1);
      },
    };
    const a = heartbeatPresence(storage, clock);
    const b = heartbeatPresence(storage, clock);
    const release = await a.hold(SLOT_A);
    expect(storage.map.get(HEARTBEAT_PREFIX + SLOT_A)).toBe("1000000");
    expect(await b.hold(SLOT_A)).toBeNull();
    // A minute on, the open window has renewed its mark: still held.
    now += 60_000;
    timers.forEach((f) => f());
    now += 60_000;
    expect(await b.hold(SLOT_A)).toBeNull();
    expect((await b.live()).has(SLOT_A)).toBe(true);
    // The window crashes: no more renewals. Past the limit it counts as gone.
    timers.length = 0;
    now += HEARTBEAT_STALE_MS;
    expect((await b.live()).has(SLOT_A)).toBe(false);
    expect(storage.map.has(HEARTBEAT_PREFIX + SLOT_A)).toBe(false); // the old mark is cleared
    const taken = await b.hold(SLOT_A);
    expect(taken).not.toBeNull();
    // Let go on purpose: free at once.
    taken!();
    expect(storage.map.has(HEARTBEAT_PREFIX + SLOT_A)).toBe(false);
    release!();
    expect(HEARTBEAT_STALE_MS).toBeGreaterThan(60_000); // longer than a background tab's timer
  });

  it("the browser's locks are used when it has them, else the mark, else nothing shared", () => {
    const locks = fakeLocks().client(1);
    expect(openDraftPresence({ locks, storage: fakeStorage() }).how).toBe("locks");
    expect(openDraftPresence({ storage: fakeStorage() }).how).toBe("heartbeat");
    expect(openDraftPresence({}).how).toBe("none");
  });

  it("a tab remembers its slot through a reload, and carries on when storage is blocked", () => {
    const storage = fakeStorage();
    const t = tabSlotStore(storage);
    expect(t.get()).toBeNull();
    t.set(SLOT_A);
    expect(storage.map.get(TAB_SLOT_KEY)).toBe(SLOT_A);
    expect(tabSlotStore(storage).get()).toBe(SLOT_A); // after the reload
    storage.map.set(TAB_SLOT_KEY, "<script>");
    expect(t.get()).toBeNull();
    const blocked = tabSlotStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    blocked.set(SLOT_B);
    expect(blocked.get()).toBe(SLOT_B);
    expect(tabSlotStore(undefined).get()).toBeNull();
  });
});

describe("carrying on with a draft from a window that is gone", () => {
  it("the tab takes the draft's slot, and the draft stays where it is until Save", async () => {
    const registry = new Map<string, object>();
    const store = memoryDraftStore();
    await store.put(draft(SLOT_A));
    const t = tab(SLOT_B);
    const took = await takeOverDraft(draft(SLOT_A), {
      presence: memoryPresence(registry),
      tab: t,
      store,
    });
    expect(took).toMatchObject({ slot: SLOT_A, key: newDraftKey(ME, SLOT_A) });
    expect(t.value).toBe(SLOT_A);
    expect(registry.has(SLOT_A)).toBe(true);
    expect(await store.get(newDraftKey(ME, SLOT_A))).toBeDefined();
  });

  it("another window took it first: nothing is changed", async () => {
    const registry = new Map<string, object>();
    const store = memoryDraftStore();
    await store.put(draft(SLOT_A));
    await memoryPresence(registry).hold(SLOT_A); // the other window
    const t = tab(SLOT_B);
    expect(
      await takeOverDraft(draft(SLOT_A), { presence: memoryPresence(registry), tab: t, store }),
    ).toBeNull();
    expect(t.value).toBe(SLOT_B);
    expect(DRAFT_TAKEN).toContain("It is not lost");
  });

  it("the old shared draft is moved to a slot of its own", async () => {
    const store = memoryDraftStore();
    await store.put(draft(null));
    const t = tab(SLOT_B);
    const took = await takeOverDraft(draft(null), {
      presence: memoryPresence(),
      tab: t,
      store,
      mint: () => SLOT_C,
    });
    expect(took).toMatchObject({ slot: SLOT_C, key: newDraftKey(ME, SLOT_C) });
    expect(await store.get(draftKey(ME, null))).toBeUndefined();
    expect(readNewDraft(await store.get(newDraftKey(ME, SLOT_C)), ME)).toMatchObject({
      name: "North Plant",
      key: newDraftKey(ME, SLOT_C),
    });
    expect(t.value).toBe(SLOT_C);
  });

  it("the whole story: two windows, one closes, a third is offered its work by name", async () => {
    const registry = new Map<string, object>();
    const store = memoryDraftStore(); // one browser, shared by its windows
    // Window A and window B each open a new bid.
    const winA = memoryPresence(registry);
    const winB = memoryPresence(registry);
    const a = await claimNewSlot(winA, tab(), () => SLOT_A);
    const b = await claimNewSlot(winB, tab(), () => SLOT_B);
    const page = async (me: string, presence = winA) =>
      waitingNewDrafts(await store.all(), {
        userId: ME,
        mySlot: me,
        live: await presence.live(),
        now: NOW,
        pagePrint: "blank",
      });
    // Each types its own work: two drafts, neither written over.
    await store.put(draft(a.slot, { name: "North Plant" }));
    await store.put(draft(b.slot, { name: "South Depot" }));
    expect((await store.all()).length).toBe(2);
    // Neither window, reloaded, is offered the other's.
    expect((await page(a.slot)).offers.map((o) => o.draft.name)).toEqual(["North Plant"]);
    expect((await page(b.slot, winB)).offers.map((o) => o.draft.name)).toEqual(["South Depot"]);
    // Window A is closed without saving.
    a.release();
    // A third window opens a new bid: A's work is offered, B's is not.
    const winC = memoryPresence(registry);
    const tabC = tab();
    const c = await claimNewSlot(winC, tabC, () => SLOT_C);
    const asked = await page(c.slot, winC);
    expect(asked.offers.map((o) => o.draft.name)).toEqual(["North Plant"]);
    // Restored: window C carries on under A's slot.
    const took = await takeOverDraft(asked.offers[0]!.draft, {
      presence: winC,
      tab: tabC,
      store,
    });
    expect(took?.slot).toBe(SLOT_A);
    // Window B, opening another new bid meanwhile, is not offered it any more.
    expect((await page(SLOT_B, winB)).offers.map((o) => o.draft.name)).toEqual(["South Depot"]);
  });
});

describe("the question", () => {
  it("a draft is called by its name, else by its customer", () => {
    expect(draftLabel({ name: "North Plant", accountLabel: "Acme" })).toBe("“North Plant”");
    expect(draftLabel({ name: "Untitled bid", accountLabel: "Acme Stores" })).toBe(
      "for Acme Stores",
    );
    expect(draftLabel({ name: " ", accountLabel: "" })).toBe("");
    const o = { draft: draft(SLOT_A, { name: "Untitled bid", accountLabel: "Acme Stores" }) };
    expect(draftWords({ ...o, changedSince: false }, "America/New_York").body).toContain(
      "Unsaved work on a new bid for Acme Stores from Wed, Feb 10, 11:31 AM was kept",
    );
  });

  it("several are listed, each with its name and when it was last changed", () => {
    const offers = [
      { draft: draft(SLOT_A), changedSince: false },
      {
        draft: draft(SLOT_B, {
          name: "Untitled bid",
          accountLabel: "Acme Stores",
          savedAt: "2027-02-09T20:05:00Z",
        }),
        changedSince: false,
      },
      { draft: draft(SLOT_C, { name: "" }), changedSince: false },
    ];
    const w = draftListWords(offers, "America/New_York");
    expect(w.title).toBe("Restore your unsaved work?");
    expect(w.body).toBe(
      "Unsaved work on 3 new bids was kept on this computer. None of it was ever saved. Restore one to carry on where you stopped, or discard what you do not need. The others stay here until you answer for them.",
    );
    expect(w.rows).toEqual([
      {
        key: newDraftKey(ME, SLOT_A),
        label: "New bid “North Plant”",
        when: "Wed, Feb 10, 11:31 AM",
      },
      {
        key: newDraftKey(ME, SLOT_B),
        label: "New bid for Acme Stores",
        when: "Tue, Feb 9, 3:05 PM",
      },
      {
        key: newDraftKey(ME, SLOT_C),
        label: "New bid with no name yet",
        when: "Wed, Feb 10, 11:31 AM",
      },
    ]);
  });
});

describe("the estimator and the store", () => {
  const page = flat(read("routes/estimate.tsx"));
  it("a new bid claims a slot in its tab, writes under it, and lets go when it leaves", () => {
    expect(page).toContain("void claimNewSlot(draftPresence(), draftTab()).then((c) => {");
    expect(page).toContain(
      "return () => { gone = true; newSlotRelease.current?.(); newSlotRelease.current = null; setNewSlot(null); };",
    );
    expect(page).toContain(
      "? draftKey(draftUserId, bidParam) : newSlot ? newDraftKey(draftUserId, newSlot) : null;",
    );
    // Nothing of a new bid is written under the old shared key any more.
    expect(page).not.toContain("draftKey(draftUserId, bidParam ?? null)");
    expect(page).toContain("key: draftSlot,");
  });
  it("opening a new bid asks about every new bid's draft that no open window holds", () => {
    expect(page).toContain(
      "const [rows, live] = await Promise.all([store.all(), draftPresence().live()]);",
    );
    expect(page).toContain(
      "waitingNewDrafts(rows, { userId: draftUserId, mySlot: newSlot, live, now: new Date(), pagePrint: page.print, });",
    );
    expect(page).toContain(
      "for (const key of waiting.drop) void draftRun(() => store.remove(key));",
    );
  });
  it("restoring another window's draft takes it over first, and says so when it was taken", () => {
    expect(page).toContain("if (!bidParam && d.key !== draftSlot) {");
    expect(page).toContain(
      "took = await takeOverDraft(d, { presence: draftPresence(), tab: draftTab(), store: await draftStore(), });",
    );
    expect(page).toContain(
      "if (!took) { toast.error(DRAFT_TAKEN, { duration: 15_000 }); draftAnswered(d.key); return; }",
    );
    // The page then writes under the slot it took, and does not ask a second time.
    expect(page).toContain("draftCheckedSlot.current = took.key; setNewSlot(took.slot);");
  });
  it("several are listed, each with its own two buttons", () => {
    expect(page).toContain("{draftAsk.length > 1 ? (");
    expect(page).toContain("draftListWords(draftAsk).rows.map((row, i) => (");
    expect(page).toContain("onClick={() => discardDraft(draftAsk[i])}");
    expect(page).toContain("onClick={() => void restoreDraft(draftAsk[i])}");
    expect(page).toContain("data-draft-count={draftAsk.length}");
  });
  it("the store lists what it keeps", async () => {
    const store = memoryDraftStore();
    await store.put(draft(SLOT_A));
    await store.put(draft(SLOT_B));
    expect((await store.all()).length).toBe(2);
    expect(flat(read("lib/bid-draft-store.ts"))).toContain(
      'all: async () => req(tx("readonly").getAll()) as Promise<unknown[]>,',
    );
  });
});
