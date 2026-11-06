# Customers audit, Nov 6

Owner: "audit the Customers page the same way: the database rules read live, the page driven in
the browser on temporary rows of my own, and other users impersonated in SQL, with findings
reported before anything is fixed." Nothing was changed; the findings wait for a go-ahead.

Three layers: the live database's rules read from it (policies, constraints, triggers, the
`merge_accounts` and `save_contact_with_sites` functions); the page driven in the browser as the
test login (admin) at 1440 px and 390 px, with the database read after each write; and SQL
impersonation of three other users (a service-only technician, an office user with Customers,
a manager), every write attempt rolled back. Writes from the browser went through a guard that
allowed only the customer, property, warranty and task server functions, and only when the
payload named my temporary rows (or a "ZZ" name); everything else — REST, storage, the aerial
cover, documents, follow-ups — was refused on the wire. Temporary rows: one customer inserted by
SQL as a CenterPoint import with no contact info, two customers made through the New customer
dialog, and the contacts, properties, a task and an opportunity under them; all removed
afterwards. `crm_accounts` 636 live / 1 deleted, `crm_sites` 1,137, `crm_contacts` 707 and the
2,520 customer audit rows before and after.

## Expected behaviours, proven

| #   | Expected                                                                                                                              | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The page is for Customers access; a service-only technician gets only the customers of their own tickets; reads and writes follow RLS | `pageForPath("/customers")` = customers. Policies read: reads = customers ∨ estimate ∨ (service ∧ not technician) ∨ the technician's own tickets' rows; writes = customers ∨ service. `is_technician()` and `isFieldOnly` name the same six pages. As the technician: 1 customer, 20 properties, 1 contact (their ticket's), `audit_log` 0, `crm_user_options()` 9; an update or soft-delete of a customer they cannot see: 0 rows; `merge_accounts` refused. As the office user: 639 customers, `audit_log` 0, merge refused. As the manager: 639, the customer audit rows, merge refused ("Only an admin can merge customers"). |
| 2   | The list shows every live customer alphabetically with a count                                                                        | "637 of 637 customers" (636 + my imported row), 637 cards, the first three in A–Z order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 3   | The search reads name, city, contact, phone, email and customer #                                                                     | "Corbin" → 80 cards, every one saying Corbin, "80 of 637"; "ZZ-AUD" (my row's customer #) → 1 card with "#ZZ-AUD" and the "No contact info" badge; nonsense → "No customer matches “zzzz nothing”."                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4   | The account-manager filter                                                                                                            | Unassigned 466 (= 637 − 171 with a manager in the database); one manager 64, every card naming him; All → 637.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5   | The four sorts                                                                                                                        | Most tickets in progress: the first six read 7, 1, 1, 1, 0, 0. Recently updated: my row written today first. Account manager: named managers first (A–Z), the 466 unassigned last with no assigned card after them. Name A–Z as the default.                                                                                                                                                                                                                                                                                                                                                                                      |
| 6   | `?tab=vendors` is the Vendors tab; anything else the Customers tab; `?id=` redirects to the customer's page; a bad id reads plainly   | Vendors: the Vendors heading underlined, no customer list, "Add vendor". `?tab=bogus`: Customers underlined, the URL kept. `/customers?id=<uuid>` → `/customers/<uuid>`. `/customers/not-a-uuid` → "Could not open the customer: The record looks wrong"; an unknown uuid → "… Customer not found".                                                                                                                                                                                                                                                                                                                               |
| 7   | A customer with no email or phone is marked, and gets one through Contacts                                                            | My imported row: the badge, the red line "Add an email or a phone number: this customer has no email or phone on file. Edit to add one.", Primary contact "None — add one under Contacts and mark it primary". Add contact starts with Primary on; a contact with an email → "Contact added"; the line and badge gone, the email shown. Database: `contact_name` and `email` mirrored onto the customer, the contact `is_primary`.                                                                                                                                                                                                |
| 8   | New customer: the look-alike warning, the contact rule before any request, the primary contact and the first property                 | An existing customer's name typed in lower case → "A customer with a name like this is already here" with its city, # and contact and "Use this customer". A new name → no box. Save with no email or phone → the inline line and toast "Add an email or a phone number", 0 requests. With a contact, a cell phone and an address → "Added ZZ Audit Temp Claude", the page: Primary contact "ZZ Person", `tel:6065550101`, "Open in maps" to the address; Contacts 1, Properties 1 — the property named after the customer at "10 Audit St, Corbin, KY 40701", 0 tickets.                                                         |
| 9   | Every section starts folded; a fold is remembered per user                                                                            | On arrival every `data-fold` folded except Contacts (opened by me on the imported customer minutes before) and Documents (its own state). After a reload: Tickets folded, Properties / Contacts / Tasks open as I left them.                                                                                                                                                                                                                                                                                                                                                                                                      |
| 10  | Edit: Save off until a change, "Unsaved changes", Cancel drops the change                                                             | Save disabled on opening; typing billing instructions → "Unsaved changes", Save on; Save → **refused** (finding 1); Cancel after a renamed Name → the heading unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 11  | Contacts: one Primary per customer, mirrored onto the customer's contact line; a deleted primary leaves the last values               | A second contact starts with Primary off; marked primary → the badge moves, header "ZZ Second · Roofer", Cell phone (606) 555-0202, the Email row gone (the mirror copies the row's blank). Delete → "Delete the contact “ZZ Second”?", "Contact deleted", header "ZZ Second — no primary contact marked; mark one under Contacts", the cell phone kept. The first contact marked primary again → header, cell phone and email back. Database after: one `is_primary` row, the deleted one false, the customer's four columns equal to the primary's.                                                                             |
| 12  | Properties: add with an address, instructions, a site and a warranty; edit; delete                                                    | "Property added"; the row: "20 Audit St, Corbin, KY 40702", "Technician instructions: Gate code 1234", "Warranty: Duro-Last 15 NDL · to Jan 2035", "Sites: ZZ Building A", 0 tickets. The pencil loads the site and the warranty into the form; a rename → "Property saved", the new name. Delete → "Tickets at this property keep the property name and address they were saved with.", "Property deleted", Properties 1. Database: the property soft-deleted, its warranty row still under it.                                                                                                                                  |
| 13  | New task starts on this customer                                                                                                      | The dialog's company box read "ZZ Audit Temp Claude"; "Task added"; Tasks 1: "ZZ temp task · Nov 6, 2026 · Claude · Open".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 14  | History (admins and managers) lists the customer's, its properties' and contacts' changes                                             | 15 lines after the above: the property created with its site and warranty, the rename, the delete, the contacts; after the merge: "Customer 'ZZ Audit Temp Claude 2' merged into 'ZZ Audit Temp Claude': 1 property, 1 contact". Database: 33 audit rows for the run by entity and action.                                                                                                                                                                                                                                                                                                                                        |
| 15  | Delete is refused while the customer has open tickets or opportunities                                                                | With an open opportunity (made by SQL): Opportunities 1, the row "ZZ temp opportunity · Open · Unassigned" linking to it; Delete → "Could not delete the customer: This customer has 1 open opportunity; close or move them first"; still on the page, not deleted.                                                                                                                                                                                                                                                                                                                                                               |
| 16  | Delete removes the customer from the list; it still opens by id read-only; Restore brings it back with its contacts and properties    | Opportunity set lost → Delete → "Customer deleted", back on the list, 0 cards for the name. By id: "Deleted on Nov 6, 2026 by Claude. It is out of the list and the searches…", no Edit / Delete / Add / New ticket, Contacts 0, Properties 0. Restore → "Customer restored", Contacts 1, Properties 1, Edit back — but the primary flag gone (finding 3).                                                                                                                                                                                                                                                                        |
| 17  | Merge (admins): pick the customer to keep, never itself; everything moves; the merged one is deleted with a note                      | A second temp customer (its look-alike box named the first). Merge into…: the button off until a pick; picking itself → "That is this customer. Pick the one to keep.", still off; picking the first → "Merge into “ZZ Audit Temp Claude”"; → "Merged … into …", landed on the kept one: Contacts 2 (the moved one Primary, the kept one's flag having been lost by the restore), Properties 2, Office phone (606) 555-0303. The merged one by id: the banner, Notes "Merged into ZZ Audit Temp Claude on Nov 6, 2026", and a Restore button (finding 4). Database: the nine `account_id` tables are the nine the function moves. |
| 18  | Phones: the card's three counts sit under the name; nothing scrolls sideways                                                          | 390 px: the counts row 336 px wide under the name in a 364 px card; `scrollWidth` 390 on the list and on the customer's page; the header's New ticket / Edit / Merge into… / Delete customer wrap.                                                                                                                                                                                                                                                                                                                                                                                                                                |

Every step ran with no page errors.

## Findings (not fixed)

1. **Editing a customer never saves.** Since Nov 2 (71220a3, my change: the Contact / Cell phone /
   Office phone / Email left the Edit form for the primary contact row), the form sends the
   customer without those four fields — and `accountSchema`'s "Add an email or a phone number"
   check runs on the fields sent, so every Edit save is refused with that message, whether the
   customer has a primary contact or not. Proven twice in the browser (the new customer with a
   primary contact; the imported one) and once outside it: the exact Edit payload through
   `parseInput(accountSchema, …)` throws "Add an email or a phone number". Effect: since Nov 2
   nobody could change a customer's billing instructions, notes, addresses, account manager,
   kind or Sage # from the Customers page (the four contact fields are changed under Contacts,
   which works). Nothing was lost, every such save was refused. Fix: the contact check applies to
   a new customer, and to an update only when one of the four fields is sent; the server already
   drops the four when a primary contact exists. One schema change and a test that fails on the
   old code.
