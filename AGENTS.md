<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep SQL-nullable and overloaded RPC contract corrections in `src/lib/database-rpc.ts`; generated database types remain untouched and calls retain the original client and authorization.
- Database changes are applied by hand: a file under `supabase/migrations/` does not change the live database until its statements are run through the Lovable database tool and checked. If a change cannot be run, list it in `docs/PENDING-DATABASE.md` so the next session applies it.
- Roof Care plans, the public QR forms and referral credit are being built in steps: read `docs/roof-care-plans.md` first. Its prices and costing numbers are kept out of the repository, in the admin-only table `office_reference_notes` on the live database.
- Waiting on the owner. He asked on Nov 19 to be reminded: say these at the end of a session's report until each is done, and take one off this list only when it is proven done.
  - `GOOGLE_MAPS_API_KEY` in Lovable Cloud › Secrets (a Google Routes API key). Without it the drive behind a Roof Care price comes from a free public router that may not answer, and the price is then marked an estimate.
  - A Stripe account in the company's name, test mode first. The site's side is built (Nov 19, `src/lib/roof-care-checkout.ts`): a customer who picks Card at the Roof Care sign-up is sent to Stripe checkout, and the payment starts the plan. It stays off until he does three things: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Lovable Cloud › Secrets by his hand, and in Stripe a webhook endpoint at the site's address plus `/api/stripe/webhook` for the events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Then prove one test payment end to end before it is called done. Still to build with it: renewing by itself, its notice to the office, its discount in dollars, and changing plans (`docs/roof-care-plans.md`).
  - `RESEND_API_KEY` in Lovable Cloud › Secrets, and `NOTIFY_FROM_EMAIL` on a domain verified with Resend. Without them the site sends no email: not the Roof Care agreement and receipt to the customer, and not the staff's notices.
