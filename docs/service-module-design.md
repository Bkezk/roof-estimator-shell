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

| CenterPoint object           | Bid-O-Matic home                                                                                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Property (site)              | `buildings` (already: address, parcel, footprint, own-book flag, `roofs` sections, won-bid link). Gains `company_id` (owner/bill-to default), `technician_instructions`, `centerpoint_property_id`. A CenterPoint property that is not in the parcel data is inserted with `source = 'import'`. |
| Company (bill-to)            | New `companies` table: name, billing address, billing instructions, `external_id` (the 6-digit id, likely the Sage customer number — report §11 q2), account manager, `centerpoint_company_id`.                                                                                                 |
| Contact                      | New `contacts` (name, email, mobile, office phone, position, `is_billing`) + `contact_links` (contact ↔ company or building) so a contact can sit on a company and on specific sites.                                                                                                           |
| Technician                   | `profiles` (existing users). A `technician` flag / access page `service` decides who appears on the board.                                                                                                                                                                                      |
| Truck                        | `inventory_locations` of kind `vehicle` (already) + `vehicle_drivers` (TODO 3c) so "my truck" is known from the login.                                                                                                                                                                          |
| Material catalog (142 items) | `pricing_catalog` rows already carry cost for most of them (membrane, term bar, screws, caulk). Items with no catalog cell (Splice Wash, Cleaning Supplies, Quick Prime) go in a small `service_materials` catalog with unit + cost. A ticket's material line references one or the other.      |
| Material used on a ticket    | `inventory_movements` with `reason = 'consumed'` and a new `service_job_id` (the "A job" picker lists bids **and** service jobs). The vehicle write-off tick box goes away: material off a truck is always against a job.                                                                       |
| Repair template (475)        | New `repair_templates`: name ("Drainage — Clogged Scupper/Drain"), category, unit (EA/LF/SF), description text, work-completed text, unit price for quoting, favourite flag, usage count. Imported from CenterPoint once.                                                                       |
| Ticket                       | New `service_jobs` (§3). Invoice number = ticket number, as today.                                                                                                                                                                                                                              |
| Invoice                      | New `invoices` + `invoice_lines`, generated from the ticket (§5).                                                                                                                                                                                                                               |
| Opportunity / site bid       | A **bid** in the Estimator (already the sales tool). Repair quoting from templates is a later, optional "quick repair quote" on a service job, not a second estimator.                                                                                                                          |
| Warranty                     | `roofs.warranty_type / warranty_expires` (already). The 47 records import onto their roofs.                                                                                                                                                                                                     |
| Project (re-roof)            | The won bid. A later "job log" on a won bid (daily sqft, photos, note — exactly the Bell County log) is a small add-on, not part of this module.                                                                                                                                                |

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
- Access = `has_access('service')`, new PAGES entry, sidebar group **Service** (Today,
  Board, Tickets, Invoices, Customers) under Estimate.

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