2. **"Edit to add one" points to the wrong place.** The red line on a customer with no email or
   phone says "Edit to add one", but Edit has had no email or phone boxes since Nov 2; the way is
   Contacts › Add contact, which starts the contact as the primary (behaviour 7). Fix: the line
   says so.
3. **Delete then Restore loses which contact was the primary.** Deleting a customer stamps its
   contacts `deleted_at`, and the contacts' trigger clears `is_primary` on any deleted row; Restore
   clears the stamps only, so the customer comes back with no primary (the header says "no
   primary contact marked"). The next contact marked primary — or a merge bringing one in, as in
   behaviour 17 — then overwrites the customer's phones and email with that person's (the kept
   customer's email was blanked in my run). Fix: the trigger leaves `is_primary` alone on a
   soft-delete (the mirror and the one-primary index already ignore deleted rows), so a restore
   brings the flag back; or `restoreAccount` re-marks the contact whose name matches the
   customer's mirrored contact.
4. **A merged customer can be "restored".** The dropped customer's page shows the deleted banner
   with a Restore button; pressing it would bring back an empty shell beside the kept customer,
   while the merge dialog promised "This cannot be undone." Fix: no Restore (and `restoreAccount`
   refuses) when the customer was merged — its notes carry the "Merged into … on …" line, or a
   `merged_into` column records it.
5. **Both tabs are marked current on the Vendors tab.** `aria-current="page"` is on Customers and
   Vendors at once on `?tab=vendors` (the router marks a link to `/customers` active whatever the
   search); the underline is right. Screen readers hear two current tabs. Fix: the tabs compare
   the search (`activeOptions`), or set `aria-current` themselves only.
6. **Raw error wording.** The Customers page, the property form, the New customer dialog, the
   property cards and the bid-link dialog show the raw message (seen: "Could not make the
   aerial: Failed to fetch" on a property card) where the Service and Setup pages say "No signal.
   Check your connection and try again." (`plainErrText`, Nov 3). Fix: the same helper here.
7. **A technician-only user can create a customer through `saveAccount`.** `quickCreateAccount`
   refuses them ("The office adds customers", Oct 21) but `saveAccount` with no id checks only
   Customers-or-Service access, and RLS lets a Service user insert (proven: the insert went
   through under impersonation, rolled back). Not reachable from a technician's screens; defence
   in depth. Fix: the same refusal on `saveAccount`'s create path.

## Not exercised

- Link a bid, Unlink, the "Bids that look like this customer" strip and the offer after a new
  customer: they change real bids, none of which are mine.
- The Takeoffs section (nothing linked), the Documents list (its read goes by POST and the guard
  refused it), the property's own page, the cover photo and the aerial (an outside imagery
  server, refused by the guard), @mentions in Notes (Edit cannot save, finding 1), the Vendors
  tab's own forms, and the opportunity and task rows' click-through.
- Other users in the browser: only in SQL.

## Cleanup

The three temporary customers with their contacts, properties, the property's site and warranty,
the task, the opportunity and every audit row of theirs were deleted by SQL; counts afterwards:
636 live customers, 1,137 properties, 707 contacts, 2,520 customer audit rows, no "ZZ" row in any
table. Seventeen orphaned audit rows from the Nov 4 opportunities audit's temporary rows (their
customers, contacts and properties long gone) were found by the same check and removed too, so
the customer audit rows now stand at 2,503.
