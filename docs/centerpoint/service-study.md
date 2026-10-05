# CenterPoint Connect — Service side study, compared with JBK Portal

Studied 2026-10-05 in the owner's signed-in Chrome (login shown as **RS**, RoAnna Sims, role
Administrator), CenterPoint version 5.10.054275. Read-only throughout: nothing was saved, sent,
archived, deleted, imported or exported. Two view filters were changed and put back (the list's
Archived filter, the Tech Board's Active/All toggle). Forms were opened, read and left with
Cancel / Back. Customer details below appear only where they show a format.

Screenshots are in `screenshots/service/`, numbered in the order taken, cited as [n]. The
earlier study (`centerpoint-report.md`, screenshots `screenshots/01…77`) is cited as [R-n].

Tickets used: **5484** (open, New Service, technician assigned, a callback after a completed
visit), **5431** (completed and invoiced), **5493 / 5494** (completed, on the Tech Board).

---

## A. Service List ("TICKETS")

Route `#!/service`. Orange header bar: view switcher, filter, search, "85 Tickets", **New
Ticket +**, ⋮ [1].

**Columns shown by default** (21 of 48 available) [1][9][10]:

| # | Column | Notes |
|---|---|---|
| 1 | TICKET ID | link to ticket; small orange ticket icon; archived rows add an archive-box icon under the number [14] |
| 2 | DESCRIPTION | free text, often the building name ("Bell Co High School") |
| 3 | COMPANY | link (red, company icon) — the **bill-to** company |
| 4 | PROPERTY | link (blue, building icon) |
| 5 | OPPORTUNITY MANAGER | blank on every row seen |
| 6 | CITY · 7 STATE | property city / state |
| 8 | TECHNICIAN | link to employee |
| 9 | TYPE | Leak / Scope / Inspection … |
| 10 | CREATED BY | link to employee (RoAnna Sims on almost every row) |
| 11 | INVOICE | invoice amount, e.g. `$876.73`; `$0.00` or blank before invoicing |
| 12 | MARGIN | e.g. `-18.5%`, `16.8%`, `413%` |
| 13 | COST | e.g. `$1,038.84` |
| 14 | PURCHASE ORDER | blank on most rows |
| 15 | STAGE | coloured stage icon + name (New Service maroon, Authorized teal double-tick, Invoiced indigo card, Completed green tick) [9] |
| 16 | STAGE DATE | default sort, newest first (sort arrow on header) |
| 17 | PAID DATE | blank on every row |
| 18 | SALE PRICE | `$0.00` on every row seen |
| 19 | MATERIAL TOTAL · 20 LABOR TOTAL | billed amounts |
| 21 | JOB # | e.g. `26R PMC TMR 1`, `22 CBVG 1` |

The other 27 columns (off by default) [6]: Archived, Hold, Company External Id, Building Id,
Sections, Related, Active Service Agreement, Account Manager, Property Account Manager,
Estimator, Address, Postal Code, County, Created Date, Completed Date, Invoiced Date, Product,
Job Hours, Margin/Hour, ETA Date, NTE, In Progress Date, Material Cost, Labor Cost, Other Cost,
Other Total, Integration. Columns can be re-ordered (drag handle) and given aggregates.

**Default sort:** Stage Date, newest first. **Paging:** 50 per page, "Showing 1 to 50 of 85
Tickets | 50 Per Page" with page links; no totals row.

**Filters** (dialog with three tabs PRESETS / FILTERS (13) / COLUMNS (48)) [2][3][4][5]:
Service Type (7 types, multi-select); Date Filters — Stage Date, Created Date, Completed Date,
Invoiced Date (each "All Time" or a range); Employee Filters — Manager, Technician; Advanced —
"Show Only Hold", "Show Approval Required", Archived (Hide Archived / Show Archived / Only Show
Archived; default Hide); Stages (the 9 stages, multi-select). **Saved views:** PRESETS tab has
"+ Add New Preset" and no presets saved [5].

**Search** (magnifier in the header, runs on Enter) [8]. Tested: ticket number `5431` → 1 hit;
company name `Relco` → 1; property name `Yellow Creek` → 2 (one invoiced, one open); a word in
the description `Middlesboro` → 1. **Not matched:** Job # fragment `26R` → none; technician
surname `Floyd` → none; city `Pineville` → only two *Pikeville* tickets (a fuzzy name match),
none of the five real Pineville tickets. So search covers ticket #, description, company and
property names, with typo tolerance; not city, Job # or technician.

**⋮ menu** [7]: Refresh, Edit Columns, Download All to CSV, Email CSV, Archive Selected,
Choose Stage (bulk stage change), Select Page, Select All (for export only), Unselect All,
Reset Filters. Bulk actions are Archive and Choose Stage only.

**View switcher** (list icon) [11]: List, Board (= the Tech Board [12]), Map (= Service Map,
§E), Schedule — a "Today's" list pre-filtered to stages Scheduled, En Route, In Progress
("No Tickets Scheduled" today) [13].

**Archived tickets** [14]: "Only Show Archived" lists 3,677; rows look the same plus the
archive-box icon; nearly all are at stage Closed. Archiving is how tickets leave the working
list (85 unarchived).

**Row colours:** none — alternating grey/white only. Meaning is carried by the stage icon.

**Clicks:** list → ticket 1 (ticket #); list → property 1 (property link in the row); list →
company 1; list → invoice 2 (ticket, then "View" or "Edit & Send" in the Invoice block).

## B. New Ticket

Route `#!/service/new`, one card "Ticket Information" [15][16]. The ticket number is not
shown on the form; it is assigned on Save, sequential (newest seen 5495).

| Field (as printed) | Type | Default | Required | Source / behaviour |
|---|---|---|---|---|
| Description | single-line text | blank | no | — |
| Property* | search box (type-ahead) | blank | **yes** — "Property is required." | matches property **name** only (tested "Main St", "Corbin", "Yellow"; an abbreviation `YCES` found nothing); result row is the name alone, no address or company [17] |
| Bill To* | search box over **all companies** | filled with the property's company when a property is picked [18] | **yes** — "Bill To is required." | can be changed to any company; the list is every company, A–Z |
| Sections | dropdown, appears after a property is picked | blank | no | the property's roof sections ("Section 1") |
| Site Contacts | multi-select | blank | no | the bill-to company's contacts, name only [19] |
| *Include Repairs +* | button, appears after a property is picked | — | — | opens "Include Repairs — Review existing repairs from the property": unassigned repairs from earlier inspections/bids (section, name, qty, price, warning icon), "Include All Unassigned", "Selected 0 of 2 Repairs: $0.00" [20] |
| Service Type* | native dropdown | **Leak** | yes | Leak, Scope, Warranty, Inspection, Non-Billable, Rooftop Maintenance, Snow Removal |
| Purchase Order # | text | blank | no | — |
| Labor Rate | dropdown + number | blank / blank | no | Emergency → 135, Urgent → 95, Standard → 85 fill the number box, which stays editable |
| Not to Exceed | number | blank | no | a dollar cap; separate from Labor Rate |
| Notifications* | dropdown | **On** | yes | On, Internal, Off |
| Job # | text | blank | no | typed by hand (`26R YCES 2` = year, R/W, property code, sequence) |
| Service Notes | rich text (bold, italic, underline, strike, quote, lists, link) | blank | no | placeholder "Insert note here... Use @ to notify someone" — becomes the first History note |
| Attachment | Upload Attachment | — | no | — |

Save is greyed until Property and Bill To are set; the only messages are the two "… is
required." lines [22]. **Repairs mode:** once the Include Repairs dialog has been opened, the
form swaps Service Type, Purchase Order #, Labor Rate and Not to Exceed for one **Estimated
Cost** field and shows "0 Repairs: Don't Include Repairs +" to switch back [21].

Two properties at one address: the result row shows only the name, so they are told apart only
by name. *Not seen*: a real duplicate.

## C. The ticket page

Route `#!/service/<id>`. Title = ticket number. Tabs TICKET INFORMATION / MATERIALS /
PURCHASE ORDERS [23].

**1. Ticket Information card.** Work Order ID, Description, Service Type, Purchase Order #
(only when set), Labor Rate (`$0.00 / hr` on both tickets), **Technician** + "Generate Link",
**ETA** (`8/24/26 9:00am Morning (8-10am)`), Created By, Job # [42]. Technician / ETA rows
appear only once the ticket is scheduled — 5484, sent back to New Service, has neither [23].
Header icons: folder (files), envelope (email), bell (notifications), pencil (edit), ⋮ —
**Archive Ticket, Place Ticket on Hold, Refresh, Delete Ticket, Mark as Approved, Require
Approval**.

**Edit (pencil)** opens the same card as a form in place [38][39]: Work Order ID, Description,
Property*, Bill To*, Sections, Site Contacts, Service Type*, Purchase Order #, **Estimated Cost
(?)** (`$700.70`, its own pencil), Labor Rate (dropdown + number), Not to Exceed,
Notifications*, **Status Dates** (Show/Hide: Ticket Created date+time, Scheduled, In Progress,
Completed, Invoiced, Closed — each "Set Time"), Job #, Related Productions; Save / Cancel.
Technician and ETA are **not** on this form.

**2. Company card** — name (link), address (link), Billing Address, Billing Instructions
("Need A PO on invoice /call BOE"). **3. Property card** — name (link), address (link),
Technician Instructions ("Metal and Epdm Roof"), warranty badge (`DURO-LAST 15 NDL`) and a
large WARRANTY watermark when the property has a warranty [23][43].

**4. Open Ticket** button → the Workflow (§F).

**5. STAGES strip** [24][25][43]. On an open ticket: the current stage as a large tile with its
date, the **next two stages as buttons** ("Mark as Accepted", "Mark as Scheduled") and ⋮ → **Go
Back**, **Choose Stage** (any of the 9). On an invoiced ticket every passed stage is a grey tile
with its date and the current one large; "Mark as Closed" follows. Stage dates are whenever the
stage was pressed (5431: En Route 8/17 before Scheduled 8/24). Every stage is a button; none
moves by itself except Invoiced (set by sending the invoice, per [R-§2]) and Completed (set by
"Complete Service" in the Workflow).

**6. Invoice block** (invoiced tickets) — "Invoice", **View**, **Edit & Send** [43].

**7. Folding panels**, in order:
- *Service Documents* — "Create Service Document +" (Blank Document); columns SERVICE
  DOCUMENT, CREATED, SIGNATURE, SIGNED, PRINTED NAME, PURCHASE ORDER [26].
- *n Timekeeping Entries* — "Add Time +", ⋮ (Refresh, Edit Columns, Download CSV, Email CSV);
  summary "Technicians: 2 (?) Travel: 1.5 Labor: 1.25 Total: 2.75"; columns DATE, EMPLOYEE,
  TASK (Travel / Labor), TIME IN, TIME OUT, HOURS [27]. The (?) reads "Labor will be duplicated
  for each additional Technician on the Invoice" [28].
- *n Service Repairs* — "Include Repair +", "New Repair +", ⋮ (Refresh, Edit Columns, Print
  PDF, Hide From Invoice, Show on Invoice, select); columns REPAIR, SECTION, QUANTITY, PROBLEM
  (n Photos ✓), RESOLUTION (n Photos ✓), COMPLETED DATE, PRINT (on-invoice tick) [29][44].
  Opening a repair shows it inline: name + qty, **Problem Photos "Complete 4 / 4"**,
  **Resolution Photos "Photo Required 0 / 4"**, "Return to List" [30]. Repair fields (from the
  form behind it): Name*, Quantity, Description, Corrective Action, Work Completed, "Can water
  penetrate the roof here?", Completed, Take Resolution Photo. Repair ⋮: Remove from Ticket,
  Delete Service Repair.
- *Photos* are per repair, **before = Problem, after = Resolution**, shown as a 2-wide grid
  without captions [31]. The viewer shows the capture time ("9/22/26 12:01pm EDT"), a pencil
  (annotate/edit) and close; no author and no caption [32]. Other photos sit in the File
  Library.
- *Estimate* — TYPE / NAME / QTY / UNITS / COST / COST CODE / BUDGET TYPE / TOTAL / TAXABLE
  (empty on both tickets, as in [R-§4]).
- *Tasks & Meetings* — TASK, DUE, TIME, DESCRIPTION, COMPLETED, EMPLOYEE, WITH, ATTENDEES …
- *History & Notes* + "Add Note" — tabs **Timeline**, **Notifications**, List, **Activity**,
  "Show all activities" (§I) [33][34][35][36].
- *File Library* — grouped by record: this ticket (n Photos), the company (Upload File), the
  property (Warranties), then **every earlier ticket at the property** with its folders (Photos,
  Service Photos, Invoices, Signatures) [37]. Tabs Library / Resources / Sections; ⋮ Edit Tags,
  Delete Files, Download Selected, Show Archived.

**Materials tab** — "Add Materials from Estimate", "Add Material +", table MATERIAL / QUANTITY
/ UNIT [40]. **Purchase Orders tab** — "Add PO +" [41].

**Open vs invoiced.** Nothing visible becomes read-only once invoiced: 5431 (Invoiced) still
offers the pencil, Add Time, Include Repair, New Repair, Add Material and Add PO [44]. *Not
tested* whether a change after invoicing alters the invoice; the invoice lines look like a
snapshot (§H).

**Reopen.** 5484 was completed 9/22 by the technician, Authorized 10/1, then put back to New
Service the same minute after a "Still Leaking" note; the History shows the moves (§I). So a
callback is handled by moving the same ticket back, not by a new ticket.

## D. Tech Board

Route `#!/techBoard` (also List ▸ Board) [12][45].

- **Grid:** one row per technician, shown as initials in a circle (BK, DC, GP, MB, TF, TM —
  every employee, not only technicians); one column per day, Monday first, running **past
  Sunday into the next week** (about 9 days visible) [46]. Today's column header is an orange
  pill. Header icons: Change View (only "List"), **Previous**, **Current Week**, **Next**,
  **Select Technician** (dialog: per-employee Visible toggles, a Sub Contractors toggle,
  Cancel/Save) [50], **Service Type (for Queue)** (All Tickets or one type) [49], **Showing
  Active / Showing All**, New Ticket, ⋮ Refresh. No day view, no print or email of a day.
- **Card** [45][51]: header "✓ 5493 - ETA 9:00am", then the property name. Colour = stage
  (completed = dark green header / light green body; the queue's New Service cards are maroon
  over pink). Hover shows a tooltip — Description, Company, Property, Property Address — and
  highlights that card's day and technician [47][48]. Click expands the card in place: "5493 -
  ETA 9:00am - Completed on 09/30/26", Description, property, address, company, "ETA:
  09/30/2026 Morning (8-10am)", ticket link [51].
- **Queue ("Unavailable", bottom strip):** "20 Tickets", horizontal row of cards, newest stage
  date first; each card shows the stage date, property name and city/state/zip — **no ticket
  number**. It holds open tickets without a schedule even when a technician is set (5484 is
  there with Trace Floyd as technician). Filter: Service Type only. No search.
- **Drag and drop:** 23 cards carry `draggable`. *Not tested* — a drop would change a record.
  Inference: dropping sets technician and date (and likely stage Scheduled).
- **Multi-technician:** a ticket has one Technician; extra people are counted by "Number of
  Techs" at close-out, not assigned on the board. Two tickets at one property on one day show
  as two cards (5493, 5494).
- **Capacity / unavailability:** not shown. No hours per technician on the board this week
  (the earlier study saw weekly hours; not seen today).
- **"+" in a cell:** none.

## E. Service Map

List ▸ Map [52][53][54]. Google map of the filtered list (same filter/search bar). 66 of 85
tickets plotted as clusters (blue = mixed, red = clusters of assigned tickets) and single pins:
a **red pin** = a ticket with a technician, a **stage-icon square** = no technician (maroon
clipboard = New Service, green tick = Completed). A pin opens a popup: technician (if any),
ticket #, "New Service at 3/21/25 10:04am EDT" (stage + when), company, property, address.
**"Not Geocoded:"** lists ticket links under the map (5275, 5458, 8). No filters of its own.

## F. Workflow / close-out

Route `#!/serviceWorkflow/<id>` ("Open Ticket"). A **seven-step wizard** with an icon bar at the
bottom; each step gets a green tick when done [55]–[61].

| Step | Icon | Title and hint (as printed) | Fields / buttons |
|---|---|---|---|
| 1 | clock | — | jumps back to the ticket page (no screen of its own) |
| 2 | person | **Check In** — "Speak to a manager at the property and enter their name below. Enter any notes relevant to checking in." | Site Contact Name, Notes; "Repairs >" [56] |
| 3 | wrench | **Leak Repairs** — "Identify the source of the leak. Document the problem and resolution here." | table # / REPAIR / SECTION / PROBLEM (photos) / RESOLUTION (photos); "Add another Repair +", "Site Bid", "Review Service" [55] |
| 4 | document | **Site Bid** — "Please build your site bid here." | "Start Site Bid", "Back to Service", "Review Service" [57] |
| 5 | carousel | **Review Work Completed** — "Please review the following information with the Manager." | per repair: "<repair> - Before Photos" / "- After Photos" carousels; "Confirmation >" [58] |
| 6 | pen | **Capture Signature** — "Please capture signature from the Manager." | Site Contact Name (carried from Check In), full-width signature pad with clear (×); "Close Ticket >" [59] |
| 7 | thumbs-up | **Close Ticket** — "Please fill in the following information." | Closing Notes (multi-line); **Travel Time** and **Labor Time** shown as text, summed from the Timekeeping entries; **Number of Techs** with − / + stepper; MATERIALS table (MATERIAL / QUANTITY / UNIT) with "Add Materials from Estimate", "Add Material +"; PURCHASE ORDERS "Add PO +"; **Save & Return**, **Roof Inspection**, **Complete Service** [60][61] |

On the completed ticket 5431 the wizard opens straight on Close Ticket with all seven ticks
[61]; on 5484 it opens on Leak Repairs with steps 3–5 unticked (resolution photos missing).

*Not seen, on purpose:* the Material picker, the Add PO fields, the Roof Inspection screen and
what Complete Service validates — each is a button with no link behind it, and pressing it may
create a record. The material list itself is the account's Material Library (Settings, [67]);
the earlier study counted 142 items. Check-out name: the History entry has "Checked in with"
and "Checked out with" (§I), so a check-out name is captured somewhere in steps 6–7 (the
signature step's Site Contact Name, inferred).

**Technician vs office.** The same Workflow is reachable from the office login. Account
settings hide **material prices** from technicians (on) but not repair prices (off) [69].

## G. The technician's phone view

*Not seen.* The tech app (iOS/Android) is not reachable from this desktop login, and "Generate
Link" was not pressed. What the desktop implies: the technician's day is the List's
**Schedule** view ("Today's", stages Scheduled / En Route / In Progress) [13]; on a ticket they
press stage buttons (En Route, In Progress), then walk the seven Workflow steps — check in with
a site contact, a repair per leak with required problem and resolution photos, optional site
bid, review photos with the manager, signature, close-out with notes, number of techs and
materials, Complete Service. Time is entered as Travel / Labor rows with time in/out
(Timekeeping), apparently by the app (entries are stamped on the work day).

## H. Time, rates and the invoice hand-off

**Account settings ▸ Service** [68][69][70]:

| Setting | Value |
|---|---|
| Labor Rates | Emergency $135, Urgent $95, Standard $85 (+ Add Labor) |
| Labor Expense Rate | Technician $85, Helper $55 |
| Truck IDs | T001, T002 |
| Don't Round Service Materials | Yes · Don't Round Labor: No |
| Show Amount on Breakdown | Yes · Show Pre-Invoice Authorization: No |
| Payment Terms | "Payment is due upon receipt of invoice." |
| Material Markup | 75 (%) · Tax Percent 0 · Auto Tax Labor / Materials: off |
| Hide Material Price For Technicians? | Yes · Hide Repair Price: No · Force Tech Notes: No |
| Default Invoice Contact | RoAnna Sims · Invoice Copy Emails: blank |
| Default Line items for Service | none |
| Service Approvers | none ("These employees will receive Service Approval Notifications") |

**Time storage.** Timekeeping rows per person per day: Task = Travel or Labor, Time In, Time
Out, Hours (5431: 8 rows over 4 days, Travel 6.75 h, Labor 16 h) [44]. Rate class is on the
ticket (Labor Rate), not on the row; both tickets seen carry `$0.00 / hr`, i.e. no rate class.

**Invoice 5431, line by line** (invoice editor read, nothing changed):

| Line | Billable | Produced (cost) |
|---|---|---|
| Trace Floyd travel 7/14 | 1.25 h × **$55** | × $85 |
| Helper travel 7/14 | 1.25 h × **$45** | × $55 |
| Trace Floyd labor 7/14 | 4.75 h × **$85** | × $85 |
| Helper labor 7/14 | 4.75 h × **$55** | × $55 |
| Trace Floyd travel 7/29 | 1.5 h × **$45** | × $85 |
| Helper travel 7/29 | 1.5 h × **$35** | × $55 |
| Trace Floyd labor 7/29 | 2.5 h × $85 | × $85 |
| Helper labor 7/29 | 2.5 h × $55 | × $55 |
| 7 material lines | e.g. Quick Prime 0.25 Gal × $95.113 (cost $54.35 = ×1.75); Quick Seam Flashing 40 LF × $3.25 (cost $2.54 = ×1.28, overridden) | |
| Tax | 0 % of $0.00 | |

Amount Due $1,534.46, Produced $1,596.88, Margin −4.1 %, Margin/Hour −$3.12.

What this shows:
1. **Labor** bills at $85 (tech) and $55 (helper) — the Standard rate and the helper rate.
2. **Travel** bills at a lower, *varying* rate: $55 tech / $45 helper on one day, $45 / $35 on
   another. Neither is an account setting; the rate is set per line on the invoice (inferred).
3. **Helper lines**: one per tech line when Number of Techs = 2, same hours, helper rates.
4. **Cost** uses the Labor Expense Rate ($85 / $55) for travel and labor alike.
5. **Materials** default to cost × 1.75 (markup 75 %) and can be overridden per line.
6. **The invoice is a snapshot.** The ticket has 8 time rows (7/14, 7/29, 8/17, 8/19) but the
   invoice has only the 7/14 and 7/29 ones; time entered after the invoice was built did not
   flow in.
7. Labor Rate classes (Emergency/Urgent/Standard) are set on tickets but `$0.00` on both seen;
   the invoice used $85 regardless.

## I. History, notifications and who may do what

**History & Notes ▸ Timeline** [33]: typed notes with a title ("Still Leaking", "Service
Notes") and @mentions (the mentioned users get it in their bell ▸ Mentions); automatic
"**Service Completed**" entry from the technician — "Number of Technicians on the job: 2 /
Checked in with: Angel / Notes: / Checked out with: Angel / Notes: <closing notes>" + the
signature image; "**<ticket> created by <user>**". Stage moves are *not* on the Timeline.

**Notifications tab** [34]: every email sent, one row per recipient — "To: <name>
<address>", subject, time. On 5484: "New Service: 5484" ×5, "Service Accepted" ×2, "Service
Completed" ×4, "Service Authorized" ×4 — all to internal @flatroofonline.com addresses, none to
the customer, though the ticket's Notifications field is **On**. Recipients differ per stage
(5 for New Service, 2 for Accepted).

**Activity tab** [35][36]: a field-level audit — DATE, ACTIVITY (Created / Updated / Deleted),
RESOURCE, USER, "View Changes" → FIELD / OLD VALUE / NEW VALUE (e.g. "Stage Name Completed →
Authorized", "Last Stage Change …").

**Bell menu:** Mentions, Recent Activity, Company News, CP Updates, Queue. One mention there
reads "Invoiced via Sage @RoAnna Sims" — the first on-screen confirmation that invoices go to
Sage by hand.

**Roles** (Settings ▸ Employees, 7 users) [71]: Administrator (Brandon Keck, Garry Peters,
RoAnna Sims — "Office User"), Sales / Account Manager (Mark Barger — Office User), Service
Foreman (Tyler Mitchell — Field User), Service Technician (Donnie Carpenter, Trace Floyd — Field
User). Header counts: Office Users 4, Field Users 3. Each employee has Role, Employee Number,
Timezone, **Hourly Cost** (blank for Trace Floyd), Lists & Access, Notifications, Login
Credentials. *Not seen:* what each role may do — "Lists & Access" did not open outside edit
mode, and edit was not entered. Settings ▸ **Triggers** is a list of 48 webhook events
(company/invoice/opportunity/production …), none for service tickets [72].

## J. Reports that read tickets

Reports menu [62]: Battle Stats, Bid Report, Production Days, Service Agreements, Warranty
Report, Sales by Client, Service Sales Report, Production Budget, Change Orders, PO's, Service
Scoreboard, Materials Usage, Service Backlog, Inventoried Repairs, AR / Aging [Beta], Analytics.
**There is no technician report.**

| Report | Columns | Filters / range |
|---|---|---|
| Service Scoreboard [63] | DATE, DISPATCHED TODAY, TOTAL OPEN SERVICE, DISPATCHED OVER 45 DAYS, TOTAL COMPLETED, AVAILABLE TO INVOICE, INVOICED TODAY, TOTAL OPEN LEAK SERVICE | week (◀ ● ▶), "Week of Oct 5th 2026"; empty this week |
| Service Backlog [64] | summary by type: Type, Estimated Cost, Estimated Sales, Estimated Margin (Leak 81, Scope 2, Inspection 2, All 85: $56,756.70 / $53,860.43 / −5 %); rows: TICKET ID, TICKET TYPE, COMPANY ("Bill To …"), PROPERTY, CITY, ZIP CODE, STATE, SALES REP, TECHNICIAN, ESTIMATED START DATE, ETA, ACCEPTED DATE, STARTED DATE, ESTIMATED COST, ESTIMATED PRICE, SALES PRICE, ESTIMATED MARGIN ($), ESTIMATED MARGIN (%) | same filter dialog and Archived chip as the Service List |
| Inventoried Repairs [65] | COMPANY, CITY, STATE, ZIP CODE, ACCOUNT MANAGER, EMERGENCY, PROACTIVE, GRADE, TOTAL | none visible; still loading when read |
| Materials Usage [66] | TICKET, DATE ADDED, TECHNICIAN, TRUCK ID, MATERIAL, MATERIAL CODE, COST, QUANTITY, UNITS | week (◀ ● ▶); empty this week |

---

# Phase 2 — the portal side by side

Read from the code on `main` at 5476030 (file:line refs in brackets). Portal stages are
Open → Scheduled → Done → Invoiced → Closed [service.functions.ts:31-39]; ticket numbers start
at 6000 so they never collide with CenterPoint's.

| | CenterPoint | Portal |
|---|---|---|
| **A. List** | table, 21 of 48 columns, Stage Date sort, 50/page, filter dialog (type, 4 date ranges, manager, technician, hold, approval, archived, stages), no saved views, search = #/description/company/property (fuzzy), ⋮ CSV / archive / bulk stage | cards grouped by stage (Open, Scheduled, Done, Invoiced, Closed; collapsible), newest update first, no paging (cap 1000), type select + stage chips + "Mine" + Overdue; search = #, customer, site, address, description, PO, Job #, CenterPoint #s, technician (substring) [service-page.tsx:412-430]; no money on the cards; managers soft-delete with restore; no archive, no ticket CSV |
| **B. New ticket** | Property* (name search) → Bill To* (auto, any company), Sections, Site Contacts, Include Repairs, Service Type (7, default Leak), PO #, Labor Rate (+ editable $), Not to Exceed, Notifications (On/Internal/Off), Job #, Service Notes (@mentions), Attachment | Customer (name, site name or address search; one row per customer with "N sites") → Site (auto if only one), Site contact, Type (5, default Leak), **Date (required)**, Labor rate (Standard/Urgent/Emergency), Technician(s) + $/h + crew, Description, PO #, Job #, Notes, CenterPoint #s [ticket-form.ts; service-page.tsx:1933-1942]. No bill-to (chosen on the invoice), no NTE, no notifications option, no attachments. Managers only |
| **C. Ticket page** | info card with Technician + ETA window + Generate Link; company card with billing address / instructions; property card with technician instructions + **warranty badge**; Open Ticket; 9-stage strip (next two as buttons, Go Back, Choose Stage); Invoice View / Edit & Send; panels Service Documents, Timekeeping, Service Repairs (problem/resolution photos with required counts), Estimate, Tasks, History & Notes (Timeline / Notifications / Activity audit), File Library (incl. **every earlier ticket at the property**); ⋮ Archive, Hold, Delete, Approval. Nothing locks after invoicing | header with Close out, stage select, Repeat, Delete; stage strip with dates; customer contact log; Aerial markup, Inspection (type Inspection), Repairs (problem / work completed; before/after/other photos with markup), Materials (truck stock), Purchase orders (receipt + approval), Close-out summary, Time, Timeline, Invoice card. Technicians read-only on others' tickets and on Invoiced/Closed; office stays unlocked. **Date only, no ETA time.** No earlier-tickets list, no warranty flag |
| **D. Board** | ~9 days, rows = all employees, card "✓ 5493 - ETA 9:00am" + property, stage colour, hover tooltip, click expands; queue strip of 20 unscheduled (no ticket #, no search, type filter); drag-and-drop; no "+", no capacity | Mon–Sun week kept in the URL, rows = technicians A–Z + "Others", today tinted; Unassigned rail with **search**, oldest first; cards "#N Customer · description", stage colours; drag sets technician + date and Scheduled; "+" in every cell opens a pre-filled new ticket [board-page.tsx] |
| **E. Map** | Service Map of the filtered list, pins by assigned / unassigned + stage, popup, Not Geocoded list | none; Today cards link to Google Maps |
| **F. Close-out** | 7-step wizard: Check In → Leak Repairs (problem + resolution photos required) → Site Bid → Review with Manager → Signature → Close Ticket (notes, travel/labor read-only from timekeeping, Number of Techs stepper, materials, PO, Roof Inspection, Complete Service) | one page: Crew ("I'm alone" / named techs) → Inspection (type Inspection) + Aerial → Repairs (before/after camera per repair) → Materials (truck −/+) → POs → Closing notes, Checked in with, Checked out with, Recommend new roof → Time (editable entries) → Signature → **Complete, no validation** [closeout.tsx:441-459]. Autosaves; drafts kept on the phone |
| **G. Tech's day** | app (not seen); desktop "Today's" list of Scheduled / En Route / In Progress | `/service/today`: Today / Coming up / No date yet; one big button En route → On site → Done; En route→On site writes travel, On site→Done writes labor in quarter hours [service-field.functions.ts:242-276]; Undo; no offline |
| **H. Rates** | Labor 135/95/85; expense 85/55; travel billed $55 or $45 tech, $45 or $35 helper (varies per line); markup 75 %; tax 0; invoice is a snapshot | `service_rates` per kind × role × time: labor tech 85/95/135, helper 55; travel tech 55, helper 45 (40 on Urgent); cost 85/55; markup 0.75; tax 0; a draft invoice can be Rebuilt from the ticket [invoice-labor.ts; 20260927160000_invoices.sql:18-24] |
| **I. History / roles** | Timeline (notes with @mentions, "Service Completed" block, "created by"); Notifications (stage emails to 2–5 office users); Activity (field-level old/new audit); roles Administrator / Sales-Account Manager / Service Foreman / Service Technician | timeline: "Stage: X", En route / On site / Undid, photos, "Customer signed", crew, date moves, contact log, typed notes — no @mentions; ticket fields not in `audit_log`; notifications: assignment to the tech, "is done — invoice ready to review" to the office; roles admin / manager / user + technician flag, `managesTickets`, `seesInvoices` [access.ts] |
| **J. Reports** | Scoreboard, Backlog, Materials Usage, Inventoried Repairs (no technician report) | none; Owner view, Follow-ups, Invoices + Sage CSV, "To invoice" list |

## H — the portal's numbers checked against CenterPoint

| Item | CenterPoint (seen) | Portal | Verdict |
|---|---|---|---|
| Tech labor, Standard / Urgent / Emergency | $85 / $95 / $135 (settings) | 85 / 95 / 135 | ✔ |
| Helper labor | $55 | 55 | ✔ |
| Tech travel | $55 on 7/14, **$45** on 7/29 (5431) | 55 for every kind | ✔ for $55; **$45 only by editing the draft line** |
| Helper travel | $45 on 7/14, **$35** on 7/29 | 45 (40 on Urgent) | ✔ for $45; **$35 not in the portal**; the $40 Urgent value was never seen |
| Cost, tech / helper, travel and labor | $85 / $55 | 85 / 55 | ✔ |
| Helper lines | one per extra tech, same hours | one per helper (older tickets) or one per named crew member | ✔ |
| Material markup | 75 %, some lines overridden | 0.75, per-line edit in a draft | ✔ |
| Tax | 0 % | 0 %, tax-exempt override | ✔ |
| Payment terms | "Payment is due upon receipt of invoice." | same | ✔ |
| design doc §4 | — | says the tech line bills "at the ticket's labor rate kind … travel and labor alike" | ✘ the doc is wrong; code and CenterPoint bill travel at the travel rate |

---

# Gap list

## 1. Match it

| # | CenterPoint | Portal today | Proposal |
|---|---|---|---|
| M1 | Schedule has a **time**: ETA date + time + window ("8/24/26 9:00am Morning (8-10am)") on the ticket, board cards ("5493 - ETA 9:00am") and map popup [42][45] | date only; no ETA anywhere | optional **arrival window** on the ticket (e.g. Morning 8–10, Midday, Afternoon), shown on the board card, Today card and ticket. Migration: one nullable column |
| M2 | Every repair needs **problem and resolution photos**; steps get ticks; "Photo Required 0 / 4" [30][55] | Complete has **no checks** [closeout.tsx:441-459] | on Complete, list what is missing (a repair without an After photo, no signature, no closing notes) with "Complete anyway" — a warning, not a wall |
| M3 | **@mentions** in notes notify the named user (bell ▸ Mentions); used on callbacks ("Still Leaking … @Brandon Keck @Garry Peters") [33] | notes have no mentions | typing `@` in a ticket note offers office users; a mention sends `notify()` with the note and a link |
| M4 | File Library on a ticket shows **every earlier ticket at the property** with its photos [37] — what the office checks on a callback | nothing about earlier visits on the ticket | "Earlier at this site": the last 10 tickets at the same site (#, date, stage, type, first line of closing notes), each a link |
| M5 | Property card shows the **warranty** (badge "DURO-LAST 15 NDL" + watermark) [23] | warranty only as a service type | needs warranty data per site first (Q3); then a badge on the ticket and Today card |
| M6 | Activity tab: field-level **audit** of ticket changes (old → new, who, when) [35][36] | `audit_log` covers invoices and CRM, not `service_jobs` | add `service_jobs` (and time entries) to the existing audit trigger; "Changes" under the Timeline for managers. Migration |
| M7 | List filters by **technician** and by dates [4] | type, stage, Mine, Overdue | a Technician select in the list filters (no date ranges — the stage groups already sort by date) |
| M8 | design doc §4 vs what is billed (table above) | doc says travel bills at 135/95/85 | correct `service-module-design.md` §4 to the travel rates actually used |

## 2. Portal is better — keep

| # | CenterPoint | Portal | Why keep |
|---|---|---|---|
| P1 | 9 stages, each pressed by hand; dates out of order (En Route before Scheduled on 5431) | 5 stages; Scheduled / Invoiced / Closed set automatically | fewer clicks and dates that mean something; "Authorized" maps to the "To invoice" list (Q6) |
| P2 | search misses city, Job #, technician; the fuzzy match hits the wrong town | substring over 11 fields incl. Job #, PO, address, technician | finds what the office types |
| P3 | property search by name only, a bare name per row | customer search by name, site name or address, with "N sites" | two buildings at one address are told apart |
| P4 | board queue: no ticket #, no search, newest first | Unassigned rail with #, search, oldest first; "+" in every cell | the oldest unscheduled ticket is the one to dispatch |
| P5 | Number of Techs stepper; helpers anonymous | crew named per ticket, each with a rate | invoice lines carry real names |
| P6 | 7-step wizard (Check In, Site Bid, Review are separate screens) | one close-out page, same content, autosave, drafts on the phone | one scroll on a roof instead of seven taps |
| P7 | callback = move the same ticket back to New Service (5484); the completed visit's stage history is overwritten | "Repeat" makes a new linked ticket | each visit keeps its own time, photos and invoice |
| P8 | invoice is a snapshot; later time silently missing (5431) | a draft invoice can be Rebuilt from the ticket | nothing slips off the bill |
| P9 | nothing locks after invoicing | technician locked out after Invoiced; office can still fix | protects a sent invoice from field edits |
| P10 | Labor Rate shows `$0.00 / hr` on real tickets | rate kind + per-person $ that reaches the invoice | the rate is actually used |
| P11 | archive (3,677 rows) to clear the list | Closed group folds away; soft delete with restore | same result, no extra step |
| P12 | bill-to fixed at intake (any company) | bill-to chosen on the invoice (customer or vendor), "Another invoice" | one less intake field; split billing works (Q7 to confirm) |

## 3. Skip

| # | CenterPoint | Why skip |
|---|---|---|
| S1 | stage emails to 2–5 office users on every stage [34] | design §9: the only outbound email is the invoice; the portal notifies on assignment and on Done |
| S2 | Notifications On / Internal / Off per ticket | no customer email seen even with "On" (5484) |
| S3 | Service Map [52] | used "sometimes" (report §1); the Today card opens Google Maps |
| S4 | Scoreboard, Backlog, Materials Usage, Inventoried Repairs [63]–[66] | §9: "each is a saved filter or a one-query page later"; two were empty this week |
| S5 | Service Documents [26] | empty on both tickets |
| S6 | Estimate panel, Site Bid step, Include Repairs at intake [20][57] | §9 decision 8: the Estimator is the bid tool; inspection → "Create repair ticket" covers found repairs |
| S7 | Hold, Require Approval / Mark as Approved | no ticket seen on hold; PO approval covers the money check |
| S8 | Tasks & Meetings on the ticket | §9: one item a month |
| S9 | editable Status Dates per stage [39] | the portal stamps stage dates itself |
| S10 | Generate Link | not pressed; purpose unseen |
| S11 | tech app offline mode | §9 / rule 13 |

## Open questions

For the owner:
1. **M1** — which arrival windows do you promise customers? Is a short list (Morning 8–10, Midday, Afternoon) enough, or a clock time?
2. **M2** — should Complete *warn* about a missing After photo / signature, or *refuse* until they are there?
3. **M5** — keep warranties (manufacturer, NDL #, years) per site in the portal so tickets can flag them? CenterPoint holds 47.
4. **M3** — should an @mention also email, or only show in the portal inbox?

For RoAnna Sims:
5. **Travel rates** — 5431 billed tech travel at $55 one day and $45 another, helper $45 and $35. What decides it?
6. **Authorized** — what do you check between Completed and Authorized, and is the portal's "To invoice" list (tickets at Done) the same queue?
7. **Bill To** — how often does a ticket bill someone other than the property's owner? Is choosing it on the invoice early enough?
8. **Not to Exceed** — do any customers give an NTE amount?
9. **Urgent helper travel** — the portal bills $40; CenterPoint showed $45 and $35, never $40. Which is right?

## Not seen

- The technician app and its phone layout (G); "Generate Link" not pressed.
- What **Complete Service** validates, the **Roof Inspection** screen, the **Add Material** picker and the **Add PO** fields — buttons with no link; pressing may create records.
- Drag-and-drop on the Tech Board — a drop changes a ticket.
- Role permissions — "Lists & Access" on an employee did not open outside edit mode.
- Whether editing an invoiced ticket changes its invoice.
- A real case of two properties at one address.
- Weekly hours per technician on the board (seen in the earlier study, absent today).
