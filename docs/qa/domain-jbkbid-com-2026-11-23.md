# The site moved to jbkbid.com, and the reminder timer with it (Nov 23, 2026)

The owner bought `jbkbid.com` through Lovable on Nov 23 and connected it to the project.

## What was checked

- `https://jbkbid.com/login` and `https://jbkbid.com/care` answer.
- `https://www.jbkbid.com` and the old `https://jbkbid.lovable.app` both send the visitor on to
  `https://jbkbid.com`. So old bookmarks and old links still open the site.

## What broke, and the fix

The reminder timer in the database called the site at the old address every half hour. From the
moment the domain was connected, the old address answered that call with a redirect to the new
one. The call carries its token in a header, and a redirect to another host drops that header.

- The 18:02 UTC run answered 200, as every run before it.
- The 18:32 UTC run was refused: 401 Unauthorized. No reminder pass ran.
- A request made by hand showed the redirect: a POST to the old address answers 307 with the new
  address as its location.

The timer now posts straight to `https://jbkbid.com/api/cron/reminders`
(`supabase/migrations/20261124300000_reminder_timer_new_domain.sql`). It was applied by hand at
19:00 UTC and matches the file by fingerprint. The 19:02 UTC run answered 200. One run was
missed, and the 19:02 run found nothing waiting.

Test: `src/lib/reminder-timer-domain-nov23.test.ts`. It fails without the new migration.

## Still to check, by the owner

- **GitHub's backup reminder run** reads the site's address from the repository secret
  `APP_URL`. Only he can change it. It should be `https://jbkbid.com`. With the old address the
  backup run gets the redirect, does nothing, and does not report a failure.
- **Forgot password**, once, from `jbkbid.com`: the email's link should come back to
  `jbkbid.com/reset-password`.
- **Phone notices.** A phone's permission belongs to the address it was given at. Each person
  may have to open `jbkbid.com`, add it to the home screen again and turn notices on again. Not
  tested.
- `https://jbkbid.com` typed into Setup › QR pages, and used for `APP_URL` in Lovable Cloud ›
  Secrets and for the Stripe webhook when those are set up.
