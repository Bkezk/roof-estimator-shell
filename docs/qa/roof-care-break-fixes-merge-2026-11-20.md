# Roof Care break test fixes: joining the three sets (Nov 20, 2026)

The fixes were built in three parts, each with its own record:

- `roof-care-break-fixes-payments-2026-11-20.md` (numbers 1, 13, 19, 22, 23, 24, 26, 28)
- `roof-care-break-fixes-plan-2026-11-20.md` (numbers 4, 7, 8, 9, 20, 21, 27, 29)
- `roof-care-break-fixes-tickets-2026-11-20.md` (numbers 16, 17, 18, 30)

This record is what joining them added.

## What was added

| What                                                                                                                                                                              | Where                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| The sign-up screen says the same first inspection the database gives (number 19): the window open today when two weeks of it are left, from today to its last day, else the next. | `nextWindow`, `firstVisitWords` in `src/lib/roof-care-plan.ts`; the radio label |
| A plan priced on a size typed by hand, with no map size to check it against, is on the Needs attention list until a manager or an admin confirms it (number 4).                   | `care_plan_size` in `src/lib/owner-attention.ts` and `.functions.ts`            |
| A technician's card sign-up finds its plan. A technician no longer reads the plans table, so the server asks the database whether the person sees the plan, then reads it itself. | `startPlanCheckout` in `src/lib/roof-care-checkout.functions.ts`                |
| Merging a customer moves its Roof Care plans with its properties. The plans used to keep naming the customer that was merged away.                                                | `merge_accounts`, migration `20261120730000`                                    |
| The note on an inspection ticket taken off the board at a renewal says "the renewal was reduced for it" only when something was taken off the renewal.                            | `roof_care_start`, migration `20261120730000`                                   |
| Wording: a billed storm inspection reads "and 1 more, not included: billed by itself"; an inspection with no invoice reads "is done and has no invoice".                          | `roof-care-benefits.ts`, `owner-attention.ts`                                   |

## Proof

- Tests: `src/lib/roof-care-break-fixes-merge-nov20.test.ts` (8), and the dated updates in
  `roof-care-plan-nov18.test.ts`, `roof-care-followups-nov19.test.ts`,
  `roof-care-pay-first-nov19.test.ts` and `roof-care-go-aheads-nov19.test.ts`.
- Database: every function of migrations `20261120600000` to `20261120730000` (36 names) has the
  same fingerprint on the live database as in its file.
- Rolled-back trial on the live database, as an admin, on two temporary customers and one
  temporary property with a plan in force:

  | Step                                             | Result                                    |
  | ------------------------------------------------ | ----------------------------------------- |
  | Delete the customer that has the plan            | Refused, naming the plan and the property |
  | Merge that customer into the other               | Done, 1 property moved                    |
  | The plan's customer                              | The customer that was kept                |
  | The merged customer                              | Deleted, pointing to the kept one         |
  | Delete the kept customer, which now has the plan | Refused                                   |

  Nothing of the trial was kept.
