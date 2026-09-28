# Service module — replacing CenterPoint inside Bid-O-Matic

Written 2026-09-26 from the CenterPoint exploration (`docs/centerpoint/centerpoint-report.md`,
77 screenshots in `docs/centerpoint/screenshots/`, the Bell County daily log) and from what the
app already has. This is the plan the CenterPoint replacement (TODO item 0) is built from.
Nothing in it is built yet.

Owner's brief for it: _"keep in mind we are trying to replace this, but also how it will
interact with everything else we've built, and how to minimize clicks and maximize ease of
use."_

## 1. What has to survive the switch

CenterPoint is used every day for exactly one thing: **the repair ticket, from the phone call to
the emailed invoice**. Everything else is light or unused (report §1, §10). So the module is
built around the ticket and its three users:

| Who        | What they do today in CenterPoint                                                                                                           | Volume                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Office     | Creates the ticket (property, bill-to, type, PO, tech, ETA), dispatches on the Tech Board, reviews and sends the invoice                    | ~400 tickets/yr          |
| Tech       | Works the stage strip on the phone: En Route → In Progress → Completed; closes out with time, techs, repairs + photos, materials, signature | 5 techs, 1–3 tickets/day |
| Bookkeeper | Re-keys each invoice into Sage by hand (inferred, report §5); marks paid by archiving the ticket                                            | weekly                   |

Also kept because the data has real value: **companies (630), properties (1,139), contacts
(720)**, the **repair template catalog (475)** and **material catalog (142)** that drive
close-out and invoice text, the **rate rules** (§4 below), ticket history since 2024 with photos
and signatures, and the 47 warranties.

Deliberately not rebuilt (see §9): Projects and the daily work-day log, Opportunities and site
bids, Tasks/Calendar, Sub Contractors / Vendors, most Reports, Service Agreements, the
Production Board.

## 2. How it sits on what we already have

The rule: one record per real-world thing, and the service module links to it instead of
copying it.

