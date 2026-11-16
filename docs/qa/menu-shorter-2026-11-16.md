# The shorter menu, Nov 16 2026

Owner: "Do you have any suggestions for condensing the admin list on the nav bar?" A mock-up
with two options was shown. The owner's choice: "I like B but I want to keep estimate pricing by
the project bids because those are closely related. I'd like to to be takeoffs, projects bids,
estimate pricing (with the dropdown as proposed in option B), inventory. I think documents may
should fall under the setup page as another tab option, what do you think?"

## Measured before

- 29 rows for an admin.
- On a 1366 x 768 screen the menu needed 848 px and had 545 px. 303 px sat below the bottom edge,
  which was the whole Admin group.
- On a 1920 x 1080 screen it fitted with 0 px to spare.

## What changed

| Part | Before | Now |
| --- | --- | --- |
| Estimate | Takeoffs, Project Bids | Takeoffs, Project Bids, Estimate Pricing, Inventory |
| Estimate Pricing | A group of its own, five rows always showing | One row in Estimate. A press opens the same five rows in place, each with its own list as before |
| Inventory | A group of its own holding one row | The last row of Estimate |
| Admin | Owner, Users & access, Reminders, Documents | Owner, Settings |
| Settings | Did not exist | One row. Users & access and Reminders are its two tabs |
| Documents | A row of the Admin group | The fifth tab of Setup |
| Bottom | My account, Sign out, Collapse menu on three rows | Sign out sits beside My account |

Details:

- Estimate Pricing starts shut. It is open while a pricing page is showing. A press on the row
  wins for the rest of the visit.
- The icon-only menu has no room for a dropdown, so it shows the five pricing pages as icons, and
  Sign out as its own icon.
- Someone with Inventory and none of the estimate pages, a technician, gets Inventory as a plain
  row with no "Estimate" header over it.
- Each row of Estimate shows only with its own access, as before.

## No address and no access rule changed

- Users & access is still `/admin/users` and Reminders is still `/admin/reminders`. Each page
  shows the Settings strip at the top with its own tab lit.
- Documents is still `/admin/documents`. It now shows Setup's heading and tab strip with
  Documents lit, so it reads and works as Setup's fifth tab. A press on a service tab there opens
  `/setup`.
- `/setup` is still for admins and managers only. Documents is still for everyone with Documents
  access. So an office person sees Setup with the Documents tab alone, and the menu's Setup row
  takes them straight to it.
- Leaving `/setup` for the Documents tab with unsaved edits asks first, as leaving for any other
  page does.

## Measured after

- 21 rows for an admin.
- On a 1366 x 768 screen the menu needs 588 px and has 574 px: 14 px below the edge, down from
  303 px. Folding any one group clears it.
- On a phone the drawer needs 606 px and has 606 px.

## Proof

Tests: `src/lib/menu-shorter-nov16.test.ts`, 18 tests. With the menu and the four pages put back
to the old code, 11 fail. Thirteen older pins of the old menu's wording were updated on purpose,
each with a note saying what it read before.

Browser, local code against the live database, on a laptop and a phone as an admin:

- The groups read Customers, Prospecting, Estimate, Admin, with the rows in the table above.
- Estimate Pricing opened to its five rows. On the Duro-Last page it stayed open and its list of
  22 categories was there.
- Inventory opened from the Estimate group.
- Settings opened Users & access. The Reminders tab opened Reminders, and the Settings row
  stayed lit on both.
- Setup showed five tabs. Documents opened the library with 5 templates under Setup's heading.
  Material pricing took it back to `/setup?tab=materials`.
- Sign out beside My account signed out.
- The icon-only menu showed 19 page links and a Sign out icon.
- 0 px sideways scroll and 0 console errors.

Roles, by changing the test login's role and putting it back to admin after:

| Signed in as | Menu | Setup row | Typed addresses |
| --- | --- | --- | --- |
| Office | Work Overview; Customers: Customers, Service, Opportunities, Setup; Inventory as a plain row | Opens Documents, one tab | `/setup`, `/admin/users`, `/admin/reminders`, `/owner` all sent home. `/admin/documents` opened |
| Technician | Service: My tickets; Inventory as a plain row | None | All six sent home, Documents included |
| Estimator | Adds Prospecting and Estimate: Takeoffs, Project Bids, Estimate Pricing, Inventory | Opens Documents, one tab | `/setup` and the admin pages sent home |
| Manager | As the estimator, no Admin group | Opens `/setup`, five tabs | `/setup` opened. `/admin/users`, `/admin/reminders`, `/owner` sent home |

The test login was read back after: admin, technician on, no page list.

Chain: lint 0 errors, types clean, 563 files and 7,471 tests pass, build ok.
