# Spec: Bid-to-bid validation (Phase 0)

Status: building
Owner approved: <OWNER TO CONFIRM: date this retro-spec is approved>
Module: Estimator
Closes TODO item: "**Phase 0 — bid-to-bid validation (the current gate).**"

Retro-spec written 2026-09-29 from `docs/bid-validation-plan.md` and `docs/product-roadmap.md`
§Phase 0. Nothing below is new scope; where those docs are silent the gap is marked
`<OWNER TO CONFIRM>`.

## 1. Hypothesis

If the two deliberately loaded validation bids, entered identically in legacy Bid-Advantage and
in Bid-O-Matic, reconcile line by line (Review tab Cost view and Labor view against the web
estimate-review CSV), then the estimator (office) can price real jobs in Bid-O-Matic without
re-checking them in Bid-Advantage. Roadmap: "Every flagged seam in the engine gets confirmed or
fixed. Nothing downstream ships to real estimating until this passes."

## 2. Success criteria (written BEFORE building — do not edit after approval)

One criterion per row of the "Open flags these bids settle" table in `bid-validation-plan.md`.
Each passes when the web line equals the Bid-Advantage line for that seam, or the engine is
fixed (with a `docs/legacy-money-parity.md` entry and a test, MODULES.md rule 1) until it does.
"Equals" means within <OWNER TO CONFIRM: match tolerance — to the cent, or within rounding? not stated in the repo>.

1. Tear-off ÷100 hours scale (adapters / bid-builder) — settled by Bid 1.
2. Freight basis (M0?) + percent scale (bid-builder) — settled by Bid 1 (+ Bid 2 if percent
   mode is also tried).
3. LaborSubtotal1 membership & single crew rate (estimate.ts) — settled by Bid 1.
4. Roll-goods geometry / edge overlap (quantities / estimate) — settled by Bid 1.
5. Parapet band/girth + membrane-sqft membership (bid-builder) — settled by Bid 1.
6. Curb perimeter reading; curb membrane material (not computed) (bid-builder) — settled by
   Bid 1.
7. Adhesive labor ÷1000 scale; unit rounding (adapters) — settled by Bid 2.
8. Warranty / high-wind composition (warranty.ts) — settled by Bid 2.
9. Discount stacking; per-diem / commission routing (money.ts) — settled by Bid 2.
10. Metals labor → services routing (bid-builder) — settled by Bid 2.
11. LaborSubtotal2 double-count question (rows 8+9+10+11) (estimate.ts) — settled by either bid.

Both bids are built fresh in Bid-Advantage (not an old saved bid) and compared on an unsaved web
estimate or after **Update pricing & labor** (plan: "Reminder about frozen pricing").

## 3. Falsifiers

- Any line-level mismatch between the web CSV and Bid-Advantage's Review Cost / Labor views
  that is not explained by a documented seam (a row of the Open-flags table, a "Known
  not-yet-automated" manual entry, or a "Remaining known divergences" item in
  `bid-validation-plan.md`).

## 4. Out of scope

- The "Known not-yet-automated" items (pull-test → fastener OC, termination hardware pricing,
  curb membrane material as an extra line, membrane fastener counts and sealant
  auto-quantities): entered by hand for the test, not built here.
- "Ordering/display parity (no totals impact)" items in `bid-validation-plan.md`.
- Roadmap Phases 1–4 (PlanSwift import, native takeoff, AI takeoff, CRM layer).
- The `.bax` importer proof run (TODO item 1c.5) — a separate comparison.

## 5. Seams and unknowns

Files still carrying `FLAGGED FOR BID VALIDATION` (checked 2026-09-29):

- `src/lib/engine/adapters.ts:238` — per-foot / drill-variant / fastener-derived accessory labor.
- `src/lib/engine/estimate.ts:15` — exact membership of the direct-labor subtotal.
- `src/lib/engine/membrane-fasteners.ts:55` — the literal `30 × isPerim` (DLRowStyle 30-ft
  perimeter strip constant).

| Unknown | Source that settles it | If unavailable |
| --- | --- | --- |
| Every Open-flags row (§2) | Bid-Advantage Review tab — Cost view and Labor view for Bid 1 and Bid 2, plus a screenshot of each input tab | flag and stop |
| Duro-Tuff parapet membrane: verbatim legacy ×30 vs corrected ×2.5 ft (parity doc §7.3 HUMAN GATE) | Owner decision + a validation bid on Duro-Tuff | flag and stop |
| Tab-sheet membrane tier-selection rule (tab lap vs avg-sheet) | Validation-bid evidence or explicit owner approval (plan: "Remaining known divergences") | flag and stop |
| DLRowStyle 30-ft perimeter strip constant units | Validation-bid evidence | flag and stop |

## 6. Rollback condition

<OWNER TO CONFIRM: not stated in the repo. The roadmap says only that nothing downstream ships
to real estimating until Phase 0 passes.>

## 7. Test plan

| Criterion | Test | Type |
| --- | --- | --- |
| 1–6 | manual: build Bid 1 fresh in Bid-Advantage, enter it in /estimate from the tab screenshots, Export on Review, reconcile the CSV against BA Review Cost + Labor views line by line | manual |
| 7–10 | manual: same with Bid 2 | manual |
| 11 | manual: either bid, LaborSubtotal2 rows 8–11 | manual |
| any fix | a parity test in `src/lib/engine/**/*.test.ts` that fails before the fix, named at close | unit |

## 8. Result (filled in at close — never before)

Outcome: confirmed | falsified | partial
Closing commit: <hash>
Evidence per criterion:

1. …

What was learned / what changed in the design as a result:

- …

Decisions made during the build (also appended to `docs/DECISIONS.md`):

- …
