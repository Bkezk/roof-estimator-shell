# Project Bids page — audit (Nov 6, 2026)

Owner, Nov 6: "audit the bids page … make a bid and associate it to a fake account. be thorough
test everything … dont assume prove your findings." Code read (`src/routes/bids.tsx`,
`lib/bids.functions.ts`, `bids-folders.ts`, `bid-status.ts`, `duplicate-bid.ts`, the lock hook),
the live rules (RLS `bids_authenticated_all` = `has_access('estimate')`; four triggers; the
foreign keys that point at bids: documents and bid_locks cascade, opportunities / roofs /
takeoffs / inventory movements set null), and a browser run as the Claude login on one temporary
customer and bid (three copies made and purged on the way). Scripts: scratchpad
`wo/pw-bids-1..4.cjs`; the write guard aborted every REST write and every server-function write
naming a row that was not mine (none was refused). Everything temporary was removed afterwards: a
uuid sweep over every public and storage table came back empty; 22 live bids, 0 "ZZ" accounts.
The fixes the owner chose follow the findings.

## What works (proven in the browser)

- The list: 22 rows in Draft → Submitted → Lost groups, "22 of 22 bids", every row's customer,
  estimator, created / last-saved-by, folder, "Imported from", due date, "(last saved)" total.
- A new bid from New Bid: the save without a due date is refused ("Give the bid a due date before
  saving"), with one it saves and lands on `?bid=`.
- Search by bid name and by customer; Status / Estimator ("(no estimator)") / Roof system
  filters; Created between; Price between (an inverted range shows "No bids match"); Clear
  filters; the count line follows. The six sorts order the Draft group as labelled (Due date:
  Nov 9, Dec 1, then "No due date").
- Collapsing a group is remembered across a reload (localStorage); Enter on a row opens the
  bid; ticking a row does not open it.
- Rename from the list: blank refused; renamed with the "Last saved … by Claude" stamp; refused
  while another tab has the bid open ("Read only: … is currently editing this bid"); allowed
  the moment that tab leaves by the sidebar.
- Delete → "Recently deleted" (Deleted 11/6/2026 · 30 days left) → Restore; a tab that had the
  bid open is refused on Save with "Not saved: this bid was deleted at 3:33 PM …" (the office's
  clock); Delete permanently from the bin asks and removes it.
- Status from the row: Submitted (submitted_at stamped once), Won opens "When was it won?" with
  the office's day (Cancel keeps Submitted; a typed day is stored), Lost asks the reason and the
  row prints "Lost: Price", back to Draft clears won_on and the reason and keeps submitted_at
  (checked in the database).
- Folders: Move to folder… suggests the customer's name, normalizes "  ZZ   Audit  Folder  ",
  lists the folders in use; By folder shows one card per folder with count and total, Unfiled
  last; inside a folder Rename moves every bid; Unfiled takes it out. Years: one card per year,
  Group by Month / Customer / Status / Estimator / Roof system / Folder; the view is remembered.
- Select all N shown → Move N to folder… files both and clears the selection; Combine 2 bids
  opens the Bid Combiner with "A + B" as the name and its banner; leaving it asks.
- Copy this bid: the popup proposes "<name> (copy)"; the copy opens in the estimator with the
  same customer; its row lists.
- A due date moved to Nov 1 in the estimator shows "Due Nov 1, 2026 · Overdue 5 days" and sorts
  first by due date. Documents opens the bid's panel. Both import dialogs open and cancel.
- A folder change from the list while an estimator tab had the bid open: that tab's Save is
  accepted and says "The folder was changed elsewhere since you opened this bid; that change is
  kept" (the Oct 26 rule).
- No console or page errors in any run.

## Findings

| # | Finding | Proof |
|---|---------|-------|
| 1 | **The list downloads every bid's whole payload.** `listBids` selects `*`: 7.9 MB for 24 bids, again after every rename, status change or folder move (the page refetches the whole list). An empty new bid is 295 KB of JSON, 283 KB of it the frozen `adminSnapshot`; the largest live bid is 318 KB. The page needs a dozen fields. | listBids response 7,925,677 bytes in 707 ms on the dev box's local link; after one folder change 7,925,663 bytes again; `jsonb_each` sizes on the temp bid |
| 2 | **A copy has no due date and no folder, and is never asked for one.** `duplicateBidRow` drops `due_date` and `folder`; the estimator treats a bid without a due date as one from before the rule, so the copy saves without one ("Bid saved") and the only hint is an amber ring with a tooltip. A copy never shows on Work Overview and never gets a due notice. | the copy: due box "", folder "", Save → "Bid saved"; row "No due date"; `bids.due_date` null in the database |
| 3 | **Phone: the page is 636 px wide on a 390 px phone.** Each row's right cluster (due, total, status, four buttons) is 594 px and does not wrap, so the whole page scrolls sideways and the rows are cut off. | 390 px viewport: `scrollWidth` 636, cluster box width 594.5; `cust/bids10-phone.png` |
| 4 | **A closed tab leaves its edit lock for 45 s**, and for that time Rename on the list says "Read only: <you> is currently editing this bid". The release call is sent on pagehide / unmount without keepalive, so a tab close or a typed address drops it (the lock table holds expired rows from Sep 24 on, for Braden, Brian and Garry). The holder is named by the login's email until the profile has loaded (seen once). An in-app leave releases correctly. | first run: a hard navigation out, then Rename refused; `bid_locks` row 42 s later; second run: sidebar leave → Rename allowed |
| 5 | The Bid Combiner opens with **no customer** even when every source bid has the same one, and no due date; both must be entered before the combined bid can be saved. | `#bid-customer` "", `#bid-due-date` "" on `?combine=` of two bids of one customer |
| 6 | Estimator names are free text: "Brian" and "Brian Folden" are two estimators in the filter and in the Years grouping (also "John", "Garry Peters", "Braden Keck", "Claude"). | the Estimator filter's options |
| 7 | Live data: 11 of 22 bids have no customer and 15 no due date (Bid-Advantage and PlanSwift imports from before the rules); they cannot be saved until a customer is picked and never show on Work Overview. 5 of the 6 submitted bids are past their due date with no flag (by design only drafts are overdue). | the database counts |
| 8 | Purging a bid (Delete permanently, or the 30-day sweep) cascades its document rows but leaves the documents' PDF files in the bucket — nothing in the bid or document functions removes storage files. Nothing is orphaned today (the two deleted bids' five documents have no files). | FK `documents.bid_id` CASCADE; no storage removal in `bids.functions.ts` / `documents.functions.ts`; storage count 0 |
| 9 | Small: the search box is labelled "Bid name" but also matches the customer and the folder; "Clear filters" shows twice when nothing matches. | the filter bar |

