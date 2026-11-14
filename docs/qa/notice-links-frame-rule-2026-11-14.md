# Notification links and the frame rule, Nov 14 2026

Two fixes from the Nov 14 security audit. Owner: "Go with fixes for 1, 5".

## 1. A notification leads to a page of this site, or nowhere

**Found.** Any signed-in person may write a notification to another person. The task notices and
the office's notices need that. The link was whatever they wrote, and a click followed it as
written. On the published site a link that was a script ran in the reader's page, and a link to
another site took the reader there. A technician could have used it to act as an admin.

**Fixed in three places that agree.**

| Where | What |
| --- | --- |
| The database | `notifications_url_internal` (migration `20261114190000`): no link, or one "/" first, never "//" or "/\", no backslash or control character |
| The screens | `src/lib/notification-link.ts`: the bell and the Notifications page show a row with any other link as a row with no link |
| The click | never sends the browser to an address taken from a notification. It moves inside the app only |

**Proof.**

- Before the database rule, on the new code in a browser, four notices written to the test login:
  a script link, a link to another site, a "//" link, and a good link. In the bell and on the
  Notifications page the first three were shown with no link. Clicking them ran nothing and left
  the page where it was. The good one opened Account. The four rows were removed.
- The database rule is live. It was checked against all 214 existing notifications: none refused.
- In a rolled-back transaction the real technician account wrote to the owner. Refused: a script,
  another site, two slashes, slash backslash, the tab trick, the line break trick, no slash, an
  empty link. Accepted: a ticket link, "/", no link. The server's own key is refused the script
  too.
- The database rule protects the published site now. The screen changes arrive with the next
  publish.

## 5. Only the site itself may show the site in a frame

**Found.** The site sent no frame rule. A page on another address loaded the sign-in page inside
a frame, with the email box in it. That allows a trick page that hides the real site under false
buttons.

**Fixed.** Every response carries `Content-Security-Policy: frame-ancestors 'self'` and
`X-Frame-Options: SAMEORIGIN` (`src/lib/frame-rule.ts`, put on in `src/server.ts`). Lovable's
own preview address gets no rule, because the Lovable editor shows that address in a frame.
Nobody in the office signs in there.

**Proof, on the new code in a browser.**

- The sign-in page, a share link's refusal page and an API refusal all carry the rule.
- The same page asked for under Lovable's preview address carries none.
- A page on another address that frames the sign-in page gets a browser error page, with no
  email box inside.
- The site framing itself still loads.
- Bids, Documents, Service, Takeoff, the estimator, Customers and the proposal were opened: the
  browser reported no policy complaint.

This one is not live until the next publish.

## Checks

- 52 new tests in `src/lib/notification-link-nov14b.test.ts`. On the old wiring 5 of them fail.
- Lint 0 errors, types clean, 7,368 tests pass, the build succeeds.
