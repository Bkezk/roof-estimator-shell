# Bid side, Nov 4: the PlanSwift downspout row, a new customer from the bid, Next and leaving

Owner, Nov 4: "look at the activity and fitness center planswift import, its not really taking
in the downspouts, drops and a style 45 in correctly during the import. also can we have it to
where a new customer can be made in the customer form when starting a bid, similar to the
service side with a popup. and can we save the save and next button to just be next and when
you leave the page it asks if you want to save the changes rather than each next being a save".

## 1. The PlanSwift import

**What the bid's import record showed.** Sheet row 6 was one line carrying four things:
`4" X 5" Down Souts, 2 Drops, 6 A style 45's, 10' of Gutter strap` at 22.99 ft. The importer
read it as one thing: the word "gutter" made it a gutter (the "Down Souts" spelling is not
"downspouts"); the estimator moved it to Downspout by hand on the review screen and picked
4"X5"; the seeder, finding a downspout row with no part, treated it as an elbow — its name has
"45" and "A" — and wrote **23 `45° A-Style Elbow`** (22.99 rounded), no length and no drops.
The bid's summary line said "23 downspout drops / elbows". The owner put the right numbers in
by hand afterwards (20 ft closed, 2 drops, 6 elbows, 20 straps).

**Now** (`src/lib/planswift/classify.ts`, `picks.ts`, `to-seed.ts`, `parse.ts`):

- A FT / EA row whose name lists several things is split on the review screen
  (`splitCompoundRow`): the first clause keeps the row's quantity and unit; a later clause that
  starts with a count and names a downspout part (drops, outlets, elbows, `45's`) becomes its own
  EA row of that count carrying the first clause's downspout size; a clause that starts with a
  length (`10' of …`) becomes a FT row. Anything else stays in the first row's name. Roof areas
  never split (their names list layers by the inch). The split rows say "part of sheet row 6".
- "Down Souts" (a dropped letter) is read as downspouts.
- A strap is listed to place by hand with its length and where it goes (Metals › Downspouts ›
  Downspout Straps): the sheet does not say how many straps.
- A sized elbow whose name says the angle and the style (`A style 45's`) needs no pick; the
  seed places it on the `45° A-Style Elbow` row.
- A row moved to Downspout by hand is read by its unit — feet are a length, a count is drops /
  elbows / downspouts by its name — never an elbow by default (`downspoutDetailsFor`, used by the
  review wording, the pick box and the seed).

**Browser check** (local dev, the test login, a workbook with the same five rows, Create bid not
pressed): the review screen shows eight rows — the five of the sheet, with row 6 as `4" X 5"
Down Souts` 22.99 FT → Downspout 4"X5" open; `4" X 5" Drops` 2 EA → drops / outlets 4"X5";
`4" X 5" A style 45's` 6 EA → elbows 4"X5"; `Gutter strap` 10 FT → "Needs your pick". Three
rows ask (T-Bar, the gutter's style and size, the strap). Test:
`src/lib/planswift/activity-fitness.test.ts` (14; 12 fail on the old code).

The owner's existing Activity & Fitness Center bid is not changed by this: its numbers were put
right by hand. Re-importing the sheet now gives the 22.99 ft, 2 drops and 6 elbows directly.

## 2. A new customer from the bid's Customer Name box

Setup › Customer Name is the picker in its free-text mode; it offered profiles to link but no
"Add … as a new customer" row (that row was the ticket form's). Now the same row and the same
New customer dialog (`QuickAddCustomerDialog`) are offered there; the saved customer is picked,
so the bid is linked to it and filled from its profile, exactly as a pick from the list. Nothing
is highlighted until the arrow keys move, so typing a name and moving on still links or adds
nothing.

Browser check: typing a new name shows "No saved customer matches. Add them below, or the name
stays as typed." and the add row; the dialog opens titled New customer with the name filled;
Save links the bid ("Linked to <name>"). The temporary customer and bid made for the check were
removed afterwards, with their audit rows.

## 3. Next, Previous, and leaving the page

- The footer's buttons are **Previous** and **Next** and only change the step; the header's
  Save saves.
- Leaving the page with unsaved changes opens a dialog in place of the browser's confirm box:
  **Save changes to this bid?** — Stay / Leave without saving / Save and leave. Save and leave
  saves and then goes on; a save that is refused (a new bid without a due date, a bid without a
  customer) keeps the user on the page with the usual message; the unusual-numbers dialog, when
  it opens, answers for the leave (Save anyway goes on, Go back stays). Closing the tab keeps
  the browser's own warning.
- The unsaved-changes baseline now includes the bid's name and header (status, won / lost, due
  date) beside the saved body, the customer link, the folder and the reminder. Before, a rename
  or a status change alone did not count as a change; with Next no longer saving, leaving would
  have dropped it silently.

Browser check (temporary bid): Next moved from Setup to Sections with no save request; the
dialog showed on leaving with its three buttons; Stay stayed; Save and leave without a due date
stayed with "Give the bid a due date before saving"; with one it saved once and landed on Bids;
a rename alone showed "Unsaved changes" and the dialog, Leave without saving kept the saved
name; a due-date change alone asked too. Test: `src/lib/estimate-next-and-leave-nov4.test.ts`
(6; 4 fail on the old code). Pins updated: `technician-quick-add`, `bid-reminders`,
`bids-folders`.

## 4. Status and due date save at change (owner, later the same day)

"can we have the status box and due date auto save at change?" — on a saved bid they do, the
header alone: the Status picker (and the lost reason from its dialog, and the Won on day) through
the Bids list's own `setBidStatus`; the due date through the new `setBidDueDate` (same rule as
Save: a day replaces the stored one, clearing it is allowed only on a won / lost bid). A new bid
keeps them for its first Save. The saved-changes baseline is now two: the body (sections, pricing,
customer link, name) and the header, so a status saved alone leaves a pending section edit
pending and the leave dialog still asks about it. The due date and the won day save when the
typing stops (0.9 s) or the box is left, never a half-typed year. A refusal (a date cleared on a
draft) is said and the change stays here for the next Save. Neither call stamps
`content_saved_at`, so the tab's next full Save is not told its copy is stale; the bid's cached
row is updated too, so reopening it in the same tab shows what was saved.

Browser check (temporary bid, removed afterwards): Draft, Won (today filled in), a won day,
Lost with its reason, Submitted — one save each, "Status saved: …", the Unsaved marker clear;
the due date saved after the pause (and when typed segment by segment); clearing it on a draft
was refused with Save's words and stayed pending; a rename stayed pending through a status
save and the leave dialog asked for it; reopened, the bid showed the saved status and date.
Test: `src/lib/bid-header-autosave-nov4.test.ts` (6; all fail on the old code).