## Fixes (owner: "go for 1, 2, 3, 4, 5, 6, 8, 9"; 7 is fine as is — the importer was being tested)

1. **The slim list.** `listBids` reads the row's columns plus the few JSON fields the page needs
   (`estimator_name`, `typed_customer`, the roof systems read off the Setup default and the
   sections on the server, the import source) — never the payload (`lib/bids-list.ts`
   BidListRow). A rename, a status change, a folder move or rename and a delete patch the one
   row in the cache (`patchBidRow` / `patchBidRows`); only a restore or a copy refetches.
   Proof: the list is 18,741 bytes where it was 7,925,677; rename, Submitted / Lost / Draft, a
   move and a folder rename made 0 list fetches and the rows read right, and right again after a
   reload.
2. **The copy keeps its folder and takes a due date.** `duplicateBidRow` copies `folder` and sets
   `due_date`; `duplicateBid` requires the day; the Copy popup has a Bid due box (the source's
   day to start; blank is refused by the box itself). Proof: the popup showed Dec 1, the copy
   opened with Dec 15 and "ZZ Fix Folder B", the row read "Folder: ZZ Fix Folder B · Due Dec 15".
3. **Rows wrap on a phone.** The row's right cluster is `flex-wrap`. Proof: 390 px viewport,
   `scrollWidth` 390 (was 636), the row 364 px wide.
4. **The lock release survives a tab close.** The release call is sent with `keepalive`, and the
   lock is taken once the profile is known so the holder is named. Proof: with the bid open in
   another tab, Rename said "Read only: Claude is currently editing"; that tab typed a new address
   and 1.5 s later Rename went through (before: refused for 45 s).
5. **The Combiner's customer and due date.** `combinedHeader` (lib/combine-bids.ts): the customer
   every source shares (and the site when they name the same one), picked as a change of this
   session, and the earliest source due date. Proof: two bids of one customer → "Linked to ZZ
   Bids Fix Claude", the Customer Name box filled, Bid due Dec 1 (the earlier of Dec 1 / Dec 15).
6. **One spelling per estimator.** `canonicalEstimator` (lib/bids-list.ts) reads a name against
   the roster (admin General → Estimators): the roster's spelling on a match whatever the case,
   the one roster name whose first name it is ("Brian" → "Brian Folden"), else as typed. The Bids
   page folds every row through it (the filter, the rows, the Years grouping) and the estimator's
   save stores the folded name. Proof: the Estimator filter lists Braden Keck, Brian Folden, Garry
   Peters, John — "Brian" is gone; "John" stays (no John on the roster).
8. **The documents' files go with a purged bid.** `removeBidDocumentFiles` lists each document's
   `docs/<id>/` folder and removes the files, before Delete permanently and before the 30-day
   sweep delete the rows (best effort: a file that cannot be removed is logged, the purge goes
   on). Documents themselves are only ever soft-deleted, so there is nothing to do on a document
   delete. Proof: a document with an exported PDF (`v1.pdf`) on the temp copy; after the purge the
   bucket held 0 files under its folder, the document and revision rows were gone.
9. **Labels.** The search box is labelled "Search" with "Bid name, customer or folder…"; the empty
   state says "Clear filters above" instead of a second button.

Tests: `src/lib/bids-page-fixes-nov6.test.ts` (16; 12 fail on the previous code), the pins
updated in `duplicate-bid.test.ts`, `copy-bid-name-nov3.test.ts`, `rename-bid-nov3.test.ts`,
`bid-due-date.test.ts`, `bids-folders.test.ts`; the shared fake gains a no-op `.returns()`. Chain
green: 500 files / 6,415 tests, 0 lint errors, types, build. Browser proof: scratchpad
`wo/pw-bids-5.cjs` on a temporary customer, bid, copy and document, all removed afterwards (uuid
sweep empty; 22 live bids, 0 "ZZ" rows).
