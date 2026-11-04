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
