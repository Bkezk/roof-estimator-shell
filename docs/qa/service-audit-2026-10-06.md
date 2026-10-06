# Service side QA audit — Oct 6, 2026

Read-only audit of the Service side at main `36482e6`, after the ~30 Service commits of Oct 5–6
(Authorized stage, arrival window, History fold, @mentions, warranties, Properties / named Sites,
repair library, material pricing and markup, ISO board sizes, stage colours, layout toggle) plus
the Tech Board / Setup / close-out changes. Nothing was changed; every finding carries proof.
Tests, SQL and throwaway reproductions were run on this commit.

## What passed

| Check | Result |
| --- | --- |
| `bunx tsc --noEmit -p .` | 0 errors |
| `bunx vitest run` | 202 files, 2,501 tests, all pass |
| `bunx eslint src` | 0 errors (8 pre-existing warnings) |
| `bunx prettier --check` | only the 7 pre-existing `src/integrations/supabase/*` warnings |
| 13 migrations 20261005120000 … 20261006180000 | every table, column, function, trigger, check and policy present in the live database |
| Live data | 0 tickets without `stage_changed_at`; 0 invoices without `material_markup`; 0 tickets whose site (`location_id`) belongs to another property; 475 active repairs; 137 service materials (4 × 4'x8', 4 × 4'x4' ISO) |
| Technician RLS (probed as John in a rolled-back transaction) | sees 0 rows of `service_materials`, `repair_templates`, `audit_log`, `site_warranties`; sees the price-free views (`service_materials_catalog` has no `cost` column, `repair_templates_catalog` no `unit_price`) |
| Stage trigger (probed as John) | `update service_jobs set stage='authorized'` → `42501 Only a manager authorizes, invoices or closes a ticket` |
| Stage trigger (probed as RoAnna, manager) | done → authorized succeeds; `set_ticket_stage_from_invoice(#6006,'authorized')` while a final invoice exists → refused "The ticket still has a live invoice, or is not Invoiced or Closed" |
| Notifications | `ticket_authorized` rows written to Brian and RoAnna for #6006 and #6007 (email unsent: RESEND key not set — owner side) |

## Confirmed bugs (ranked)

### 1. A price typed by hand on a ticket material line is lost — by a markup change and by Rebuild from ticket
Commits 285b17e / adcd7d4 promise "a price typed by hand stays". It does not, because the editor
moves the hidden cost with the typed rate, and the "was this rate typed by hand?" test compares
rate to cost × (1 + markup).

- `src/components/service/invoice-editor.tsx:545-549` — any rate edit runs `rescaleCost`.
- `src/lib/invoice-materials.ts:164-172` — cost becomes cost × newRate / rate, so rate ÷ cost is 1 + markup again.
- `src/lib/invoice-materials.ts:184-190` `rateFromMarkup` — ignores `rate_overridden`; returns true for every rescaled line.
- `src/lib/invoice-materials.ts:197-206` `applyMarkup` → re-prices the typed line.
- `src/lib/invoices.functions.ts:626-631` — saves `rate_overridden = false` for it, so `mergeRebuild` (`src/lib/invoice-rebuild.ts:250-256`) drops the typed price.

Reproduction with the real functions (`bun run` script):
```
Acetone: cost 10, billed 17.50 at 75 %.  Type 20 →  cost_rate 11.4286
rateFromMarkup(typed, 0.75) = true          ← treated as "not typed by hand"
markup 75 % → 50 %: rate 17.1429            ← typed 20 lost
control with cost left at 10: rateFromMarkup = false, rate stays 20
```
The existing `invoice-markup.test.ts:34` uses the un-rescaled shape, which is why it passes.
Fix direction: decide "typed by hand" from `rate_overridden` / the line's `orig`, not from the ratio.

