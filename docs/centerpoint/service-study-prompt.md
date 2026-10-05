# Prompt: study the Service side of CenterPoint Connect, then edit JBK Portal to match

Copy everything below the line into a Claude Code session that has **both** of these at once:

1. this repository checked out (`Bkezk/roof-estimator-shell`, branch `main`), and
2. the owner's own Chrome, already signed in to CenterPoint Connect
   (app.centerpointconnect.com), connected to the session.

One session for both means nothing is lost between a report and the code: the same agent that
looks at a CenterPoint screen edits the matching portal screen. See "Running it" at the bottom
for the setup.

The earlier material is already in the repo and should be read first, not redone:
`docs/centerpoint/centerpoint-report.md` (§2 the Service area, §3 a repair's life, §4 rates),
the numbered screenshots in `docs/centerpoint/screenshots/`, and the plan the Service module
was built from, `docs/service-module-design.md`. The invoicing side has its own study,
`docs/centerpoint/invoicing-study-prompt.md`; this one is tickets, dispatch and the technician.

---

You are working for JBK, Inc. (Roofing Division). JBK runs its repair tickets in CenterPoint
Connect today and is replacing it with its own portal, this repository (TanStack Start, React,
Supabase through Lovable Cloud). Your job has three phases, in order: **look** at how the Service
side of CenterPoint works, **compare** it with the portal's Service side, then **change** the
portal where the owner says so. You will be looking at CenterPoint in a browser tab that is
already signed in. The owner is reading along and will answer questions.

## Ground rules

**In CenterPoint — read-only, always.**

1. Do not create, edit, send, archive, delete, import or export anything. Do not press Save,
   Send, Complete Service, Archive, Email, Download CSV, Add PO or any button that changes a
   record. To see a form, open it, read it and close it without saving. If a dialog asks to
   confirm anything, cancel.
2. No credentials. Never read, store or write down a password, API token, session cookie or
   login link. The tab is already signed in; that is all you need. If you are signed out, stop
   and tell the owner.
3. Customer data stays in CenterPoint. Describe screens and fields; quote a customer, address or
   amount only where it shows a format, one or two examples per point. Do not list customers,
   tickets or invoices in bulk, and do not copy the app's data calls or JSON into the repo.
4. Say what you saw, not what you assume. Mark anything you infer as an inference. When a screen
   will not open or needs a save first, write "not seen" and why.
5. Take a screenshot of every screen and dialog you describe, numbered in the order you took
   them, saved under `docs/centerpoint/screenshots/service/`, and refer to them by number.

**In the repository — the house rules.**

6. One commit per change, each with a plain-English message saying what changed and why
   (quote the owner where the change is theirs). Push to `main`; Lovable syncs from it. Never
   rewrite published history: no amend, rebase, squash or force-push of anything pushed.
7. Before every commit run and pass: `bunx prettier --check "src/**/*.{ts,tsx}"` (seven
   pre-existing warnings under `src/integrations/supabase/` are known), `bunx tsc --noEmit -p .`,
   `bunx eslint src` (eight pre-existing warnings are known; do not run `eslint .`),
   `bunx vitest run`, `bun run build`. Never run prettier on `docs/legacy-money-parity.md`.
8. Every fix or feature carries a test that fails on the previous code and passes after; say so
   in the commit message with the counts.
9. Do not touch `src/lib/engine/**` (the bid engine). Prospecting code (`src/components/prospect`,
   `src/lib/prospect*`) must not be mixed with service or bidding code.
10. Number boxes start blank, never showing a 0, not even a grey placeholder (`NumberField`,
    `src/lib/number-field-view.ts`). Errors are loud: a toast carrying the server's message.
11. Database changes go in a new file under `supabase/migrations/` (timestamped, replayable:
    `if not exists` / `drop … if exists` before `create`). Do not run SQL against the live
    database unless the owner has connected Lovable's database tool to this session; otherwise
    tell the owner exactly which migration file needs applying and how to verify it. Never
    delete or truncate a table. Never put a key, password or login in the repo, in an
    environment variable or in chat.
12. Roles are in `src/lib/access.ts`: `managesTickets` (admins and managers run tickets and their
    money), technicians (own tickets only, never a price), `seesInvoices` (adds sales / project
    managers). Keep those lines where they are; the database's row-level security mirrors them.
13. When CenterPoint does something the portal deliberately does not (see
    `docs/service-module-design.md` §9: projects, service agreements, most reports, the tech
    mobile app's offline mode), note it and move on. Do not rebuild it unless the owner asks.

## Phase 1 — look (CenterPoint, in this order)

### A. Service List (Service ▸ Service List, "TICKETS")

Every column, the default sort, every filter and saved view, the search (what fields it
matches), the footer, the ⋮ menu, bulk actions, and how an archived ticket looks. What the row
colours or icons mean. How many clicks from the list to a ticket, to its invoice, to its
property.

### B. New Ticket (Service List ▸ New Ticket)

Field by field: label as printed, type (text, date, dropdown and its options, search box,
toggle), default, required, and what fills in automatically from the property or company.
Property search (what it matches, what the result row shows, what happens with two properties
at one address), Bill To (how it differs from the property's company), Site Contacts, Service
Type list, Labor Rate list and the account rates, Notifications (On / Internal / Off: who gets
what), Job #, Purchase Order #, Service Notes, attachments. What the ticket number is and when
it is assigned. Everything the form refuses (open it, leave fields empty, read the messages,
then close without saving).

### C. The ticket page

Open two tickets: one open and assigned, one completed and invoiced. Describe every block in
order: the header and stage strip (the stage names, which are automatic and which are
buttons), the description, property / company / contact blocks and what in them is a link,
Technicians / ETA / Schedule, Purchase Orders, Materials, Repairs, Photos (before / after /
other, how they are grouped, captions, who took them, annotation), Time (travel / labor, per
technician, how Number of Techs changes it), Check-in / Check-out names, Closing Notes,
Signature, History & Notes (what is logged automatically, what is typed), Tasks & Meetings,
the Invoice block ("View", "Edit & Send"), Warranty, Documents. Every button on the page and
what it opens. What changes between the open and the invoiced ticket (what becomes read-only).

### D. Tech Board (Service ▸ Tech Board)

The grid (rows, columns, the week / day switch, today's marker), the "Unavailable" / unassigned
column (what qualifies, its sort, its search), what a ticket card shows and its colours, drag
and drop (what a drop changes: technician, date, ETA, stage), multi-technician tickets, how a
technician's day capacity or unavailability is shown, the "+" / new ticket from a cell, and
printing or emailing a day's schedule if offered.

### E. Service Map

What is plotted, the colours, the filters, what a pin opens, "Not Geocoded" handling.

### F. Workflow / close-out (`#!/serviceWorkflow/<id>`, "Open Ticket")

Open it on a completed ticket and a not-yet-completed one. Every field in order: Closing Notes,
Travel Time, Labor Time, Number of Techs, the Materials table (MATERIAL / QUANTITY / UNIT,
"Add Materials from Estimate", "Add Material" — what the material picker offers and where its
list comes from), Purchase Orders ("Add PO" — the fields), "Roof Inspection" (what it opens:
the inspection form, its items, whether they are a fixed list or per-account), "Complete
Service" (what it validates — try nothing; read the hints), signature capture, before / after
photo steps. What the technician sees that the office does not, and the reverse.

### G. The technician's phone view

If a mobile layout or the tech app's web version can be reached from this login, go through a
ticket as a technician would: the day's list, the stage buttons, photo capture, time, materials,
signature, complete. If it cannot be reached, say "not seen" and describe what the desktop
Workflow page implies instead.

### H. Time, rates and the invoice hand-off

How travel and labor hours are stored per technician and per rate class (Emergency / Urgent /
Standard / Not to Exceed), the account rates on screen (report §4 has $135 / $95 / $85), how
Number of Techs becomes Helper lines, and exactly what the invoice picks up from the close-out
(lines, text, photos). The portal already has this in `src/lib/invoice-labor.ts` and
`docs/service-module-design.md` §4; confirm or correct it, number by number.

### I. History, notifications and who may do what

What History & Notes logs by itself on a ticket (creation, stage moves, assignment, photos,
emails) and in what words. Which notifications a ticket sends (to the customer, to the
technician, internally) and when. From Settings or user screens that open for this login, which
roles may create, dispatch, complete, invoice and archive tickets, and who sees cost. If
Settings will not open, say so.

### J. Reports that read tickets

Service Backlog, Service Scoreboard, Technician reports, Inventoried Repairs: columns, filters
and date ranges only. Nothing is exported.

## Phase 2 — compare

Now read the portal's Service side and put the two next to each other. The files:

- Tickets list, ticket page and form: `src/components/service-page.tsx`,
  `src/lib/service.functions.ts`, `src/lib/ticket-form.ts`, `src/lib/ticket-stage.ts`,
  `src/lib/ticket-date.ts`, `src/lib/ticket-money.ts`, `src/lib/service-search.ts`
- The folding sections on a ticket: `src/components/service/ticket-field-sections.tsx`,
  `ticket-extras.tsx`, `aerial-markup.tsx`, `inspection-section.tsx`, `materials-section.tsx`,
  `purchase-orders-section.tsx`, `photo-markup.tsx`, `invoice-block.tsx`
- Tech Board: `src/components/service/board-page.tsx`, `src/lib/service-schedule.ts`,
  `src/lib/board-week.ts`; the tabs row `src/components/service/service-tabs.tsx`
- Technician's day and close-out: `src/components/service/today-page.tsx`, `closeout.tsx`,
  `crew-box.tsx`, `signature-pad.tsx`, `src/lib/service-field.functions.ts`,
  `src/lib/service-crew.ts`, `src/lib/field-day.ts`
- Inspection checklist: `src/lib/inspection.ts`, `src/lib/service-inspection.functions.ts`,
  `src/components/service/inspection-checklist-settings.tsx` (on the Setup page, `src/routes/setup.tsx`)
- Rates and the invoice hand-off: `src/components/service-rates-settings.tsx`,
  `src/lib/invoice-labor.ts`, `src/lib/invoices.server.ts`
- Roles: `src/lib/access.ts`; database: `supabase/migrations/` (service tables start at
  `20260927*`)

Write `docs/centerpoint/service-study.md` with sections A–J above (short prose and tables:
Field | Type | Default | Required | Source), screenshot numbers in brackets, and then a
**gap list**: one row per difference, with three columns — what CenterPoint does, what the
portal does, and your proposal — grouped as:

1. **Match it** — the portal is missing or does differently something the office or a technician
   uses every day.
2. **Portal is better** — keep the portal's way; say why in a sentence.
3. **Skip** — CenterPoint has it, nobody needs it (cite `service-module-design.md` §9 or what
   you saw in the list's usage).

Finish with **Open questions** for the owner and for RoAnna Sims (who dispatches and invoices),
each answerable in a sentence, and **Not seen**. Commit the study and the screenshots (one
commit, nothing else in it) and show the owner the gap list in chat.

**Stop here and wait.** The owner picks the rows to build.

## Phase 3 — change

For each row the owner picks, in the order they give:

- Say in one line what you are about to do, then do it: the change, its test (failing on the
  old code first — show that run), the full check chain, one commit, push.
- Match CenterPoint's words and field order where the owner asked for a match; keep the
  portal's existing parts and patterns (its number boxes, folding sections, stage rule, roles)
  rather than importing CenterPoint's look wholesale.
- Fewer clicks beats more features. If a CenterPoint step exists only because of how
  CenterPoint is built, say so and propose the shorter path before building it.
- Anything that changes the database gets a migration file and a note to the owner about
  applying it (rule 11). Anything that changes who may do what gets the owner's explicit yes
  first.
- After each commit, a two-line recap: what the owner will see, and what is next.

When the list is done, update `docs/service-module-design.md` with a dated section listing
what changed and why, and commit that too.

## Running it

The browser connection is Claude Code's "Claude in Chrome" integration
(https://code.claude.com/docs/en/chrome). It drives the owner's own Chrome profile, logged-in
tabs included, so no CenterPoint login is ever typed into the session or stored anywhere. It
works in the Claude Code CLI and the VS Code extension on the owner's computer; it does **not**
work in a claude.ai/code cloud session, which is why this is a separate, local session.

On the owner's computer (macOS, Windows or Linux; not WSL):

1. Install the "Claude in Chrome" extension (v1.0.36 or later) from the Chrome Web Store, in the
   Chrome profile that is signed in to CenterPoint. Chrome, Edge, Brave and Arc all work.
2. Clone the repo and install: `git clone https://github.com/Bkezk/roof-estimator-shell`,
   `cd roof-estimator-shell`, `bun install`. The same `bun` commands as in rule 7 run locally.
3. Install Claude Code (v2.1.211 or later) and sign in with `/login` on the Pro / Max / Team
   plan. An API key or long-lived token switches the Chrome integration off.
4. Open CenterPoint in Chrome and sign in yourself.
5. In the repo folder run `claude --chrome`. Run `/chrome` once; it should say Status: Enabled
   and Extension: Installed (choose "Enabled by default" to skip the flag next time).
6. Paste everything above the "Running it" heading, from "You are working for JBK" down, as the
   first message.

While it runs the browser actions happen in a visible Chrome window, in a tab group the
extension makes for the session. If the extension goes idle after a long pause, `/chrome` →
"Reconnect extension". The session pauses by itself at any login page or CAPTCHA for the owner
to handle. The Lovable database tool is not connected in a local session, so database changes
land as migration files for the owner to apply (rule 11).
