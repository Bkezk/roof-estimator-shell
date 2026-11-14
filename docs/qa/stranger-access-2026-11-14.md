# Strangers get nothing (Nov 14)

Found while building Forgot password. Owner, told the finding: "Yes go ahead with those
suggestions."

## What was open

The sign-in service had **public sign-ups switched on**. The site has no sign-up page, but the
service would take one from someone who knows how to ask. Such an account has no profile.

Measured on the live database before any change:

| Caller | Could read |
| --- | --- |
| Signed in, no profile | nine tables (bid locks, county codes, data refreshes, inventory locations, movements and settings, lead sources, storm settings, vehicle drivers) |
| Signed in, no profile | every person's name and email, the estimators' names, every bid's name, every ticket's number with its customer name and description |
| Signed in, no profile | three views: the item-number map, the company's public details, the pricing units |
| Signed in, no profile | could write a "task" notice to anyone |
| No account at all | the estimators' names (seven staff names), with only the site's public key |
| No account at all | could call 97 database functions; all but that one answered nothing or refused |

Customers, tickets, bids, invoices, opportunities and profiles themselves were already closed to
both: 0 rows or refused.

## What was changed

1. **Public sign-ups are off.** A setting of the sign-in service, switched through Lovable's own
   settings tool with the other three settings written back exactly as they were (email
   confirmation required, anonymous sign-ins off, leaked-password check on; each read from the
   live service first).
2. **A real profile is required** (`supabase/migrations/20261114170000_profile_required.sql`,
   applied by hand and checked): the nine read rules, the task-notice insert, the four functions
   and the three views now ask `has_profile()`. The server's own key still passes.
3. **No database function runs without an account.** Execute is taken from the anonymous role
   and from PUBLIC on every function, and functions made later start the same way.

## Proof

Each change was first run in a transaction that was rolled back, comparing before and after, and
then applied.

**Who reads what, after (rows; X = refused).** Real roles read exactly what they read before.

| Caller | Nine tables | Four functions | Three views | Customers / tickets / bids |
| --- | --- | --- | --- | --- |
| Owner, manager, office | unchanged | 8 / 7 / 24 / 37 | 1,265 / 1 / 49 | unchanged |
| Technician | unchanged | 8 / 7 / 24 / 37 | 1,265 / 1 / 49 | 0 / 0 / 0, as before |
| Signed in, no profile | 0 everywhere | 0 / 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| No account | 0 everywhere | X / X / X / X | X / X / X | 0 or X |

- **Functions.** Callable with no account: 97 before, 0 after. Callable by a signed-in person:
  the same set before and after (fingerprint edbb2821…), plus the new `has_profile`. Callable by
  the server: the same set (fingerprint 6341645f…).
- **A function made now** cannot be run without an account and can be run by a signed-in person.
- **A task notice** from a technician is still written; from an account with no profile it is
  refused.
- **Through the public API**, as a stranger: `estimator_names`, `assignable_users`,
  `inventory_job_options`, `is_admin` and `crm_last_dispatch_at` each answer "permission denied".
- **Sign-ups.** The service now reports sign-ups off. A stranger's sign-up, an anonymous sign-in
  and a one-time-code sign-in for a new address were each refused (422), and no account was made
  (8 accounts before and after).
- **Adding a user still works.** On the published site, as the test admin, a temporary user was
  added through Users & access, appeared in the list, and was removed there. 8 accounts and 8
  profiles after, none left over.
- **The published site, as a real user:** 18 pages opened after the change, no failed data call,
  no error on screen.
- **Live functions match the file** (md5 of each body).

Tests: `src/lib/stranger-access-nov14.test.ts`, 23 tests pinning the applied file, including one
that fails if a later migration grants a function to the anonymous role again.

## Left as they are, on purpose

- A few settings-style functions (the reminder timing numbers, a price for one catalog cell) do
  not ask for a profile themselves. They can no longer be reached without an account, and an
  account with no profile can no longer be made.
- A person's own rows (their push devices, their notices) are theirs by id, as before.

## On the way

Lovable's assistant, asked for the one settings change, also pushed three small commits of its
own: a version bump of its build package, a refresh of the generated database types (which now
list the `buildings_search` view), and a notes file under `.lovable/`. The full check chain was
run on top of them.