### 2. ISO board invoice lines carry a nonsense pack note and unit text
`src/lib/invoice-materials.ts:126` appends "— {perPack} {pieces} per {pack}"; for a board
`servicePiece` gives perPack = 1/32 (`src/lib/service-materials.ts:160-164`). Reproduced:
```
64 sq ft of 1" ISO 4'x8' → description "1\" ISO (Cost/Sq. Ft.) — 0.031 boards per sq ft", qty 2, unit "board", rate 36.54
```
Qty, rate and cost are right; the customer-facing text is wrong (4'x4' says "0.063 boards per
sq ft"). `unitText` (`:137-142`) does not know "board", so the editor shows "2 board".
`iso-board-sizes.test.ts` checks qty and rate only.

### 3. A technician can edit an Authorized ticket and move Authorized / Invoiced / Closed tickets backwards
Migration 20261005140000 says "an Authorized ticket is read-only to them"; it is not. The trigger
guards only moves *into* office stages and the technician RLS only checks the *new* stage.

- Live probe as John (rolled back): on his own ticket set to Authorized, `update … set stage='done', notes=…` succeeded. On his Closed ticket #6004, `set stage='open'` succeeded.
- Server: `stageProblem` (`src/lib/ticket-stage.ts:46-50`) allows a technician any move to open/scheduled/done regardless of the current stage, and a sales/PM any move out of an office stage; `setServiceStage` (`src/lib/service.functions.ts:546`) applies only that. Only the UI (`stageLocked`, `src/components/service-page.tsx:1299, 2149`) hides it.
- Scenario: a Closed, paid ticket moved back to Done by its technician through a direct call; the paid invoice stays attached.

### 4. Dispatching to a technician who cannot see the ticket
`technician_options()` (live definition) lists every profile with the technician tick, whatever
their page access. `service_jobs_read` requires `has_access('service')`. Live: John (access:
estimate, inventory) is assigned #6008 and #6004; probed as John he sees **0** tickets; with
'service' added (rolled back) he sees both. "inventory tester" and "prospecting" have the same
shape. Nothing in Admin › Users or the dispatch picker warns. Fix direction: filter the picker to
technicians with Service access, or warn on the user row.

### 5. History shows a redundant "stage changed at" on every stage move
`audit_row()` skip list (`supabase/migrations/20261005130000_ticket_audit.sql:28`) predates the
`stage_changed_at` column (20261006180000). Live rows read "stage 'scheduled' → 'done'; stage
changed at Oct 6, 2026 → Oct 6, 2026", and the backfill wrote 9 "system" rows "stage changed at —
→ …". Each eats one of the six summary slots. `ticket-audit.test.ts:34-38` pins the function body,
so the fix is a migration plus that test.

### 6. "Needs authorization" goes to one arbitrary admin when no authorizer is set
`src/lib/ticket-events.server.ts:100-101` assigns the follow-up to `authorizers[0]`; the
`ticket_authorizers()` fallback has no ORDER BY (migration 20261005150000:25-32). With two admins
and no authorizer the tab item can flip between them on any ticket save (the follow-up is closed
"reassigned" and re-created). Harmless today (one admin, Braden); the Setup help says "every admin".

### 7. Properties rename leftovers
- `src/components/customers-page.tsx:1385` button "Add site" under the Properties heading.
- `src/components/crm/site-select.tsx:89` button "Add site" (dialog title already "New property").
- `src/components/crm/county-codes-settings.tsx:168` "county code for each site, picked on the site under Customers".
- Customer History lines still say "Site 'X' …" (`20261005130000_ticket_audit.sql:85`).

### 8. Wording after the Authorized stage
- Voiding the last live invoice sends the ticket back to Authorized and notifies the office "Ticket #… authorized — ready to invoice. <voider> authorized it." (`src/lib/ticket-events.server.ts:79-91`).
- The authorizer's notice title is "To invoice assigned to you: Authorize Ticket #…" (`src/lib/followups.server.ts:79, 101`).
- `src/components/service/closeout.tsx:253` and `src/lib/service-inspection.functions.ts:215` tell a technician on an Authorized ticket "The office has invoiced or closed this ticket".
- `location_id` renders as a raw UUID in History (`audit_col_name` / `audit_label` have no entry for it).

## Design gaps to confirm with the owner

- **Authorized is not "open work"**: `OPEN_TICKET_STAGES` (`src/lib/crm-account.ts:418`) and `WORK_TICKET_STAGES` (`src/lib/my-work.ts:26`) are open/scheduled/done, so a customer with an Authorized but un-invoiced ticket can be deleted, and the ticket is in nobody's Work Overview list except the authorizer's tab.
- **Authorizer sees a Done ticket twice** on Work Overview "Everyone": under Needs authorization (follow-up) and under Done — waiting on the office (`src/lib/my-work.ts:327`).
- **Pre-Oct 5 drafts skip Authorized**: `INVOICE_STAGES` is checked only when creating an invoice (`src/lib/invoices.functions.ts:380`); an older draft on a Done ticket can still be finalised Done → Invoiced.
- **Material corrections are UI-gated only**: `addMovement` (`src/lib/inventory.functions.ts:310-336`) accepts any user with inventory access against any ticket at any stage, writes no timeline or audit row. Pre-existing, not a regression.
- **Time and repairs have no server stage lock**: `saveTimeEntry` / `saveJobRepair` check only `ownJob` (`src/lib/service-field.functions.ts:388, 422, 561`); the lock after Authorized is the UI's.
- **No audit trail** for `property_sites` and `site_warranties` (no trigger, no `audit_row` branch).
- **Renaming an inner site** does not refresh `service_jobs.location_name`; list cards show the old name until the ticket is re-saved (same design as property names).
- **Repair tags are stored but unused**: no UI reads `repair_templates.tags`; the price-free view has no `tags` column. Dead data, no breakage.
- **Mentions roster** = `technician_options()`: a Customers-only user cannot be @mentioned (silently ignored).
- "Add material at the top" adds the row at the top until save, then it sorts to the bottom (`service-materials.functions.ts:341, 372`).
- Close-out routes on `profile.technician`, so an admin who is also a technician lands on Today, not the ticket (`closeout.tsx:344`).

## Verified OK (traced UI → server → DB)

Arrival window (constraint, zod, kept on Board drops, shown on list/Board/Today/form) · stages and
labels match the DB check and trigger, picker choices, timeline and stage strip show Authorized ·
close-out "Before you finish" dialog, done stamped once, no backwards move from finished stages ·
authorizer notice "ready for your review" to `ticket_authorizers()` minus the actor, Setup picker
re-validated with `manager_options()`, Needs authorization bucket counted · finalize/send →
Invoiced, Mark paid no longer closes, void → Authorized only with no live invoice left, Awaiting
invoice = Authorized · Tech Board six-stage colours, legend with Invoiced and Closed, coloured
rail, week label · named Sites: soft delete, duplicate names refused, ownership verified on the
server, snapshot name, deleted sites hidden from the picker but shown on old tickets · list cards
(stage date, property › site, city, state, Job #, PO #), Technician filter ANDs with the others ·
Earlier at this property (same property, not the current ticket, RLS-limited) · warranties
in-force rule and badge, missing-table fallback · History fold query, cap 300, managers/admins
only · @mentions stored as text, inbox row always, email/push by preference, failure toasts ·
layout toggle in localStorage, dark-mode scan passes · service material RLS and price-free view,
runtime price = material cost × pack, stock-linked rows take their group from the catalog (the 89
null categories are correct) · markup default, per-invoice copy, 0–10 range, finals untouched ·
rebuild matching by source · travel at the travel rate from `service_rates`, helpers only when no
crew · repair library 475 (6 untagged are CenterPoint's own).
