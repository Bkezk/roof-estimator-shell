# Keys, secrets and outside accounts: where each one comes from

The owner, Nov 23, 2026: "we also need to be sure all our API key originations are recorded ...
for easy reference".

**This page holds names only. No key, password or token is ever written here, in the repository,
or in a chat.** A value lives only where the "Kept in" column says. If one is lost, make a new
one at its origin, put it where it is kept, publish, and delete the old one at its origin.

After any change to a secret in Lovable Cloud, **publish**: the live site reads its secrets when
it is published.

## 1. Keys from an outside service

| Name                                  | Comes from                                                                                                                 | What the site uses it for                                                                                                      | Kept in                 | State on Nov 23, 2026                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | --------------------------------------------------- |
| `RESEND_API_KEY`                      | resend.com, API keys, Create API key. Permission: Sending access. Domain: `jbkbid.com`.                                    | Every email the site sends: staff notices and reminders, Roof Care agreements, receipts and payment links, invoices.           | Lovable Cloud › Secrets | Set. The live site reports "Email configured: Yes". |
| `GOOGLE_MAPS_API_KEY`                 | Google Cloud Console, APIs & Services, Credentials. The key is for the **Routes API**.                                     | Drive time by road for Roof Care prices and the public quote page. Without it, or over its daily limit, a free router answers. | Lovable Cloud › Secrets | Set and proven Nov 20.                              |
| `STRIPE_SECRET_KEY`                   | Stripe Dashboard, Developers, API keys. Test mode first.                                                                   | Opening the card payment page for a Roof Care plan.                                                                            | Lovable Cloud › Secrets | Not set. Waiting on the owner.                      |
| `STRIPE_WEBHOOK_SECRET`               | Stripe Dashboard, Developers, Webhooks, the endpoint `https://jbkbid.com/api/stripe/webhook`, its Signing secret.          | Proving that a "card was paid" message really came from Stripe.                                                                | Lovable Cloud › Secrets | Not set. Waiting on the owner.                      |
| `SAM_GOV_API_KEY`                     | sam.gov, sign in, Account Details, Public API Key (`docs/sam-gov-federal-leads.md`).                                       | Federal roofing leads on the Leads page.                                                                                       | Lovable Cloud › Secrets | Not checked this session.                           |
| `PLANROOM_EMAIL`, `PLANROOM_PASSWORD` | A free login, not a key: registered on the State of KY planroom and on Lynn Imaging's planroom (`docs/planroom-login.md`). | Reading each open roof job's contacts and plan holders for the Leads page.                                                     | Lovable Cloud › Secrets | Not checked this session.                           |

The two Stripe values must come from the same side of Stripe: both from test mode, or both from
live mode (Nov 24, 2026). The site takes a "card was paid" message only from the side its key is
from. One from the other side records nothing, and the admins and managers are told.

