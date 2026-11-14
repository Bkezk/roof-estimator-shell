# Forgot password on the sign-in screen (Nov 14)

Owner: "Can you add a reset password on the login screen, some office users have forgotten their
password? Ensure it's secure and works properly."

## What was built

- **Sign-in screen:** "Forgot password?" beside the Password label. It asks for the email and has
  the sign-in service email a one-time link.
- **Reset page** (`/reset-password`): the link opens it. New password, typed twice, with a
  show / hide eye. After saving, the person is signed out everywhere and signs in with the new
  password.
- An administrator can still set anyone's password under Users & access, as before.

## How it is kept safe

- **The sign-in service does the sensitive part.** It makes the link, emails it, and lets it work
  once. The site never sees or stores a reset code.
- **Nothing is given away.** The page says the same words after every request the service took,
  whether or not the email has an account. That includes the service's refusals that only an
  account can get ("too many requests", "could not be delivered recently").
- **The link only comes back here.** Checked live: pointed at another site, the service sent the
  browser to this site's front page with an error instead.
- **One use.** Checked live: the same link a second time came back "expired".
- **A tab in a reset can do nothing else.** Wherever the link lands, the tab is taken to the reset
  page and no app page opens until a password is set. Walking away signs the tab out.
- **The address is wiped.** After the page opened, the address carried none of the link's secrets.
- **Password rules:** at least 8 characters, typed the same twice, not the email address or the
  name in front of it, not all spaces. The service's own refusals are put in plain words.
- **Everyone is signed out after.** Every session of that person is ended. Another device that
  was signed in could no longer renew its sign-in (400) and the service no longer knew it (403).
  A device already open keeps what it has on screen until its pass runs out, an hour at most.
- **The send button rests for 60 seconds** after a send and says so.

## Proof, on the test login only

Real browser against the live sign-in service. The test login's password was put back at the end
and signs in again.

| Step | Result |
| --- | --- |
| Ask for a link, from the published site's address | accepted; the service recorded a reset email sent |
| The link's first hop | to `jbkbid.lovable.app/reset-password`, marked as a reset, good for 3,600 s |
| The link landing on the front page | tab taken to the reset page; no menu; secrets gone from the address |
| Trying to open Bids mid-reset | back on the reset page |
| Too short, not matching, the email itself | each refused in plain words |
| A good password | saved; at the sign-in screen: "Your password was changed. Sign in with the new one." |
| Old password | "Incorrect email or password." |
| New password | signed in |
| The other signed-in device | could not renew (400); unknown to the service (403) |
| A used link | "This reset link has expired or was already used." |
| An email with no account | same words as for a real one; nothing sent |

Tests: `src/lib/password-reset-nov14.test.ts`, 27 tests, 7 fail on the old code. Full chain: 555
files, 7,291 tests, lint 0 errors, types, build. Five older tests pinned the gate's old lines and
were updated.

## Not proven

- **An email arriving in a real inbox.** The one real send went to the test login's address,
  which is not a real mailbox, and it bounced: the service now answers "could not be delivered
  recently" for it. So the sending system is switched on and tracks bounces, but delivery to an
  office inbox has not been seen. The owner should try it with their own email after publishing.
- **How long a link lasts.** The service's default is one hour. Not measured.
- **The "that is your current password" refusal** was not reached in the browser, because the
  test login's password is its own email and the email rule caught it first. Unit tested.

## Found on the way, not changed

The sign-in service reports that **public sign-ups are switched on** (`disable_signup: false`).
The site has no sign-up page, and no profile is made for a self-made account, so the app's pages
and server functions refuse it. But nine tables let any signed-in account read them without
looking at the profile: inventory locations, movements and settings, vehicle drivers, bid locks,
county codes, lead sources, storm settings and data refreshes. Whether a stranger can really
finish a sign-up was not tried (it would make a real account). Reported to the owner first.
