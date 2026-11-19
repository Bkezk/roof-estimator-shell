# Bids: the add box first, notices dismissed one by one, and the lock coming back (Nov 19, 2026)

Three items from the owner's Nov 19 list. Tests: `src/lib/bids-add-form-dismiss-nov19.test.ts`
(20 tests), each block failing on the code before the change.

## 1. The box that adds a custom item is first in the list

Owner: "on bids when you add custom items in non DL items, metals, etc. currently the form to add
items is at the bottom of the list, can we make it at the top of the list instead? this should
just be a front end visual change."

- One list component draws every Non-DL list (`GroupGrid` in `src/components/nondl-screens.tsx`):
  Roof Edge Blocking, Wall Blocking, Roof Deck Materials, Sheet Metals, Masonry, Services,
  Subcontractors, Custom Applications. Its "Add a custom … item" box is now the first row.
- Only where the box shows moved. An added item still joins the end of the list, as it is saved,
  and Tab or Enter still lands in the new item's Quantity box.
- The Metals step (gutters, downspouts, pitch pans, collection boxes) has no such box: its
  entries are made in their own pop-ups.

Browser, on a new bid that was never saved: all nine lists of the six Non-DL tiles show the box
as the first row. One item added with Tab: the box stayed first, the item was the last row, and
the cursor was in its row.

## 2. Each yellow notice has its own dismiss

Owner: "on bids the yellow bullet point notifications should be able to be dismissed individually
please."

- The two yellow bullet lists of the estimator are drawn by `src/components/bid-notice-list.tsx`:
  "Check inputs" on the Bid total, and "Check:" inside the From PlanSwift notice. Each notice has
  an × button. "Show N dismissed" under the list brings back the ones dismissed from it.
- Where a dismissal is kept: on the bid itself (`dismissedNotices` in the saved bid, beside the
  other notice records; `src/lib/bid-dismissed-notices.ts`). It is saved with the bid's next
  Save, so the bid reads "Unsaved changes" after a dismissal, like the From PlanSwift notice's
  own Dismiss. Once saved it is dismissed for everyone who opens the bid.
- A notice is remembered by its own words. When its numbers change it is a new notice and shows
  again.
- The yellow triangle on the Bid total counts only the notices still showing.
- On a bid open read-only the buttons are locked.
- No engine change and no database change.

Proven by tests of the rules and of the list as drawn. Not clicked through in a browser: the new
bids used for the browser run raised no notice, and no saved bid was opened for it.

## 3. The edit lock coming back no longer reads over unsaved work

Owner: an estimator "was working on [a bid], left the page and doesnt believe he was asked to
save before leaving and lost work, can you check into that?"

What the records show for that bid (a bid started from a PlanSwift import on Nov 19) is in the
session report, not here. The leave question itself was checked:

- The published site carries it ("Save changes to this bid?", with Save and leave, Leave without
  saving, Stay), and the browser's own warning on closing the tab.
- On the current code a new, changed, never saved bid asked when the Bids menu link was pressed.
- Every way out inside the site goes through that question: the menu, the search box, the
  notification bell, Back.
- One link did not: "Open the takeoff" in the From Takeoff notice loaded the page anew, which
  only gets the browser's own "Leave site?". It is now a link of the site, so it asks too.

One way to lose unsaved work without any question was found and closed:

- A bid is edited by one tab at a time. A tab that loses the edit lock turns read-only, and takes
  the lock back when the other holder leaves. Until now it then read the saved bid over its own
  page, without a word. Whatever had been typed there and not saved was gone.
- Now (`src/lib/bid-lock-return.ts`): a tab with unsaved changes keeps them and says so, with
  what to do ("press Save now"). A save can still never write over somebody else's: the server
  refuses a save from a copy older than the saved bid and names who saved and when.
- A tab with nothing unsaved reads the saved bid again, and replaces its page only when the bid
  was really saved meanwhile. Before, a lock that came back to an unchanged bid left the page
  ready to be read over later, by a status or due date change.

Proven by tests of the rule and of the estimator's use of it. Not proven in a browser: it needs
two sessions on one saved bid, and no bid was made or opened for this run.

## Checks

- `bunx vitest run` on the 56 test files that read the changed files: 976 tests pass.
- One older pin updated with a dated note (`bid-unsaved-after-save-nov10b.test.ts`: the list of
  numbers waved through is still the last key of the saved bid; the dismissed notices sit just
  before it).
- eslint clean on the changed files. tsc: no error in a file of this change.
- The browser run sent no save and took no lock. No row was made or changed.
