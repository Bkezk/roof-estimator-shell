# Sign out all devices, and ticket notes with the ticket, Nov 14 2026

Two more changes from the Nov 14 security audit. Owner: "go with the sign out all devices
button per person" and "go with the technician fix pls".

## Sign out all devices

**Found.** A device that signs in stays signed in until someone signs out on it. 27 devices were
signed in, the oldest for 47 days. For a lost phone the only tool was removing the person.

**Added.** Users & access has a "Sign out all devices" button on every person's row, between
Set password and Remove. It asks first. It may be used on yourself.

| Part | What |
| --- | --- |
| The database | `sign_out_everywhere(p_user)` (migration `20261114210000`): ends the person's sign-ins and their renewal tokens, returns how many |
| Who may run it | only the server's key. A signed-in admin asking the database directly is refused, and so is a stranger |
| The server function | `signOutUserEverywhere`: checks the caller is an admin before anything else |
| The words | `src/lib/sign-out-everywhere.ts`: says "within the hour", never "at once" |

A device that is open at that moment holds a pass good for up to an hour. It cannot renew it.
Removing the person is still the instant cut.

**Proof.**

- The test login was signed in on two pretend devices. The database function, run with the
  server's key, ended its sign-ins: 0 sign-ins and 0 renewal tokens left for it. Other people's
  sign-ins were not touched by the filter.
- After that, both devices: renewing was refused (`refresh_token_not_found`), the sign-in
  service no longer knew the session (`session_not_found`), and the old pass still read the
  database, as the wording says it can for up to an hour.
- Signed-in people and strangers have no right to run the function.
- On the new code in a browser: 8 people, 8 buttons, the right question for yourself and for
  another person, and cancelling makes no call.
- Not proven yet: the button pressed all the way through on the published site. The local
  server has no server key, so that waits for the next publish.

## A technician reads a ticket's notes and hours only with the ticket

**Found.** A technician opens a ticket only when it is theirs or they are on its crew. The
ticket's photos and repairs follow that. Its activity notes and its time entries did not: anyone
with the Service page could read every row. No screen shows it, but a technician's sign-in used
directly against the database could. Measured: a technician on no ticket saw 0 tickets, 358
notes and 20 time entries.

**Fixed.** Both tables now have the rule the photos and repairs have (migration
`20261114200000`): office, managers and admins as before; a technician sees the rows of a live
ticket they lead or are on the crew of, and the rows they made themselves. Who may write is
untouched.

**Proof, on the live database.**

| Who | Notes | Time entries |
| --- | --- | --- |
| Technician on no ticket | 0, was 358 | 0, was 20 |
| Office | 358 | 20 |
| Manager | 358 | 20 |
| Admin | 358 | 20 |
| No profile | 0 | 0 |

In a rolled-back transaction with four temp tickets, the technician read the office's note on
the ticket they lead, the office's note on the ticket they crew, and their own note on someone
else's ticket. They did not read the office's note on someone else's ticket or on their own
deleted ticket. Time entries the same. They could still write a note and hours on their ticket.

Every technician screen reads these tables one ticket at a time, for a ticket the technician has
open, so no screen changes.

## Checks

- 18 new tests in `src/lib/sign-out-everywhere-nov14c.test.ts`. On the old code 9 fail.
- Lint 0 errors, types clean, 7,388 tests pass, the build succeeds.
