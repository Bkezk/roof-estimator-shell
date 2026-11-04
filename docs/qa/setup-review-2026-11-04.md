# Setup page review, Nov 4

Owner: "take a look at the setup page and suggest any efficiency, streamlined, workflow, or
layout improvements." Nothing was changed. The page (`/setup`, admins and managers) was read in
the source and driven in the browser as the test login at 1440 px and 390 px with every write
refused; the numbers below are measured, the live counts read from the database.

What is there: four tabs. Service rates (12 hourly rates, authorizer, tax, payment terms, the
invoice's contact line, email subject and message, one Save). Material pricing (the markup and
137 materials, 89 of them priced from Estimate Pricing; one Save for the lot). Inspection
checklist (11 rows, arrows, Save). Vehicles & drivers (4 vehicles, a Save per vehicle, no driver
set today; one driver row ever).

## Suggestions

1. **Unsaved edits are lost without a word.** Proven: on Material pricing the markup typed 76,
   then the Inspection checklist tab, then back: the box read 75 again and "Unsaved changes" was
   gone (the tab's contents unmount when another tab is picked). Typed again and clicked
   Opportunities in the menu: the page left at once, no dialog. The same holds for the checklist
   and the rates. Service rates has no "unsaved" state at all: Save is enabled before anything is
   typed. Suggest: keep the tabs' contents mounted (or hold the switch while a tab has unsaved
   edits), the leave dialog the Opportunities page got on Nov 4 ("Save changes?" Stay / Leave /
   Save and leave) on all three editable tabs, and a dirty state on Service rates so Save and
   "Unsaved changes" mean something.
2. **Material pricing is a wall of boxes.** 137 rows × name, unit, cost, group, show = 461
   inputs on one screen: 5,769 px tall on a desktop, 17,265 px on a phone, 78 KB to load. The
   office changes a handful of prices at a time. Suggest: rows as plain text with the boxes
   appearing for the row being edited (click or a pencil), grouped under their Group headings
   (9 groups) that fold; a "Priced here" filter (the 48 rows whose cost is typed on this page
   rather than following Estimate Pricing, which is what the office can actually change); the
   count line to follow the search ("33 of 137" while "sealant" is typed, not "137 materials");
   Add material to put the cursor in the new row's name box (today the button keeps the focus,
   and the row appears above the list header's fold).
3. **Service rates mixes three things under one heading.** The hourly table, then "Authorizes
   Done tickets", the tax rate, payment terms, the invoice contact line and the email wording,
   all in one form with one Save at the bottom and no section headings. Suggest headings:
   Hourly rates / Invoices (tax, terms, contact line, email) / Authorizing Done tickets, or an
   Invoices tab of its own. Also: the amber note "Defaults came from the CenterPoint invoices in
   the report; confirm the helper travel rates with the office" has been on the page since the
   rates were seeded (Sep 27) and nothing has been saved since. Either the rates are right, and
   the note goes, or it becomes a one-time "These rates are confirmed" button; a warning that
   never clears is read past. The Tax rate box is blank for a stored 0 (number boxes start
   blank): the hint should say that blank means no tax.
4. **Phone layout.** Service rates: the table scrolls sideways (461 px wide in a 390 px screen)
   so the two cost columns are off-screen with no sign that they exist. Suggest bill and cost
   stacked under each role, or the cost columns under a "Costs" fold. Inspection checklist: the
   "Recommend repairs" row's note pushes its arrows and trash can past the row's edge (they end at
   357 px in a 323 px row); put the note under the box on narrow screens. Material pricing is
   usable as cards but 17 thousand px long (item 2 answers it).
5. **Small things.** (a) Opening `?tab=vehicles` first paints Service rates and fetches the
   rates (seen: the rates request on the vehicles tab) because the profile has not arrived when
   the tab is chosen; hold the tab until the profile is known. (b) The inventory locations are
   fetched on every tab; only Vehicles needs them. (c) Vehicle names ("Service vehicle -
   N2X384") come from Inventory and cannot be changed here; a line "Vehicles are named on
   Inventory" with a link saves a hunt. (d) Material pricing sends all 137 rows on every Save;
   the server diffs, so it works, but sending the changed rows alone is lighter and the error
   messages ("'X' needs a unit") would name only rows the user touched.

## Not suggested

The place in the menu (Customers › Setup, owner Oct 5) and the four-tab shape are the owner's
decisions and work; the arrows on the checklist do the job for 11 rows (drag and drop is not
worth its weight here).

## The changes (owner: "go on 1, 2, 3, 4, and 5")

One push, every item with a test that fails on the code before it
(`src/lib/setup-review-nov4.test.ts`: 22, of which 19 fail on the old code; the three that pass
are pure rules in a new file). Checked in the browser as the test login with every write
refused (the page's saves would change the office's real settings), at 1440 px and 390 px, no
console errors.

1. **Unsaved edits survive, and leaving asks.** A tab's card stays mounted (hidden) once opened,
   so a tab switch keeps every edit; a tab with unsaved edits carries an amber dot; leaving the
   page opens "Save changes to Setup?" naming the tabs (Stay / Leave without saving / Save and
   leave, which saves every dirty card). Service rates has a dirty state: Save is off until
   something is typed, "Unsaved changes" beside it, and a refetch never overwrites edits. Browser:
   typed 56 in a rate and 9.99 on a material, switched tabs twice, both still there and both tabs
   dotted; the Opportunities link opened the dialog ("Service rates, Material pricing have changes
   that are not saved"); Stay kept the page; Save and leave with the writes refused showed the two
   cards' error toasts and stayed; Leave without saving went to /opportunities.
2. **Material pricing reads as text under headings.** 20 group headings, folded to start (the
   page is 1,050 px instead of 5,769, 54 inputs instead of 461): the groups priced here A–Z, then
   "From Estimate Pricing › <screen>". A search opens them all and matches the heading too
   ("pipe" finds the Pipe Stacks); a group holding an unsaved edit never folds away. Click a row
   (or its pencil) to open its boxes, Done to close them; Show stays a live checkbox on the text
   row. "Priced here only (48)" keeps the rows whose cost is typed here. The count follows the
   filters ("15 of 137 materials"). Add material opens the new row at the top with the cursor in
   its name. A save sends only the rows that changed, and the server now checks a renamed row's
   name against the rows left out of the payload (`NAME_TAKEN`).
3. **Service rates in three sections.** Hourly rates / Invoices (tax, terms, contact line, email)
   / Authorizing Done tickets. The CenterPoint note stays until "These rates are confirmed" is
   pressed, which stamps who and when (`confirmServiceRates`; `20261104220000_rates_confirmed.sql`,
   applied live). Not pressed here: that is the office's call. The tax hint says blank means no
   tax.
4. **Phones.** The rates table is for wide screens; below `md` the four boxes of each role stack
   under it, labelled, the same draft behind both (24 boxes, no sideways scroll). The checklist
   box shrinks so the number, the box and its three buttons share one line, and the "asked as the
   switch" note sits under the box.
5. **Small things.** `?tab=vehicles` waits for the profile (no rates paint, no rates request);
   the vehicle list loads with the Vehicles tab only; the card says "Vehicles are added and named
   on Inventory" with a link; the material save payload is the changed rows (item 2).

Pins updated: `service-rates-layout` (the three sections), `managers-authorize` and
`service-material-sync` (wrapping), `setup-page` / `inventory-batch-oct9` unchanged. Chain: lint
clean, types clean, 493 files / 6,329 tests, build OK.
