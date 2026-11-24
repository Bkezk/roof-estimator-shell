# Roof Care: a request starts its plan, the page finds the payment, and My tickets moves, Nov 24, 2026

The owner, late on Nov 24, with a picture of the opportunity a public Roof Care request makes:

- "this workflow is weird, if you click open the sign up after confirming or not confriming if
  theyre an exisitng customer it pops up the sign up window again, it should just ask us to
  confirm the roof size, then send the payment link and once paid the opp should flip to won."
- "once i paid for the plan on the card via the email that the office sent i had to manually
  refresh the customer page with the property to get it applied."
- "on the nav bar can we move my tickets to below work overview."
- "reset password worked btw."

## 1. A request starts its plan with no second sign-up

A customer on the public Roof Care page picks a plan, types the roof size, says how they pay and
ticks the terms. The office was then asked all of that again in the sign-up window.

- **Now.** The office says whose the request is, as before: "This is …" or "New customer". The
  plan they picked is then started from what they sent. The box says so before the press.
- A request that was already given its customer has one button: **Start the plan**.
- The plan is the same plan the window makes. The same function signs both. The price is read
  fresh for the size they typed, the size is checked against the map, a property has one plan,
  the agreement is emailed, and the office gets its "signed, not paid" notice.
- The first inspection is the usual choice: in the inspection window.
- **Then, on the opportunity itself,** the box shows the plan's steps: confirm the roof size,
  send the payment link, record the payment. Nothing has to be opened elsewhere.
- **Paid,** the opportunity turns Won. That was built on Nov 23 and is unchanged.
- **What still opens the window,** with the reason said beside its button: a request with no
  roof size typed (they picked a size range), and one ticked under older terms. "Change
  something first" opens the window for any request, to pick another first inspection or size.
- A roof much smaller than the map shows is refused as it is in the window, and the window is
  where a manager ticks that the size is right.

## 2. The page finds the payment by itself

The payment comes from the customer's own phone, so nothing on the office's screen knew to look.

- While a property's plan waits for its payment, its page reads the plan again every ten
  seconds. Not while the tab is in the background, and not for a plan that is not waiting.
- The moment the plan is found in force, the page says "The payment is in. The plan has started."
  once, and reads everything else on it again: the opportunity shows Won and the invoice shows
  paid with no reload by hand.

## 3. My tickets sits under Work Overview

It was the first row of the Customers group. It is now right under Work Overview, above the
groups. For a technician with no office role, who has no Work Overview, it is still the first
row of the menu, and the heading that would be left with nothing under it is not drawn.

## 4. Forgot password

The owner tried it from `jbkbid.com` and it worked. It is off the list of what waits on him.

## Proof

- Tests: `src/lib/roof-care-request-starts-plan-nov24.test.ts`, 19 tests. All fail on the code
  of that afternoon. Five older tests that pinned the old menu and the old words on the request
  box were changed to the new rule.
- Checks: lint 0 errors (16 warnings, as before), types clean, 682 test files and 10,454 tests
  pass, the build completes.
- In a browser on the test server, signed in, at desktop width and a phone's: the owner's own
  test request, which already had its customer, shows "Start the plan" and "Change something
  first". Nothing was pressed: it is his, and a press sends an agreement. The menu reads Work
  Overview, My tickets, Customers. No sideways scroll and no page error.

## Not proven

- A plan started from a request on the published site, and the page turning by itself after a
  payment. Both need the publish and one more test request from the owner.
