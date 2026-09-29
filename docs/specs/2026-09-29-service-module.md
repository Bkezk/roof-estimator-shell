# Spec: Service module (replace CenterPoint) — phases A–D

Status: building
Owner approved: <OWNER TO CONFIRM: date this retro-spec is approved>
Module: Service
Closes TODO item: "**Service module / CenterPoint replacement (owner, Sep 24)** — handoff and history in `docs/handoff-service-module.md`; build from `docs/service-module-design.md`"

Retro-spec written 2026-09-29 from `docs/service-module-design.md` (phases A–D, §6) and the
TODO handoff. Only outcomes that design doc states are listed; everything else is marked
`<OWNER TO CONFIRM>`.

## 1. Hypothesis

If the repair ticket — phone call to emailed invoice — lives in Bid-O-Matic, then the office,
the techs and the bookkeeper can stop using CenterPoint Connect, with fewer clicks than
CenterPoint for each task (design §5 click comparison), leaving the company on this web app +
Sage only (TODO handoff, owner, Sep 24).

## 2. Success criteria (written BEFORE building — do not edit after approval)

Outcomes stated in `service-module-design.md`, by phase:

**A — Service jobs + inventory tie**

1. The Inventory "A job" picker lists service jobs as well as bids, and a `consumed` movement
   carries `service_job_id` (§6 A).
2. The vehicle write-off tick box is gone: material off a truck is always against a job (§2,
   §6 A — "it fixes the inventory hole today").

**B — Customers, dispatch, tech phone**

3. Techs create and close tickets in the app (§6 B).
4. Office new ticket, assigned: 1 screen, ~5 clicks (CenterPoint 2 / ~14) (§5 table).
5. Tech start travel → on site: 2 taps (§5 table).
6. Tech close-out with 1 repair: 1 screen, ~10 clicks (CenterPoint 7 panels, ~25) (§5 table).
7. Material off the truck recorded in close-out, 2 taps (§5 table).
8. Close-out works offline: written locally first, photos queued, a "waiting to sync" badge
   (§5.3.3).

**C — Invoicing here + Sage export**

9. Invoices match CenterPoint's to the cent, using the rules in §4 (§4 heading).
10. Invoice reviewed and sent: 1 block on the ticket, 2 clicks (§5 table); record the payment:
    Mark paid, 1 dialog (§5 table).
11. From this day new tickets never touch CenterPoint (§6 C).

**D — History and cut-over**

12. Tickets since 2024 imported with their invoices, photos and signatures; warranties onto
    roofs; companies' external ids (§6 D). Completeness check: <OWNER TO CONFIRM: what counts
    as a complete import — row counts vs CenterPoint, spot checks? not stated>.
13. Both systems run for a month, then CenterPoint is cancelled (§6 D). Condition for
    cancelling: <OWNER TO CONFIRM: not stated beyond "run both a month">.

## 3. Falsifiers

- <OWNER TO CONFIRM: no falsifier is stated in the repo. The design doc's own measurable claims
  are the click counts in §5 and "invoices match to the cent" in §4; say whether missing either
  means the module was built wrong.>

## 4. Out of scope

Design §9 "Not built, and why":

- Projects / daily work-day log / production board (a small "job log" on a won bid later).
- Opportunities / site bids as CenterPoint had them (the Estimator is the sales tool; decision 8).
- Tasks & Meetings / Calendar.
- Reports beyond saved filters later.
- Sub Contractors / Vendors / Service Agreements.
- Stage-by-stage notification emails; texting stays outside.
- A live Sage integration in the first cut (§5.5; TODO: "an export the bookkeeper imports is
  enough").

## 5. Seams and unknowns

| Unknown | Source that settles it | If unavailable |
| --- | --- | --- |
| Which Sage (50 / 100 Contractor / Intacct) — Sage CSV layout | Owner (design §8 q1) | keep the generic CSV; flag and stop on layout |
| Is the 6-digit External Identifier the Sage customer number? | Owner (§8 q2) | flag and stop |
| Helper rates ($40/$45 travel, $55 labor) fixed; tech count ever > 2 | Owner (§8 q3) | flag and stop |
| Ticket types to keep | Owner (§8 q4) | flag and stop |
| Phone habits / what must work offline day one | Owner (§8 q5) | flag and stop |
| History depth | Owner (§8 q6) | flag and stop |
| CenterPoint API access (the "tyk" integration) | Owner (§8 q7) | CSV exports + file download |
| Repair quoting: templates on a ticket or Estimator bids | Owner (§8 q8) | flag and stop |
| CenterPoint data: CSV exports of Companies, Properties, Contacts, Tickets, Invoices; the 475 repair templates and 142 materials | Owner (TODO owner actions, "For phase D") | flag and stop — never guess the export format |
| Truck inventory truth (reconciliation, par list) | Design §12 (draft, for discussion); owner to ask whether a standard load exists | flag and stop |

## 6. Rollback condition

The module ships behind the `service` access flag (MODULES.md rule 5), so hiding it is always
possible. When to hide it rather than fix forward: <OWNER TO CONFIRM: not stated in the repo>.

## 7. Test plan

| Criterion | Test | Type |
| --- | --- | --- |
| 1–2 | manual: /inventory → Take from inventory → "A job" lists a service job; the vehicle→shop move has no "used on the vehicle" box | manual |
| 3–8 | manual: /service and /service/today on a phone, count clicks against the §5 table; airplane-mode close-out shows "waiting to sync" | manual |
| 9 | `src/lib/invoices.test.ts` plus a manual compare of one invoice against CenterPoint 5431 / 5449 | unit + manual |
| 10–11 | manual: finalise, send, mark paid on one ticket | manual |
| 12–13 | <OWNER TO CONFIRM: depends on the §2.12 completeness check> | manual |

## 8. Result (filled in at close — never before)

Outcome: confirmed | falsified | partial
Closing commit: <hash>
Evidence per criterion:

1. …

What was learned / what changed in the design as a result:

- …

Decisions made during the build (also appended to `docs/DECISIONS.md`):

- …
