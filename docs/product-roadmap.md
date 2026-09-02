# Bid-O-Matic Product Roadmap

Where the app goes after Bid-Advantage parity. Each phase gates the next; Phase 0 gates
everything. Companion docs: `bid-validation-plan.md` (the Phase 0 test spec).

## Phase 0 — Bid-to-bid validation  *(the current gate)*

Reconcile the two validation bids (see `bid-validation-plan.md`) against legacy
Bid-Advantage line by line. Every flagged seam in the engine gets confirmed or fixed.
Nothing downstream ships to real estimating until this passes.

## Phase 1 — PlanSwift report import

Upload a PlanSwift Excel/CSV report → parse → mapping-review screen (each takeoff line
assigned to an app field) → prefill the estimate. Kills the re-typing loop while PlanSwift
remains the takeoff tool. Needs 1–2 sample reports from real jobs to build the parser
against (never a guessed format). The field-mapping layer built here is reused by Phase 2.

## Phase 2 — Native takeoff (replace PlanSwift for typical jobs)

In-browser takeoff living inside the estimate: render the plan PDF, calibrate scale from a
known dimension, trace areas / lines / counts that ARE the bid's sections, edges, parapets,
curbs and penetration quantities — no export/import loop at all.

- **v1 core:** PDF render, per-page scale calibration, polygon areas (shoelace),
  polyline lengths, count markers, direct binding to estimator fields.
- **v1.5 messy-plan kit** (designed in from day one, shipped second): deskew/rotate,
  per-page scale for scans, ortho-snap + arc segments + negative polygons (courtyards),
  plan dimming under colored takeoff overlays, multi-sheet page manager, tiled rendering
  for large sets. "Messy plans" is a checklist of known fixes, not a research problem.
- PlanSwift shrinks to a fallback for extreme plan sets, then retires.

## Phase 3 — AI-assisted takeoff (optional v2)

Claude vision proposes the first pass on a sheet — roof outline, penetration flags,
dimension-string and scale-text reading — always as a **proposal the estimator reviews and
corrects**, never silently trusted.

**API cost per project** (estimate; measure on real sheets before committing):
~11–14K input tokens + ~3K output per sheet per pass (sheet image + zoom crops + JSON out).

| Model | $/sheet/pass | Typical project (2–4 sheets, 1–2 passes) | Messy worst case |
|---|---|---|---|
| Claude Opus 5 ($5 in / $25 out per MTok) — recommended | ~$0.15 | **$0.30–$1.20** | ~$3–5 |
| Claude Sonnet 5 ($2 / $10) — budget | ~$0.06 | $0.12–$0.50 | ~$1–2 |
| Claude Fable 5 ($10 / $50) — max accuracy | ~$0.30 | $0.60–$2.40 | ~$6–10 |

Rule of thumb: **~$1/project typical, ~$5 on a nasty scan set** → ~$15–75/month at
50 projects/month on Opus 5. Negligible next to a PlanSwift seat or estimator hours.
(Prices are current API rates as of Sep 2026; re-check before build.)

## Phase 4 — CRM layer (native, in the same app)

The full pipeline: **Customer → Project → auto-takeoff → bid → proposal → follow-up →
won/lost → ROI.** Native rather than an external CRM sync: the stack (Supabase, auth,
roles, bids with statuses and cached grand totals) already holds most of the data.

**Data model additions:**
- `customers` — first-class table (name, contacts, addresses); today's per-bid customer
  block becomes a link, and one customer owns many projects.
- `projects` — a job for a customer; holds the uploaded plan set, the takeoff, and one or
  more bids (revisions); carries the status pipeline that today lives on the bid.
- `activities` / follow-ups — per-customer cadence (e.g. "call 7 days after Submitted"),
  next-action date, notes log; a follow-up dashboard of what's due today.
- Outcome fields — awarded amount, actual cost (entered or imported later), close date →
  per-project ROI, win rate by customer/estimator/size, pipeline value by status.

**Build order inside Phase 4:** (a) customers table + bid linkage, (b) projects grouping
bids + plans, (c) follow-up cadence + due dashboard, (d) outcomes + ROI reporting.

## Standing principles

- Known rules get wired into the money path; guessed mappings stay display-only until a
  captured bid or sample file validates them.
- Every automation is a proposal the estimator can see and correct.
- Saved bids freeze pricing until "Update pricing & labor" is clicked (legacy semantics).