How the two Stripe values are made (Nov 24, 2026, checked against Stripe's own pages that day):

- `STRIPE_SECRET_KEY` is best a restricted key, not the full secret key: Stripe recommends it.
  It needs one permission, Checkout Sessions: Write. The site only ever opens a payment page
  with it. A restricted key starts with `rk_`; the site takes either kind.
- The webhook is made in Stripe under Workbench, Webhooks, "Create an event destination", for
  "Your account", with Snapshot events (the site does not read Thin events), sent to the
  endpoint above. Three events: `checkout.session.completed`,
  `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. The
  third is for a payment from a bank account that does not go through.
- Bank payments (ACH) are turned on or off in the Stripe account's payment method settings, by
  the owner. No key and no code changes with it.
- Stripe Tax is not used: a Roof Care plan is billed as a service with no sales tax. It is not
  turned on until the owner's accountant says a plan is taxable.

## 2. Passwords the owner made up himself

These come from no outside service. Each is a long password the owner chose. Where one is kept in
more than one place, every copy must be the same.

`BACKUP_SECRET` and `RESTORE_SECRET` must be at least 24 characters. A shorter one is treated as
not set: every caller is refused until it is made longer, and the site's own log in Lovable says
why. `CRON_SECRET` should be at least 16 characters: a shorter one still works, and the site's
log says to make it longer (Nov 24, 2026). A caller without the right password gets the same
plain refusal whether the password is missing, too short or wrong.

| Name             | What it guards                                                                 | Kept in                                                                                             |
| ---------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `CRON_SECRET`    | The timed runs started from GitHub: only a caller that knows it may start one. | Two places, which must match: Lovable Cloud › Secrets, and the GitHub repository's Actions secrets. |
| `BACKUP_SECRET`  | The nightly backup's door (`docs/backup/windows-server-setup.md`).             | Lovable Cloud › Secrets, and the backup server.                                                     |
| `RESTORE_SECRET` | The restore door, used only to put a backup back.                              | Lovable Cloud › Secrets, and the backup server.                                                     |

## 3. Settings that sit beside the keys but are not secret

| Name                   | Value                                                                                                                                    | Kept in                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `NOTIFY_FROM_EMAIL`    | Who emails say they are from: a name and an address on `jbkbid.com`, the domain verified in Resend.                                      | Lovable Cloud › Secrets                     |
| `APP_URL`              | `https://jbkbid.com`. Makes the links inside emails and phone notices open the site.                                                     | Lovable Cloud › Secrets                     |
| `APP_URL` (GitHub)     | The same address, for the backup reminder run and the nightly jobs.                                                                      | The GitHub repository's Actions secrets     |
| `NOTIFY_REPLY_TO`      | Optional. The inbox a reply to any of the site's emails goes to. Left out, it is the office's sales inbox, which is written in the code. | Lovable Cloud › Secrets, only if it changes |
| `NOTIFY_CONTACT_EMAIL` | Optional. The contact address given to the phone-notice services. Left out, the same sales inbox.                                        | Lovable Cloud › Secrets, only if it changes |

## 4. The GitHub repository's own secrets

GitHub, the repository, Settings, Secrets and variables, Actions.

| Name                              | What it is                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                         | The site's address. See part 3.                                                                                                                     |
| `CRON_SECRET`                     | The same password as in Lovable Cloud. See part 2.                                                                                                  |
| `LOADER_EMAIL`, `LOADER_PASSWORD` | A login of the site itself, with Prospecting access, made in Users & access. The nightly Kentucky and Tennessee building refreshes sign in with it. |

## 5. Made and kept by the systems themselves

Nobody types these, and nobody needs to look them up.

| Name                                                                    | Made by                                                                                                                | Kept in                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Lovable, for the database                                                                                              | Lovable Cloud, set by Lovable                            |
| `LOVABLE_CRON_SECRET`                                                   | Lovable, for its own scheduling                                                                                        | Lovable Cloud, set by Lovable                            |
| `vapid_public`, `vapid_private`                                         | The site, the first time a phone notice was sent                                                                       | The database table `app_secrets`, which no user can read |
| `reminder_timer_token`                                                  | The database, for its own half-hourly reminder timer. The site asks the database whether a caller's token is this one. | The database's vault                                     |

## 6. Outside accounts the business depends on

Who holds each login is the owner's to keep, outside the repository.

| Account                            | What it holds                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Lovable                            | The site, its database, its secrets, and the domain `jbkbid.com` with its DNS records.                                |
| Resend                             | Sending email from `jbkbid.com`. Its four DNS records were added in Lovable on Nov 23, 2026.                          |
| Google Cloud                       | The Routes API key and its billing.                                                                                   |
| GitHub                             | The code, its Actions secrets, and the nightly jobs.                                                                  |
| Stripe                             | The owner is opening an account in the company's name (Nov 24, 2026), apart from his other business's. Sandbox first. |
| sam.gov                            | The federal leads key.                                                                                                |
| The two planrooms                  | The login in part 1.                                                                                                  |
| The company's email provider       | The office inboxes on `flatroofonline.com`, the sales inbox that replies go to among them.                            |
| The `flatroofonline.com` registrar | That domain's DNS. The owner had no login for it in November 2026.                                                    |

## 7. Used with no key at all

For the record, so nobody goes looking for a key: the free road router that stands in for Google,
the U.S. Census address lookup, the storm reports of the national weather service, the public
map layers of buildings, and the public bid sites read for leads.
