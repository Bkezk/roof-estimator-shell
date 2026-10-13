-- Owner, Oct 13: "On CenterPoint you can create a shareable link for the invoice, can we have
-- that as well?" A final / sent / paid invoice can carry one share token; whoever has the link
-- (GET /i/<token>, src/routes/i.$token.ts) gets the stored PDF in the browser with no login. The
-- office makes the link from the invoice (createInvoiceShareLink, invoices.functions.ts), copies
-- it, sees whether it was viewed, and turns it off (revokeInvoiceShareLink clears the token; the
-- view counts stay). Sending the invoice makes the link too and puts it in the email. Idempotent.
--
-- 1. Four columns on invoices: share_token (32 random bytes as base64url, 43 characters; null =
--    no link), share_created_at, share_views, share_last_viewed_at. A live token is unique
--    (partial unique index; a null is no link, not a duplicate).
-- 2. invoice_share_viewed(p_token): the public route's view counter — SECURITY DEFINER, the
--    service role's alone (the route reads with the admin client; anon and authenticated never
--    call it). It touches share_views and share_last_viewed_at only, and only on an invoice whose
--    link is live (a token on a final / sent / paid invoice).
-- 3. This file leaves the audit trigger (invoices_audit → audit_row()) and the table's other
--    triggers exactly as they are. audit_row() lists the columns it ignores in a hard-coded
--    constant (v_skip) and, on an UPDATE, writes nothing when every changed column is in that
--    list; share_views and share_last_viewed_at are added to v_skip by the next migration,
--    20261013150000_audit_skip_share_views.sql, which also keeps a view from moving the
--    invoice's updated_at, so a customer's look at the link is silent: no audit row, no "last
--    changed" stamp. Making and turning off a link is logged as a change someone made
--    (share_token and share_created_at stay audited), which is wanted.

-- 1. ------------------------------------------------------------------------------------------
alter table public.invoices
  add column if not exists share_token text,
  add column if not exists share_created_at timestamptz,
  add column if not exists share_views integer not null default 0,
  add column if not exists share_last_viewed_at timestamptz;

create unique index if not exists invoices_share_token_key
  on public.invoices (share_token) where share_token is not null;

comment on column public.invoices.share_token is
  'Owner, Oct 13: the share link''s token (32 random bytes, base64url, 43 chars) — GET /i/<token> serves the stored PDF with no login while the invoice is final / sent / paid. Null = no link (never made, or turned off).';
comment on column public.invoices.share_created_at is
  'Owner, Oct 13: when the current share token was made (createInvoiceShareLink, or Send). Cleared with the token.';
comment on column public.invoices.share_views is
  'Owner, Oct 13: how many times the share link was opened (invoice_share_viewed). Kept when the link is turned off.';
comment on column public.invoices.share_last_viewed_at is
  'Owner, Oct 13: the last time the share link was opened (invoice_share_viewed). Kept when the link is turned off.';

-- 2. ------------------------------------------------------------------------------------------
-- The view counter: the public route's (service role) only. Bumps the two counters alone, on a
-- live link alone; a token nobody holds changes nothing. Silent in the audit log and for the
-- updated_at stamp once 20261013150000_audit_skip_share_views.sql has run (see 3 above).
create or replace function public.invoice_share_viewed(p_token text)
returns void language sql security definer set search_path = public as $$
  update public.invoices
     set share_views = share_views + 1,
         share_last_viewed_at = now()
   where share_token = p_token
     and status in ('final', 'sent', 'paid')
     and (coalesce(auth.role(), '') = 'service_role'
          or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated')));
$$;
revoke all on function public.invoice_share_viewed(text) from public;
revoke all on function public.invoice_share_viewed(text) from anon;
revoke all on function public.invoice_share_viewed(text) from authenticated;
grant execute on function public.invoice_share_viewed(text) to service_role;
comment on function public.invoice_share_viewed(text) is
  'Owner, Oct 13: counts a view of an invoice''s share link (share_views + 1, share_last_viewed_at = now) on a final / sent / paid invoice. The service role''s only; the public route /i/<token> calls it after serving the PDF.';
