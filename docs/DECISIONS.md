# Decisions

One line per decision: `YYYY-MM-DD — <decision> — why: <one clause> — reversed by: <what would change it>`.
Append only; to change a decision, add a new line that supersedes it. Every line cites where it
is recorded. "not recorded" means the source doc does not say — do not fill it in by guessing.

Seeded 2026-09-29 from `docs/TODO.md`, `MODULES.md`, `docs/service-module-design.md` and
`docs/legacy-money-parity.md` — only decisions written there with a date. Where a source gives a
month and day only ("Sep 24"), the year is 2026.

## Estimator money engine (`docs/legacy-money-parity.md`)

2026-09-04 — Web default section aligned to legacy (sheetsizeid 4 = "1500 sf"); default lap moved 28 → 60 — why: HUMAN GATE RESOLVED after the tab-tier wiring repriced default sections ~+9.8% — reversed by: not recorded — source: legacy-money-parity.md §1 ("HUMAN GATE RESOLVED (2026-09-04)")
2026-09-09 — Curb style 5 wrap area is `(A' + 2D' + C') × (B' + 2D' + C') / 144` — why: CORRECTED from the IL (dims[0] loaded once, no ×2, no B' in the first factor) — reversed by: not recorded — source: legacy-money-parity.md §2 ("CORRECTED 2026-09-09")
2026-09-09 — Curb wrap `Round(cost, 8)` applies to every style's result, not just style 6 — why: CORRECTED, it is the method tail — reversed by: not recorded — source: legacy-money-parity.md §2 ("corrected 2026-09-09")
2026-09-09 — §9.1 labor rates are already seeded (capture status corrected) — why: CORRECTED capture status — reversed by: not recorded — source: legacy-money-parity.md §9.1 ("Capture status (corrected 2026-09-09)")
2026-09-10 — Parapet `DeckFasteners` is consumed (1 screw + 1 poly plate per foot of parapet to the deck bucket) — why: CORRECTED, the earlier "dead code" reading only searched DataAccess.dll — reversed by: not recorded — source: legacy-money-parity.md §8.5 ("CORRECTED 2026-09-10")
2026-09-10 — T-Patch calc counts only Duro-Tuff sections — why: CORRECTED, the IL branches past the add when ShortName ≠ "durotuff" — reversed by: not recorded — source: legacy-money-parity.md §12.4 ("CORRECTED 2026-09-10")
2026-09-14 — `lookup_Decktimes` factor is inactive; the web's ×1 is exact — why: RESOLVED, CustomValue is -1 on every row and has no editor — reversed by: not recorded — source: legacy-money-parity.md §20.2
2026-09-14 — Every Setup time band is the multiply mode, matching the seed — why: RESOLVED from the Setup Times admin screen (capture 110813) — reversed by: not recorded — source: legacy-money-parity.md §20.2
2026-09-14 — Tear-off custom values are hours per 100 sq ft, so ÷100 — why: RESOLVED by the Tearoff Times tab's own caption — reversed by: not recorded — source: legacy-money-parity.md §20.2
2026-09-18 — `R10` rounding adds a full ten when Ceil lands on a multiple of ten (9.27 → 20) — why: corrected, the first transcription read it as ceil-to-next-ten — reversed by: not recorded — source: legacy-money-parity.md §12 notation ("corrected 2026-09-18, §22.5")
2026-09-18 — Flute filler quote layers ask for no "Attached With" in the web — why: legacy's combo never touches the quote's material or labor — reversed by: not recorded — source: legacy-money-parity.md §22.8 ("Kept as is (decided 2026-09-18)")
2026-09-21 — Curb ISO labor 0.25 h is per entry; only the per-foot part scales with qty — why: corrected from the IL — reversed by: not recorded — source: legacy-money-parity.md §2 ("corrected 2026-09-21 from the IL, §22.12")
2026-09-21 — Underlayment board waste is ×1.03 on every board except "Geotextile" at ×1.06 — why: CORRECTED, the first reading had the factors swapped; a legacy Review screen confirms — reversed by: not recorded — source: legacy-money-parity.md §6 ("CORRECTED 2026-09-21 (§22.12)")
2026-09-21 — Rock Ply pipe stacks and corners removed from the pipe-stack picker (code paths stay) — why: they do not exist in the legacy catalog (owner confirmation) — reversed by: not recorded — source: legacy-money-parity.md §22.8 ("CLOSED 2026-09-21")
2026-09-21 — Plain D / L / E / M gutter styles are not used; nothing is captured for them — why: not recorded — reversed by: not recorded — source: legacy-money-parity.md §22.12 ("owner, 2026-09-21")
2026-09-21 — New section prefills 0 × 0 (was 100 × 100) — why: a silent 100 × 100 was being priced when a section was forgotten — reversed by: not recorded — source: legacy-money-parity.md §22.13 (owner walkthrough, 2026-09-21)
2026-09-21 — Flute Filler "Calculate pieces" piece length prefills 8 ft — why: the owner's stock length — reversed by: not recorded — source: legacy-money-parity.md §22.13
2026-09-21 — Duro-Bond mechanical sections show no insulation plates — why: deliberate deviation; the membrane's induction plates already hold the boards — reversed by: not recorded — source: legacy-money-parity.md §22.25 (owner round, 2026-09-21)
2026-09-21 — Netted "Needed" figures go negative (no `max(0, …)` clamp) — why: not recorded — reversed by: not recorded — source: legacy-money-parity.md §22.25
2026-09-21 — "Update Pricing & Labor" shows only while the bid's frozen snapshot differs from current admin data — why: so it reappears exactly when admin data changes — reversed by: not recorded — source: legacy-money-parity.md §22.25
2026-09-21 — Adhesives fold into Accessories on Review — why: legacy folds them there (owner) — reversed by: not recorded — source: legacy-money-parity.md §22.26
2026-09-21 — Panduit boxes billed in full (boxes × box cost per row), departing from legacy's one box per row — why: owner's decision; legacy's own Accessories Summary showed the full figure — reversed by: flipping `LEGACY_PANDUIT_ONE_BOX_PER_ROW` back to true — source: legacy-money-parity.md §22.27
2026-09-21 — Changing Setup "2. Wall Type" also sets every existing parapet's wall type; "Apply To Existing Roof Sections" pushes it too — why: owner's expectation (departure from legacy) — reversed by: not recorded — source: legacy-money-parity.md §22.30
2026-09-21 — "Apply To Existing Roof Sections" also applies "1. Deck Type" to every section — why: owner's request (legacy leaves DeckType alone) — reversed by: not recorded — source: legacy-money-parity.md §22.30
2026-09-22 — Duro-Tech TPO added as the web's sixth roof system with no legacy source — why: owner: a new Duro-Last TPO material — reversed by: not recorded — source: legacy-money-parity.md §22.34
2026-09-22 — Non-DL TPO and EPDM Rubber added as roof systems with no legacy source — why: owner request — reversed by: not recorded — source: legacy-money-parity.md §22.35
2026-09-22 — "Enhancement Necessary" probes a system's narrowest offered width when it has no 60" (EPDM → 120") — why: departure; the 60" probe flagged every EPDM bid — reversed by: not recorded — source: legacy-money-parity.md §22.35 addendum
2026-09-22 — Bid Combiner departures: first source's roof system / attachment / adhesive; Non-DL price conflicts listed, not a modal; pipe stacks keyed by colour — why: not recorded (money identical for (a)) — reversed by: not recorded — source: legacy-money-parity.md §22.41
2026-09-22 — A new section starts at complexity "Medium" (index 3); saved sections keep theirs — why: owner: "complexity should be defaulted to medium" — reversed by: not recorded — source: legacy-money-parity.md §22.38 (owner departure)
2026-09-22 — Five underlayment layers allowed (legacy: four) — why: owner: "some jobs need 5" — reversed by: not recorded — source: legacy-money-parity.md §22.40 (owner departure)
2026-09-23 — Item numbers come only from the Duro-Last Excel price workbook — why: owner: the Bid-Advantage numbers "have not been updated in ages" — reversed by: not recorded — source: legacy-money-parity.md §22.43
2026-09-23 — Per-page access; the "Admin" nav group is renamed "Estimate Pricing" — why: owner request — reversed by: not recorded — source: legacy-money-parity.md §22.44
2026-09-23 — A bid is priced as if it used no inventory; stock only reduces what to buy — why: owner rule — reversed by: not recorded — source: legacy-money-parity.md §22.45
2026-09-23 — Order list "To buy" subtracts only inventory the bid actually took, never on-hand — why: owner: To buy read 0 before anything was pulled — reversed by: not recorded — source: legacy-money-parity.md §22.48
2026-09-23 — Underlayment labor adjust on a multi-selection that already differs: warn and set every selected section to the same adjustment (legacy refuses) — why: not recorded — reversed by: not recorded — source: legacy-money-parity.md §22.50 ("DEPARTURE")

## Product direction and modules (`docs/TODO.md`, `MODULES.md`)

2026-09-24 — Salesperson-first outside the estimator: map, building size / address and "New bid" on screen at once; setup behind one button with Advanced — why: the user is a non-technical salesperson — reversed by: not recorded — source: MODULES.md rule 7 ("owner, Sep 24")
2026-09-24 — Repairs are neither bids nor bolted onto CenterPoint: a lightweight service job in the app, CenterPoint stays customer / invoicing system of record — why: not recorded — reversed by: the CRM phase, when service jobs become CRM service tickets — source: TODO.md item 0 ("Agreed direction (owner, Sep 24)"), now docs/handoff-service-module.md
2026-09-24 — Target is this web app + Sage only (retire Bid-Advantage, PlanSwift, CenterPoint) — why: not recorded — reversed by: not recorded — source: TODO.md item 0 ("The bigger goal (owner, Sep 24)"), now docs/handoff-service-module.md
2026-09-24 — Sage stays for accounting and payments; a live Sage integration is optional, an export the bookkeeper imports is enough — why: not recorded — reversed by: not recorded — source: TODO.md item 0 (owner, Sep 24), now docs/handoff-service-module.md
2026-09-24 — Order: CenterPoint replacement first, then takeoff, then history migration and cancelling the subscriptions — why: CenterPoint is daily use — reversed by: not recorded — source: TODO.md item 0 (owner, Sep 24), now docs/handoff-service-module.md
2026-09-24 — Replace CenterPoint by the end, in four steps that each stand alone (service jobs → customers / scheduling → invoicing → history import, run both a month, cancel) — why: not recorded — reversed by: not recorded — source: TODO.md item 0 (owner, Sep 24), now docs/handoff-service-module.md
2026-09-24 — The Kentucky loader runs only when nobody is using the app (night pass), one shard only, never with DDL running — why: run 10 starved the small instance and the owner could not open a bid — reversed by: if the night pass also starves, upgrade the Lovable Cloud instance rather than tune the loader — source: TODO.md item 3
2026-09-25 — Each service vehicle gets an assigned driver, changeable with an effective date so history stays right — why: to tie inventory off a vehicle to the driver's job — reversed by: not recorded — source: TODO.md item 3c ("owner, Sep 25")
2026-09-25 — PlanSwift: the owner keeps measuring and pricing in PlanSwift (piece A) and imports the finished job into Bids, not Takeoff (piece B) — why: not recorded — reversed by: not recorded — source: TODO.md item 10 ("owner, Sep 25–26") and item 0
2026-09-26 — Close the .bax cost gaps so an imported bid always reprices to what Bid-Advantage showed (freeze the file's labor tables into the snapshot, apply discount / tear-off adjust, import skipped items) — why: not recorded — reversed by: not recorded — source: TODO.md item 1c ("owner, Sep 26")
2026-09-28 — Storm call points flag buildings only for a major weather event in the past week — why: owner: "just if there's been a major weather event in the past week" — reversed by: not recorded — source: TODO.md storm call points (built Sep 28)
2026-09-28 — NASA EONET rejected as a storm source — why: only tropical-cyclone tracks and wildfires for Kentucky — reversed by: not recorded — source: TODO.md storm call points
2026-09-28 — Lead sources checked and not used: DHBC plan review log (no feed; monthly open records request), Lexington data hub, ConstructConnect, Dodge, Builders Exchange of Kentucky, Cabinet for Economic Development releases, KPA Smart Search — why: no feed, paid, blocked or prose only (per source) — reversed by: not recorded — source: TODO.md construction leads (built Sep 28)
2026-09-29 — "pvc" removed from the default roof keywords — why: the first live pull flagged two waterline jobs on PVC pipe — reversed by: not recorded — source: TODO.md construction leads ("Sep 29")
2026-09-29 — Not worth a lead feed: KCTCS RSS, Bid Locker Kentucky, Lexington purchasing pages, BidNet, JCPS bids — why: equipment only / KCTCS only / 404 / blocked / gone — reversed by: not recorded — source: TODO.md construction leads ("Later Sep 29")

## Service module and CRM hub (`docs/service-module-design.md`)

2026-09-26 — The CRM keeps its own site records (`crm_sites`); prospecting's `buildings` are NOT the CRM; "Import into CRM" only prefills — why: not recorded — reversed by: not recorded — source: service-module-design.md §2, §10, §11 ("owner, Sep 26")
2026-09-26 — A customer profile (`crm_accounts`) is a company / group or an individual — why: not recorded — reversed by: not recorded — source: service-module-design.md §2, §11 ("owner, Sep 26")
2026-09-26 — Customer profile is the hub: bids, takeoffs (through their bid), tickets and opportunities link to it; a bid links via a Setup › Customer name typeahead — why: not recorded — reversed by: not recorded — source: service-module-design.md §11 ("owner's answers, Sep 26")
2026-09-26 — Opportunity = a potential new customer, with assigned user, expected close from an admin default, status Open / Contacted / Quoted / Won / Lost / No response — why: not recorded — reversed by: not recorded — source: service-module-design.md §11
2026-09-26 — One follow-up timer mechanism for opportunities and tickets, reminders by email and text — why: not recorded — reversed by: superseded 2026-09-27 (email + push, no SMS) — source: service-module-design.md §11
2026-09-26 — First phone app is the installed web app (PWA) — why: tech pages open full-screen and can queue work offline — reversed by: "decide native later only if the PWA falls short" — source: service-module-design.md §11
2026-09-26 — `vehicle_drivers`: up to two users per vehicle, a user may be on two vehicles, admins change it, history kept; each material line lets the tech pick the truck, defaulting to the last answer — why: not recorded — reversed by: not recorded — source: service-module-design.md §11 ("owner, Sep 26")
2026-09-26 — An opened tube / pail counts as one used and leaves the truck's stock then; partials are not tracked — why: simple, and it matches what the customer signed for — reversed by: not recorded — source: service-module-design.md §12 ("owner, Sep 26")
2026-09-26 — The customer is charged for material reported used plus labor plus markup; reconciled material is a job-cost and stock correction, not a billing change unless the office decides — why: not recorded — reversed by: not recorded — source: service-module-design.md §12 ("Owner's answers (Sep 26)")
2026-09-27 — Technicians see only their assigned tickets (plus Inventory when granted) and can move a ticket to Done at most; Invoiced and Closed are the office's — why: not recorded — reversed by: not recorded — source: service-module-design.md §11 ("owner, Sep 27")
2026-09-27 — Ticket numbers start at 6000 — why: so they never collide with CenterPoint's while both run — reversed by: not recorded — source: service-module-design.md §11; TODO.md item 0
2026-09-27 — Reminders go by email (Resend) + web push; no SMS — why: not recorded — reversed by: not recorded — source: service-module-design.md §13 ("owner, Sep 27; no SMS")
2026-09-28 — Sidebar: one Customers group — Customers, Service, Opportunities, Follow-ups; Today first for technicians — why: not recorded — reversed by: not recorded — source: service-module-design.md §7, §11 ("owner, Sep 28")
2026-09-28 — An assigned item is not flagged untouched on day one; it turns red and enters Needs Action only at the limit (tickets 2 days, opportunities 3) — why: not recorded — reversed by: changing the limits in Admin › Settings › Reminders — source: service-module-design.md §15 ("Owner, Sep 28: not on day one")

## Tooling

2026-09-29 — CI installs with `npm ci` from a committed `package-lock.json` (no longer gitignored) instead of a fresh `npm install` — why: reproducible installs; the committed `bun.lock` was out of sync with package.json (missing html-to-image, pdf-lib, pdfjs-dist), so `bun install --frozen-lockfile` failed — reversed by: keeping `bun.lock` in sync with package.json, then switching CI to `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile` — source: PR chore/spec-discipline, `.github/workflows/ci.yml`
