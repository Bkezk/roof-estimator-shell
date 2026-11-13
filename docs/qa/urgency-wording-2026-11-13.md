# "Labor rate" reads "Urgency" (Nov 13, 2026)

Owner: "can we change labor rate to urgency on the front end".

A ticket's Standard / Urgent / Emergency choice now reads "Urgency" everywhere a person sees it.
Wording only. The database column keeps its name (`labor_rate_kind`) and the choice still picks
the invoice's hourly rates.

## What changed

| Where                                   | Before                    | Now                    |
| --------------------------------------- | ------------------------- | ---------------------- |
| Ticket form, the field's label          | Labor rate                | Urgency                |
| Ticket form, the field's hover hint     | Sets the hourly rates…    | Says both effects      |
| "Copied from ticket" note on a new copy | PO #, labor rate and type | PO #, urgency and type |
| Setup, Service rates, the sentence      | The ticket's Labor rate   | The ticket's Urgency   |
| Setup, Service rates, first column      | Rate kind                 | Urgency                |
| A ticket's History, new lines           | labor rate kind 'a' → 'b' | urgency 'a' → 'b'      |

The hover hint now reads: "Urgent and Emergency tickets go first on the Tech Board. Also sets the
hourly rates on the invoice."

## Left alone, on purpose

- "Tech / Helper labor rate" on Setup, Service rates: that one is dollars per hour.
- Every "Labor Rate" on the estimating side (bids, Non Duro-Last pricing, Exceptional Metals).
- History already written. One older line still says "labor rate".

## Database

`supabase/migrations/20261113160000_history_urgency_wording.sql`: `audit_col_name()` gains one
case, `labor_rate_kind` reads "urgency". Applied on the live database Nov 13 and checked:

- The live function's hash matches the file (00a73d212484ddf96ceb91a169e06e58).
- `audit_col_name` still answers "property", "technician", "po number" and "signature" for the
  columns it answered before.
- In a block rolled back on purpose, a ticket numbered 999999 was made and its choice changed.
  The History line read "Ticket 999999 urgency 'standard' → 'urgent'". Nothing was kept and the
  ticket counter was not used.

## Proof

- `src/lib/urgency-wording-nov13j.test.ts`: 9 tests. 5 fail with the three screen files put back
  to the old code.
- Older pins updated: `ticket-form.test.ts`, `service-rates-layout.test.ts`.
- Full chain: prettier, eslint (0 errors, the 16 known warnings), types, 547 files / 7,146 tests,
  build.
- Browser, signed in as the test login, nothing saved: the new-ticket form shows "Urgency" with
  Standard, Urgent and Emergency; "Labor rate" appears nowhere on it. Setup, Service rates shows
  "Urgency" as the first column and in its sentence; "Rate kind" appears nowhere on it.
