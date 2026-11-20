# Bids: each new bid keeps its own unsaved work (Nov 20)

The owner, on the open item about two new bids at once: "fix on 1".

No bid was saved or changed for this. The browser run used new bids that were never saved.

## What was wrong

A bid that was never saved has no id. Its unsaved work was kept in the browser under one shared
slot, the same for every new bid of that person on that computer
(`docs/qa/bids-draft-restore-2026-11-19.md`). Two new bids open at once in two windows wrote
over each other's kept work, and each was offered the other's.

## The rule now

| Before                                                        | Now                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| Every new bid of a person shared one slot                     | Each new bid has a slot of its own, held by the window it is in    |
| A second window's new bid was offered the first window's work | Work that is open in another window is never offered               |
| One window's kept work wrote over the other's                 | Each is kept by itself                                             |
| One question, about the one draft                             | Several waiting are each listed by name, each with its two buttons |

An example. Brian starts a new bid for one job in one window and a new bid for another job in a
second window. Each keeps its own work, and neither is asked about the other's. He closes the
first window without saving. The next time he opens a new bid, he is asked about the first job's
work by its name, and can restore it or discard it.

- A reload of the same tab gets its own work back, as before.
- A closed or crashed window's work is offered the next time that person opens a new bid on that
  computer. It is never put on the page unasked, and the question cannot be waved away.
- When more than one waits, each is listed with its job name, or its customer when no name was
  typed, and when it was last changed. Restoring one leaves the others waiting for the next new
  bid. Discarding one removes only that one.
- Restoring another window's work makes this tab the one that holds it. If a second window
  restores the same work in the same moment, the second is told it was just opened in another
  window, and nothing is put on its page.
- Save, Discard and "Leave without saving" remove a bid's kept work, as before.
- Work kept under the old shared slot by the site as it was is still offered. Once it is
  answered it is gone.
- So that old work does not pile up: a new bid's kept work that no open window holds is removed
  after 30 days, and no more than the 10 newest wait for one person on one computer. This limit
  is new. A saved bid's kept work is not touched by it.

## How an open window is told from a closed one

- The browser's own locks (the Web Locks API, in every current browser). The window with the bid
  open holds a lock named after its slot. The browser lets go of it by itself the moment the
  window closes, reloads or crashes, so nothing depends on the page tidying up.
- Without that, a mark in the browser's storage that the open window renews every 5 seconds. A
  window whose mark is 90 seconds old counts as gone. 90 seconds because a browser slows a
  background tab's timers to about one a minute.
- A tab remembers its own slot in the browser's per-tab storage, so a reload finds its own work.
  A duplicated tab starts with a copy of the first tab's slot. The first tab still holds it, so
  the copy is given a slot of its own.

## Files

- `src/lib/bid-draft.ts`: the slot keys, which drafts to ask about, taking one over, the words.
- `src/lib/bid-draft-presence.ts` (new): the locks, the renewed mark, the tab's own slot.
- `src/lib/bid-draft-store.ts`: the store can list what it keeps.
- `src/routes/estimate.tsx`: a new bid claims its slot, asks about what waits, lists several.

## What was proven

Tests: `src/lib/bids-new-draft-slots-nov20.test.ts`, 31 tests. They fail on the code before this
change (the rules they read did not exist). Five pins in
`src/lib/bids-draft-restore-nov19.test.ts` were moved to the new code, each with a dated note.

In a browser, four windows of one browser on new bids, no save sent, no page errors:

1. Two windows each on a new bid, each typed a different job name: two pieces of kept work, and
   each window still showed its own.
2. A third window opened a new bid while both were open: it was asked nothing.
3. The second window was reloaded: it was asked about its own work only, and restored it.
4. The first window was closed with no question. The third window opened a new bid: it was asked
   about the first window's work by name. Escape did not close the question. It restored the
   work and typed on, and the kept work followed.
5. Both were closed. A fresh window was asked about both, each by name with its time. At phone
   width the list fits the screen.
6. The first was discarded: only that one went, and the other was still asked about. It was
   restored.
7. "Leave without saving" removed it, and the window's hold on its slot was let go.
8. A new bid after that was asked nothing.
9. A piece of work put under the old shared slot by hand was offered, and discarding removed it.

Not proven in a browser: the renewed-mark fallback (the test browser has the locks), two windows
restoring the same work in the same moment, and a real crash of the browser. The tests cover the
first two with stand-ins. For a crash, the browser's own rule is that a lock goes with its
window.