| CenterPoint object           | Bid-O-Matic home                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Property (site)              | `crm_sites` (owner, Sep 26: the CRM keeps its own site records; prospecting's `buildings` are NOT the CRM). A site has address, technician instructions, notes, and shows the aerial clip for its address looked up from the prospecting data when one exists. No link back to prospecting is needed; "Import into CRM" only prefills the account form. |
| Company (bill-to)            | `crm_accounts` — the customer profile: a company / group **or an individual** (owner, Sep 26), billing address, billing instructions, `external_id` (the 6-digit id, likely the Sage customer number — report §11 q2), account manager, `centerpoint_company_id`. Bids, takeoffs (through their bid), tickets and opportunities all hang off it (§11).  |
| Contact                      | `crm_contacts` (name, email, mobile, office phone, position, `is_billing`) + `crm_contact_links` (contact ↔ account or site) so a contact can sit on the account and on specific sites.                                                                                                                                                                 |
| Technician                   | `profiles` (existing users). A `technician` flag / access page `service` decides who appears on the board.                                                                                                                                                                                                                                              |
| Truck                        | `inventory_locations` of kind `vehicle` (already) + `vehicle_drivers` (TODO 3c) so "my truck" is known from the login.                                                                                                                                                                                                                                  |
| Material catalog (142 items) | `pricing_catalog` rows already carry cost for most of them (membrane, term bar, screws, caulk). Items with no catalog cell (Splice Wash, Cleaning Supplies, Quick Prime) go in a small `service_materials` catalog with unit + cost. A ticket's material line references one or the other.                                                              |
| Material used on a ticket    | `inventory_movements` with `reason = 'consumed'` and a new `service_job_id` (the "A job" picker lists bids **and** service jobs). The vehicle write-off tick box goes away: material off a truck is always against a job.                                                                                                                               |
| Repair template (475)        | New `repair_templates`: name ("Drainage — Clogged Scupper/Drain"), category, unit (EA/LF/SF), description text, work-completed text, unit price for quoting, favourite flag, usage count. Imported from CenterPoint once.                                                                                                                               |
| Ticket                       | New `service_jobs` (§3). Invoice number = ticket number, as today.                                                                                                                                                                                                                                                                                      |
| Invoice                      | New `invoices` + `invoice_lines`, generated from the ticket (§5).                                                                                                                                                                                                                                                                                       |
| Opportunity / site bid       | A **bid** in the Estimator (already the sales tool). Repair quoting from templates is a later, optional "quick repair quote" on a service job, not a second estimator.                                                                                                                                                                                  |
| Warranty                     | `roofs.warranty_type / warranty_expires` (already). The 47 records import onto their roofs.                                                                                                                                                                                                                                                             |
| Project (re-roof)            | The won bid. A later "job log" on a won bid (daily sqft, photos, note — exactly the Bell County log) is a small add-on, not part of this module.                                                                                                                                                                                                        |

Ties to the other modules that fall out for free once the links exist:

- **Building page** shows tickets, roofs, bids, takeoffs and the warranty for that site in one place
  (today those live in four products).
- **Prospecting** already knows our own-book roofs; a ticket on an own-book roof under warranty
  shows the warranty on the tech's screen.
- **Inventory** on-hand per vehicle becomes true once every truck take-off is against a job.
- **Estimator**: "Recommend a new roof" on a close-out (Trace's note on 5431 recommends one)
  creates a task / a draft bid seeded from the building's roof sections.

## 3. Data model

All new tables under RLS on `has_access('service')` (new access page `service`), soft delete
like takeoffs.

```
service_jobs
  id uuid, number integer (sequence, continues after CenterPoint's last ticket number so
    invoice # = ticket # keeps working), building_id, company_id (bill-to), contact_id (site),
  description, service_type (leak|scope|warranty|inspection|other), po_number, job_code,
  labor_rate_kind (emergency|urgent|standard|not_to_exceed), not_to_exceed numeric,
  technician_id, helper_count integer default 0, vehicle_location_id,
  eta_date, eta_slot (morning|afternoon|time), stage (new|accepted|scheduled|en_route|
    in_progress|completed|authorized|invoiced|closed|cancelled),
  closing_notes, checked_in_with, checked_out_with, signature_path, signed_at,
  centerpoint_ticket_id, invoice_id, created_by, created_at, updated_at, deleted_at

service_job_events      -- the stage strip and the history/notes timeline, one row per change
  id, service_job_id, kind (stage|note|email|photo|edit), stage, note, by_user, at, meta jsonb

service_time_entries    -- what the invoice's travel/labor lines come from
  id, service_job_id, technician_id, kind (travel|labor), started_at, ended_at,
  hours numeric (editable; default from timestamps), helper_count, source (buttons|manual)

service_job_repairs
  id, service_job_id, repair_template_id, roof_id (section, optional), quantity, unit,
  problem_text, resolution_text, completed_on, print_on_invoice bool

service_job_photos
  id, service_job_id, repair_id (optional), role (before|after|other), storage_path,
  taken_at, lat, lng, by_user

invoices
  id, service_job_id, number (= service_jobs.number), invoice_date, due_date, status
    (draft|final|sent|paid|void), bill_to snapshot jsonb, property snapshot jsonb,
  description, payment_terms, subtotal, tax_rate, tax_amount, total, cost_total,
  sent_at, sent_to jsonb, paid_amount, paid_on, sage_exported_at, pdf_path

invoice_lines
  id, invoice_id, sort, kind (travel|labor|material|other), description, qty, unit,
  rate, total, cost_rate, cost_total, on_date, source_id (time entry / movement id)

service_rates           -- editable in Estimate Pricing, replaces CenterPoint's account settings
  key text pk, value numeric  -- tech_emergency 135, tech_urgent 95, tech_standard 85,
                              -- helper_travel_std 45, helper_travel_urgent 40 (confirm, §8 q6),
                              -- helper_labor 55, material_markup 0.75, tax_rate 0

companies, contacts, contact_links, repair_templates, service_materials, vehicle_drivers — §2
```

Storage: bucket `service` (photos, signatures, invoice PDFs), path `<job id>/…`, same policy
pattern as `takeoffs`.

## 4. Rules copied from CenterPoint (so invoices match to the cent)

From report §5 and the 5431 / 5449 invoices:

- Every time entry becomes one invoice line per person: the tech line at the ticket's labor rate
  kind (Emergency $135 / Urgent $95 / Standard $85 per hour, travel and labor alike), and one
  **Helper** line per extra tech (travel $40–45/h, labor $55/h). Cost side: tech $85/h, helper
  $55/h.
- Every material used becomes a line at **cost × (1 + markup)**, markup 0.75 today. Cost comes
  from the catalog cell or `service_materials`.
- Tax is a rate on the subtotal, 0 % today; `companies.tax_exempt` overrides.
- Invoice number = ticket number; invoice date = the day it is finalised; terms "Payment is due
  upon receipt of invoice."
- The PDF: page 1 (logo, Send To, Property, PO, Job #, one-line description "See Page 2",
  Grand Total, terms, narrative) then one **Work Completed** page per printed repair (template
  name, completed date, quantity, aerial clip of the building with the pin, Before/After photos,
  Description / Work Completed text, "Check In/Out With", signature).

These live in `service_rates` and `repair_templates`, not in code, so the office can change
them.

## 5. The screens, designed for the fewest clicks

Click counts below are for the common case; CenterPoint's count is from the screenshots.

### 5.1 Office — new ticket (CenterPoint: 2 screens, 8 fields, ~14 clicks + "Open Ticket")

One form, one save, everything defaulted from the property:

1. **Property** — one search box over buildings _and_ companies _and_ contacts (type "yellow
   creek", pick). Picking fills bill-to (building's company), site contact (the building's or
   company's first contact), technician instructions, and shows the roof sections, warranty and
   last three tickets in the right-hand card so the office does not open anything else.
2. **Description** and **Type** (Leak preselected).
3. **PO #** — shown with the company's billing instruction inline ("Need a PO on invoice / call
   BOE") so the office asks on the phone.
4. **Tech + ETA** — one control: a week strip of the five techs with their load, click a cell
   (= tech + day), slot defaults Morning. Skipping it leaves the ticket unassigned on the board.
5. **Save** — stage `scheduled` if a tech/day was picked, else `new`. No separate "Open Ticket"
   step; nothing to accept.

~5 clicks plus typing. Quick-add of a missing property/company/contact is inline in the search
box (name + address), not a separate Quick Add form.

### 5.2 Office — dispatch (Tech Board)

Same week grid as CenterPoint's board (techs × days) because it works: drag an unassigned ticket
onto a cell, drag between cells to reschedule, click to open. Colour = stage. The left rail is
unassigned tickets sorted by age. The board is the Service page's default view; the list view
(search, stage and tech filters, collapsible groups like Bids/Takeoffs) is one tab away.

### 5.3 Tech — the phone flow (CenterPoint: stage strip + multi-panel workflow)

Route `/service/today`, phone-first, the tech's own tickets for today at the top:

1. **My day** — cards with property, description, instructions, a map link. One big button per
   card shows the _next_ stage only: **En route** → **On site** → **Done**. Each press stamps a
   `service_job_events` row and, in the background, the time entries: En route→On site = travel,
   On site→Done = labor, split by the helper count set on the ticket. No timers to start, no
   timekeeping tab.
2. **Done** opens close-out on one scrolling screen:
   - Number of techs (prefilled from the ticket, ± buttons).
   - **Repairs** — a chip list of the tech's favourites and the templates used before on this
     building, then search over all 475. Tap a chip → quantity (default 1) → camera: Before,
     After (each a single tap; GPS from the phone). Problem/resolution text prefilled from the
     template and editable.
   - **Materials** — "From my truck" list first (the on-hand rows of the tech's vehicle from
     `vehicle_drivers`), tap → quantity. Each saved line is an `inventory_movements` `consumed`
     row against this job at that vehicle, so Inventory stays right with no extra screen.
     "Add from estimate" is not needed (only 21 estimate lines exist account-wide).
   - Closing notes (voice-to-text works in the browser keyboard), checked in/out with,
     recommend-new-roof tick.
   - **Signature** pad, then **Complete**.
     Time entries appear at the bottom as editable hours so a tech can fix a forgotten button
     press before completing.
3. Offline: close-out is written to local storage first and synced when the phone has signal
   (photos queued). This is the one hard piece of the tech flow; it ships in phase B as a PWA
   with a "waiting to sync" badge rather than a native app.

### 5.4 Office — invoice (CenterPoint: ticket → Invoice → Edit & Send → Send)

When a ticket reaches `completed`, the invoice is generated as a draft automatically (lines per
§4). The Service list shows a **To invoice** filter. Opening the ticket shows the invoice block
with the lines editable in place (qty, rate, description) and the narrative. Two buttons:
**Finalise & send** (emails the PDF to the billing contacts, stamps `sent_at`, stage
`invoiced`) and **Finalise only**. Margin and margin/hour show as today.

### 5.5 Bookkeeper — Sage hand-off

No live Sage integration in the first cut (TODO 0 says an export the bookkeeper imports is
enough). **Export to Sage** on the Invoices list writes a CSV for a date range with one row per
invoice (invoice #, date, customer external id, bill-to name, total, tax, description) and one
per line, and stamps `sage_exported_at`. Which Sage decides the CSV layout (report §11 q1); Sage
50 and Sage 100 Contractor both import CSV/text. **Mark paid** (date, amount, check #) on the
invoice replaces archiving. Payment import CSV can come later if Sage can export payments.

### 5.6 Customers

Companies, Properties (= buildings with a company) and Contacts as three tabs of a **Customers**
page, each a list with search and a detail pane: company → its properties, contacts, tickets,
invoices, warranties; property → the building page (roofs, tickets, bids, takeoffs, photos).

### Click comparison

| Task                          | CenterPoint (screens / clicks) | Here                     |
| ----------------------------- | ------------------------------ | ------------------------ |
| New ticket, assigned          | 2 / ~14 (+ Quick Add if new)   | 1 / ~5                   |
| Tech: start travel → on site  | stage strip, 2 taps + confirms | 2 taps                   |
| Tech: close-out with 1 repair | workflow with 7 panels, ~25    | 1 screen, ~10            |
| Invoice reviewed and sent     | 3 screens, ~8                  | 1 block on the ticket, 2 |
| Material off the truck        | not recorded                   | in close-out, 2 taps     |
| Record the payment            | archive the ticket             | Mark paid, 1 dialog      |

## 6. Phases (each stands alone; matches TODO 0's four steps)

**A — Service jobs + inventory tie (½–1 day).** `service_jobs` (minimal columns: building,
company text, date, tech, vehicle, type, notes, CenterPoint ticket + invoice numbers, stage),
Service page with list + one-screen form, the Inventory "A job" picker listing service jobs,
`consumed` movements carrying `service_job_id`, vehicle write-off tick box removed, TODO 3c
drivers. CenterPoint still runs everything else. Ship first: it fixes the inventory hole today.

**B — Customers, dispatch, tech phone (3–4 days).** Companies / contacts / repair templates /
material catalog imported from CenterPoint's CSVs (or its API, report §9), Tech Board, the
phone flow with time capture, repairs, photos, materials, signature, offline queue. Techs
create and close tickets here; the office copies totals into CenterPoint to invoice, or — since
the invoice is only lines from time and materials — skips CenterPoint for new tickets and
invoices from a printed close-out for a week to compare.

**C — Invoicing here + Sage export (2 days).** Invoice generation, PDF (page 1 + Work Completed
pages), email send with a stored copy, Mark paid, Sage CSV. From this day new tickets never
touch CenterPoint.

**D — History and cut-over (2–3 days, depends on §9 answers).** Import tickets since 2024 with
their invoices, photos and signatures (CSV + file download, or API), warranties onto roofs,
companies' external ids; run both a month; cancel.

Estimator rules to keep: number boxes start blank; nothing here touches bidding code; push to
main; never rewrite history.

## 7. Where the existing UI patterns are reused

- List page = Bids/Takeoffs page (search, filters, collapsible groups, recently deleted).
- Header status control = the takeoff status select.
- Building search = the prospecting map search over `buildings`.
- Inventory movement dialog = the existing Take from / Put in inventory pop-up, with the job
  picker widened.
- Access = `has_access('service')`, new PAGES entry. Sidebar (owner, Sep 28): one
  **Customers** group under Estimate — Today (technicians only), Customers, Service (Board
  above the tickets, Invoices as a tab), Opportunities, Follow-ups.

## 8. Decisions needed from the owner before phase B/C

Trimmed from report §11 to what changes the build:

1. **Which Sage** (50 / 100 Contractor / Intacct)? Decides the export file layout and whether a
   direct push is possible.
2. **Is the 6-digit External Identifier the Sage customer number?** If yes it is the join key for
   the export and the migration.
3. **Helper rates and tech count**: are $40/$45 travel and $55 labor fixed, and is "Number of
   Techs" ever more than 2?
4. **Ticket types** to keep: Leak / Scope / Warranty / Inspection only, or also Non-Billable,
   Rooftop Maintenance, Snow Removal, and the "Not to Exceed" rate?
5. **Phone habits**: do techs use the CenterPoint app for everything on site, and is anything
   printed or handed to the customer? Decides how much of the phone flow must work offline day
   one.
6. **History depth**: everything, or tickets since 2024 with photos, signatures and invoice PDFs?
7. **API access**: can someone reach CenterPoint's Settings/Integrations (the "tyk" integration
   turned on 9/14/26)? An API export is cleaner than per-list CSVs plus file downloads.
8. **Repair quoting**: keep site bids from templates (as a quick quote on a ticket), or quote
   repairs as Estimator bids?

## 9. Not built, and why

- **Projects / daily work-day log / production board** — used only on the Bell County re-roofs
  for section inventory and the daily note. The daily note is worth a small "job log" on a won
  bid later (date, sqft, before/after photos, note, "send progress report"); the rest is the
  estimator's job.
- **Opportunities / site bids** — 86 lifetime, 29 never left "New"; the Estimator is the sales
  tool. Decision 8 above.
- **Tasks & Meetings / Calendar** — 1 item in the current month; prospecting's tasks-lite covers
  it.
- **Reports** — only Service Scoreboard, Backlog, Material Usage, Sales by Client and the
  Warranty list carry data; each is a saved filter or a one-query page later.
- **Sub Contractors / Vendors / Service Agreements** — 2 vendors, 1 agreement.
- **Notifications by email per stage** — CenterPoint sends stage emails; here the only outbound
  email is the invoice (and, if wanted later, "tech en route"). Texting stays outside.

## 10. Owner additions, Sep 26 — the app is the CRM hub (recorded, not yet designed)

Stated by the owner after reading §1–9; the design above is to be revised once the questions
under "To confirm" are answered. Nothing here is built.

- **Customer profiles are the hub.** Bids and/or takeoffs link to a customer profile; repairs
  (later) and repair tickets link there too, and new opportunities (potential new customers) are
  customer profiles as well.
- **Assignment + follow-up timer.** A repair, a repair ticket or an opportunity is assigned to a
  user. Assigning starts a follow-up timer with reminders that keep firing until the user logs it
  closed (or another status). The reminder lengths are set in admin. Opportunities also carry an
  expected time frame.
- **Typeahead both ways.** Starting a bid and typing the job name shows matching CRM names in a
  dropdown; picking one links the bid to that profile. From a customer profile, an existing job
  (bid) can be associated the same way.
- **Prospecting is NOT the CRM.** `buildings` / the map / locations stay separate; the only tie is
  an optional "import this prospect into the CRM" that creates a customer profile from it. (This
  supersedes the §2 mapping of properties onto `buildings`; the CRM keeps its own customer +
  site records, with an optional `building_id` when one was imported.)
- **Vehicles and drivers.** Users are assigned to service vehicles. When such a user is assigned
  to a repair and reports the inventory they used, it is taken off their vehicle automatically,
  tied to that job, and every step is logged.

Answered the same day; the decisions are in §11 and the one open area (truck inventory truth) in §12.

## 11. CRM hub — decided design (owner's answers, Sep 26)

**Customer profile = account.** `crm_accounts` is one record per paying customer: a company /
group (Bell County BOE) **or** an individual. It holds contacts, one or more sites
(`crm_sites`, e.g. Yellow Creek Elementary) and the links: bids, tickets, opportunities. A site
shows the aerial picture for its address from the prospecting data when the address matches;
otherwise no picture. Prospecting is otherwise unrelated: "Import into CRM" on a prospect only
prefills a new account + site from the building's owner and address.

**Linking a bid (Setup › Customer name).** The Customer name field gets a typeahead over accounts
and their sites. Picking one links the bid (`bids.account_id`, `bids.site_id`) and fills
customer, contact, billing address and job-site address from the profile. Later hand edits stay
on the bid; a small "differs from profile" note offers a one-click push back to the profile.
From an account page, "Link a bid" searches the saved bids the same way (the reverse
direction). Takeoffs link through the bid they create, not directly.

**Opportunity = a potential new customer.** An `crm_opportunities` row on an account (the account
is created at the same time when new): assigned user, expected close = created + the admin
default "opportunities should close within N days" (editable per opportunity), status Open /
Contacted / Quoted / Won / Lost / No response. Won or Lost or No response stops the follow-ups.

**Assignment and follow-up timers.** One mechanism for opportunities and tickets
(`crm_followups`): assigning an item to a user starts a timer; reminders fire at the admin
lengths for that type (per type: first reminder after N days, then every M days) until the
item reaches a closing status. Ticket statuses: Open / Scheduled / Done / Invoiced / Closed
(Closed stops it). Reminders go by **email and text** to the assignee; on assignment the
assigner is told too; admins see every timer and overdue item on one screen. Text needs an SMS
provider account (Twilio or similar: a company number, per-message cost, and the provider's
credentials kept in Lovable Cloud secrets, never in the repo); email goes through the app's
existing mail path. A phone app is expected eventually; the first version is the web app
installed to the home screen (PWA) so the tech pages open full-screen and can queue work
offline — decide native later only if the PWA falls short.

**Admin settings (`crm_settings`)**: opportunity close-within days; reminder lengths per type
(opportunity, ticket); the reminder channels on/off per user; the vehicle ↔ driver table.

**Vehicles and drivers.** `vehicle_drivers` (vehicle location id, user id, from, to): up to two
users per vehicle and a user may be on two vehicles; admins change it and history is kept.
When an assigned tech reports material used on a ticket it is taken off that tech's vehicle
automatically (if the tech is on two vehicles, or two techs are on the ticket, each material line lets
the tech pick which truck it came off, defaulting to the last answer — owner, Sep 26), tied to the ticket, and logged as ordinary `consumed` movements with the user, time and
ticket. Everything is undoable through the existing movement undo.

**Technicians (owner, Sep 27).** A technician sees only the tickets assigned to them, plus
Inventory when granted. They can move a ticket to Done at most; Invoiced and Closed are the
office's (RLS and the server both enforce it). Ticket numbers start at 6000 so they never
collide with CenterPoint's while both run.

**Customer page.** Details open read-only with an Edit button. A new customer (from the
Customers page or the quick-add on a ticket) is offered any unlinked bids whose name looks
like the customer's, in a "Link these bids?" dialog; the same suggestions sit on the
customer page. Job Name on a bid also finds customers as you type, since some estimators put
the customer there.

**Sidebar**: one **Customers** group — Customers, Service, Opportunities, Follow-ups (owner,
Sep 28; Today first for technicians); the Bids page and the account page both show the link.

## 12. Truck inventory truth — to dive into (owner, Sep 26: techs often do not count accurately)

The problem: what a tech reports at close-out is usually incomplete, so the vehicle's on-hand
drifts and the job's material cost is understated. Any design has to accept that the close-out
number is an estimate and put the truth somewhere it can actually be measured.

Proposal (draft, for discussion): the close-out report is **provisional**; the **physical count
at restock** is the truth; the difference is **reconciled onto the jobs since the last count**.

1. Each vehicle has a **par list** (standard load: item, unit, par qty — TODO 3b). Restocking
   means counting what is on the truck (a phone checklist, one number per par item, opened
   packs allowed) and topping up to par from the shop; the count writes an `adjustment` per
   line and the top-up is the existing transfer.
2. Between two counts the app knows: on-hand at last count + transfers − reported usage. The
   count reveals the **variance** per item (what was used but not reported, or over-reported).
3. The variance is spread over the tickets the truck worked since the last count — by default
   proportionally to the hours on each ticket, with a screen that lets the office move it to a
   specific ticket (or to a "shrink / unknown" bucket for the vehicle when nothing fits). Each
   spread line is a `consumed` movement flagged `reconciled`, so ticket cost is reported +
   reconciled and the ledger shows both.
4. Invoicing bills only what was **reported** by default (the customer signed for that work);
   the office can pull a reconciled line onto the invoice before it is finalised.
5. Nudges to make reporting better without counting: the close-out's "From my truck" list shows
   the par items with big +/- steppers, remembers what this tech usually uses for each repair
   template ("last time on a clogged drain you used 1 tube of caulk, 2 LF tape") and prefills
   it, and a truck whose variance keeps growing shows a red badge to admins.
6. If counting a whole truck each restock is too much, count only the **fast movers** (caulk,
   tape, primer, screws, membrane roll) and leave slow items to a monthly count.

Owner's answers (Sep 26): trucks come back to the shop **every day** and the **tech restocks
at will** (no office step); whether a standard load exists on paper and how many items live on
a truck are unknown yet (owner will ask); the customer is charged for what was used plus
labor plus markup, so reconciled material is a job-cost and stock correction, not a billing
change unless the office decides so; screws can be counted **by weight in a bucket**; partial
tubes of caulk are the open problem; the bad counts come from **the people counting, forgetting
to add things to truck / job / shop, forgetting to log, and partial tubes**.

What that changes in the proposal: because the truck is at the shop nightly, the count can be a
short **end-of-day checklist on the phone** of only the fast movers (caulk, tape, primer,
screws by weight) rather than a full restock count, and restock-to-par becomes "top up what the
checklist says is low". Opened containers (owner, Sep 26): **an opened tube / pail counts as one used**. The job
that opens it is charged the whole one and it leaves the truck's stock then; nothing is
tracked for the partial remainder. Simple, and it matches what the customer signed for.
Forgetting to log is reduced by the close-out
asking "anything off the truck?" before Complete and by the per-template usual-usage prefill
(§12.5).

## 13. Phase B as built (Sep 27) and what the owner sets up

**Reminders: email + push** (owner, Sep 27; no SMS). Assigning a ticket or an opportunity
starts a follow-up timer (`crm_followups`); the dispatcher writes an inbox row per reminder and
sends it by email (Resend) and web push (VAPID keys generated once into `app_secrets`) per the
user's channel toggles on `/account`. Reminder lengths per type and the opportunity
close-within days are on Admin › Reminders. Admins see every timer on
`/followups`; others see their own.

**Owner setup, once:**

1. **Email**: create a Resend account, verify the sending domain (flatroofonline.com) and add
   in Lovable Cloud › Secrets: `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` (e.g.
   `Bid-O-Matic <notifications@flatroofonline.com>`), `APP_URL` (the app's public address,
   used for links in emails and push). Until then emails are recorded as failed on the
   Reminders settings page; in-app and push still work.
2. **Push**: each person opens `/account` on their phone and turns notifications on. iPhone
   needs the app added to the Home Screen first (Share → Add to Home Screen) and opened from
   there.
3. **Cron**: reminders also go out whenever an office user opens the app (throttled to every
   ten minutes). For reminders on a quiet day, set the GitHub repository secrets `APP_URL` and
   `CRON_SECRET` (the value of `LOVABLE_CRON_SECRET` in Lovable Cloud); the workflow
   `.github/workflows/reminders.yml` then calls `POST /api/cron/reminders` every 30 minutes
   in office hours.

**Tech phone flow (tables live, screens next):** `service_job_events` (timeline),
`service_time_entries` (travel / labor to the quarter hour from the En route → On site → Done
buttons, editable by hand), `repair_templates`, `service_job_repairs`, `service_job_photos`
(bucket `service`, before / after / signature), close-out fields on the ticket, contacts
(`crm_contacts`, `crm_site_contacts`) and the ticket's site contact. Server functions in
`src/lib/service-field.functions.ts`. An opened tube of caulk counts as one used (§12).

## 14. Phase C as built (Sep 27): invoicing here, Sage by CSV

- **Rates** (`service_rates`): per rate kind (Standard / Urgent / Emergency, chosen on the ticket)
  × role (tech / helper) × time (travel / labor), bill and cost. Seeded from the two CenterPoint
  invoices in the report; the office confirms them on Admin › Service Rates, with the
  material markup (0.75), tax rate (0) and payment terms (`service_settings`).
- **Invoice** (`invoices`, `invoice_lines`): one per ticket, number = ticket number. Created as a
  draft from the ticket's time entries (one line per person, a Helper line per extra tech) and
  materials (catalog cost × (1 + markup)); tax on taxable lines unless the customer is tax
  exempt. Editable while draft; Rebuild re-reads the ticket. Finalise stores the PDF in the
  `service` bucket and sets the ticket Invoiced; Send emails it (Resend, attachment) to the
  billing contacts; Mark paid records date / amount / method / reference and closes the ticket;
  Void returns the ticket to Done.
- **PDF** (`invoices.server.ts`, pdf-lib): page 1 as CenterPoint's (company block, Invoice #,
  PO, date, Job #, Send To, Property, lines, totals, terms, contact, narrative), then one Work
  Completed page per printed repair (name, completed date, quantity, description, work
  completed, before / after photos, check in / out with, signature).
- **Sage**: `Export to Sage` on the Invoices list writes a CSV for a date range (an INVOICE row
  and LINE rows per invoice, with the customer's external id) and stamps `sage_exported_at`.
  Reshape the columns once the Sage product is known (report §11 q1).
- Technicians never see invoices (RLS).

## 15. Untouched work (owner, Sep 28): seeing that people were contacted and jobs started

The problem: tickets and opportunities get assigned and then sit, and nothing showed whether the
customer was ever reached or the job ever started. Migration `20260928120000_untouched.sql`,
applied live.

- **Contact log** (`crm_contact_log`): one tap on a ticket or an opportunity — Called / Texted /
  Emailed / Visited, optional note. The trigger stamps the item's `contacted_at`, moves an Open
  opportunity to Contacted, and writes a `contact` event on the ticket timeline. Whoever may see
  the item may log on it (a technician on their own tickets).
- **Assignment date** (`assigned_at` on both tables) is stamped by trigger on every hand-over and
  cleared when unassigned; existing assignments were backfilled from their last change.
- **Started** = a ticket with a scheduled day, or en route / on site, or past Open; an
  opportunity past Open. **Untouched** = assigned and neither started nor contacted, defined
  once in `crm_untouched()` (SECURITY DEFINER with the item tables' read rules repeated, so a
  technician gets their own, the office everyone's, and the cron's service role all).
- **Limits** (`crm_settings.ticket_untouched_days` 2, `opportunity_untouched_days` 3, Admin ›
  Settings › Reminders): before the limit a row says "No contact · assigned 1d ago" (a quiet
  hint, nothing else); at the limit it turns red ("Untouched 4d") and only then appears in the
  Needs Action strip on Service, Opportunities and Follow-ups and counts in the admin By-person
  table (assigned / untouched / overdue). Owner, Sep 28: not on day one.
- **Escalation**: when the follow-up reminder of a red item fires, the same reminder pass also
  notifies `escalation_recipients()` — every admin when `escalate_to_admins` is on, plus
  `escalate_user_ids` — minus the assignee, on the follow-up's own cadence, until someone logs a
  contact or starts it (`dispatchDueReminders` in `notify.server.ts`).
