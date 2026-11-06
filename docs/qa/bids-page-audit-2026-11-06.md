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
No fix was made — the owner decides.

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

## Suggested fixes (not made)

1. A slim list query (the columns plus `data->customer->>estimatorName`, `data->customer->>name`,
   `data->>roofSystem`, the sections' systems and `data->importInfo->>source`), as the Customers
   list got on Nov 6; update the one row in the cache after a rename / status / folder change
   instead of refetching the list.
2. Copy the folder; ask for the copy's due date in the Copy popup (the source's day prefilled),
   or require it on the copy's first save like a new bid.
3. Let the row's right cluster wrap below md (due and total on one line, status and the buttons
   on the next).
4. Send the lock release with `keepalive` (or `navigator.sendBeacon`), and wait for the profile
   before taking the lock so the holder is named.
5. Prefill the Combiner's customer (and the earliest due date) when the sources agree.
6. Pick the estimator from the profiles instead of free text, or normalize on save.
