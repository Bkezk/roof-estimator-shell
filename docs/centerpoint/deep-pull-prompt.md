# Prompt: pull the rest of the customer and ticket history out of CenterPoint

Copy everything below the line into a Claude Code session that has **both** of these at once:

1. this repository checked out (`Bkezk/roof-estimator-shell`, branch `main`), and
2. Chrome connected (Claude in Chrome), with a tab already signed in to CenterPoint Connect
   (app.centerpointconnect.com) under the **separate login made for Claude**, never the
   owner's own.

Why a browser: CenterPoint's CSV exports carry only the list columns. The billing instructions,
billing addresses, property technician instructions, which contacts are billing contacts, and
everything on a ticket (time entries, repair lines, materials, closing notes, signatures,
invoice lines, photos) are only reachable through the app's own data calls, which the signed-in
tab can make. A cloud session cannot reach the owner's browser, so this runs on the owner's
computer.

What is already done (Oct 13): the Companies, Properties and Contacts exports are imported
(Admin › Import from CenterPoint; `src/lib/centerpoint-import.ts`). Every imported customer,
property and contact carries its CenterPoint id (`centerpoint_company_id`,
`centerpoint_property_id`, `centerpoint_contact_id`; folded twins keep the other id in
`centerpoint_alias_ids`). Everything below attaches to those ids: nothing is matched by name.

Read first: `docs/centerpoint/centerpoint-report.md` §9 (the data calls and resource counts),
§2–§4 (what a ticket holds), and `docs/service-module-design.md` (the portal's tables).

---

You are working for JBK, Inc. (Roofing Division). JBK is replacing CenterPoint Connect with its
own portal, this repository. Your job is an **extract**, in two passes, each ending in files the
owner looks at before anything is imported. You will read CenterPoint through a browser tab that
is already signed in. The owner is reading along.

## Ground rules

**In CenterPoint — read-only, always.** Do not create, edit, send, archive, delete, import or
export anything inside CenterPoint; press no button that changes a record. If a dialog asks to
confirm anything, cancel.

**No credentials.** Never read, store or write down a password, API token, session cookie or
login link. The tab is signed in; use it as it is. If it is signed out, stop and tell the owner.
Never type the CenterPoint login yourself.

**Pace it.** The app froze on Sep 24 when many requests ran at once. One request at a time,
a short pause between pages, and stop for a minute if anything answers slowly or with an
error. The office is using CenterPoint while you work.

**Customer data stays out of the repository.** Write the extract under `centerpoint-extract/`
at the repository root (git-ignored). Never commit it, never paste rows into chat beyond one
or two examples of a format, never put a row into a code comment or a test fixture.

**Nothing is written to the portal in this session** except code: the importer, with tests,
reviewed and run by the owner from Admin › Import from CenterPoint after a dry run, the way
the Oct 13 customer import went.

## Pass 1 — the fields the exports left out (small, do this first)

Through the data calls the app itself makes (JSON:API at `app.centerpointconnect.com/a/…`;
find the exact routes by watching the tab's requests when a company, a property and a contact
page open — do not guess them), read for every company, property and contact:

- company: `billingAddress`, `serviceBillingInstructions`, `taxLabelOverride`,
  `isHideProductPriceFromTechnicians`, and anything else on the record the Companies CSV did
  not carry; note which fields were actually filled on how many rows.
- property: technician instructions, billing instructions, billing address, management,
  "show to client", credit hold, and the roof sections list (name, squares) if it is on the
  record.
- contact: `isBilling`, position, and any field the Contacts CSV lacked.

Write `centerpoint-extract/pass1/companies.json`, `properties.json`, `contacts.json`: one
object per record keyed by its CenterPoint id, raw field names as the app returns them, plus
`centerpoint-extract/pass1/README.md` saying which route each came from, the counts, and which
fields were empty on every row (those are not worth importing). Then write the importer:
`src/lib/centerpoint-fill.ts` (pure: map pass-1 JSON onto the portal's columns —
`crm_accounts.billing_instructions`, the mailing address columns when the billing address
differs from the main one, `crm_sites.technician_instructions`, `crm_contacts.is_billing` —
matching by the stored CenterPoint ids and aliases; a field the portal has no column for is
listed in the report, not invented), a server function that only fills blanks and never
overwrites something the office has typed, a dry-run report, tests on synthetic fixtures, and
a second section on the existing Admin › Import from CenterPoint page that takes the three JSON
files. Same shape as `src/lib/centerpoint-import.ts`; read it first.

## Pass 2 — tickets and their history (large; agree the scope with the owner first)

Resources (counts from Sep 24): productions 3,844 (tickets 3,759, projects 4, opportunities 86) with stage transitions; invoices 3,591 with line items, description, signature URL and
email log; products = repair lines 2,273 with before/after photo URLs; materials used per
ticket; work_time_entries; purchase_orders 59; warranties 47; files 393,263 on Google Cloud
Storage.

Ask the owner, before starting: which years of tickets (2023 holds 2,715 imported rows from
the system before CenterPoint; 2024–2026 are the ones worked in CenterPoint), and whether
photos come at all and for which years (they are the bulk of the time and the storage).

Extract, one resource at a time, each to `centerpoint-extract/pass2/<resource>.json` keyed by
id with the raw fields: tickets (every field, the bill-to and property ids, technician,
stage transitions with dates), time entries, repair lines, materials used, purchase orders,
invoices with lines, warranties. Photos last, only in the agreed scope, to
`centerpoint-extract/pass2/files/<ticket id>/…`, with a manifest of what each file is (role:
problem / resolution / signature / receipt / other; the repair line it belongs to).

Then the mapping, agreed with the owner before coding: CenterPoint stages → the portal's
(New Service / Accepted → Open; Scheduled / En Route / In Progress → Scheduled; Completed →
Done; Authorized → Authorized; Invoiced → Invoiced; Closed → Closed), service types
(`CP_SERVICE_TYPE_MAP` in `src/lib/centerpoint-import.ts`: Non-Billable, Rooftop Maintenance
and Snow Removal → Other), labor rates (Not to Exceed → Standard, flagged), technicians by
name to portal users (Trace Floyd, Donnie Carpenter, Tyler Mitchell may not be users yet —
list them), ticket numbers kept as CenterPoint's (the portal's own start at 6000), invoice
numbers kept. Every imported ticket's stage dates go into its events so the stage strip and
the "Opened … by …" line read right; nothing re-fires a notice, a follow-up or a reminder
(the restore door's `restore_rows()` pattern of disabling user triggers for the batch is the
model, see `supabase/migrations/20261013100000_restore_door.sql`).

## What to report

At the end of each pass: what was read, the counts against the Sep 24 numbers, what was
empty everywhere, the open questions for the owner, and a dry-run report from the importer.
The owner runs the import.

## Running it

On the owner's computer: open the Claude desktop app, start a conversation in this
repository's folder, connect Chrome (Claude in Chrome) with CenterPoint signed in under
Claude's login, and paste this prompt from "You are working for JBK" onward. Pass 1 takes
about an hour; pass 2 is a separate sitting.
