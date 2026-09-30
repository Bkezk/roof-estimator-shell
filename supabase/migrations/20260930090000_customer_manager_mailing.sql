-- Customers (owner, Sep 30, from the office):
--   1. An account manager on each customer account (any user in profiles).
--   2. (UI only) Sites are added on the account after it is created, not in the new-customer form.
--   3. A mailing address beside the physical one (address1..zip), with "Same as physical"; a cell
--      phone beside the office phone (`phone`); and no customer without an email or a phone.
--
-- RLS: no policy changes. The new columns ride on the existing crm_accounts policies.
-- `crm_user_options()` is SECURITY DEFINER because the profiles policy hides other users' rows
-- from non-admins (the same reason as technician_options / estimator_names); it returns only
-- id, name and email, and only to users who can read customers.

alter table public.crm_accounts
  add column if not exists account_manager_id uuid references public.profiles(id) on delete set null,
  add column if not exists mobile text,
  add column if not exists mailing_same boolean not null default true,
  add column if not exists mailing_address1 text,
  add column if not exists mailing_address2 text,
  add column if not exists mailing_city text,
  add column if not exists mailing_state text,
  add column if not exists mailing_zip text;

create index if not exists crm_accounts_account_manager_idx
  on public.crm_accounts (account_manager_id);

-- "Same as physical" stores no mailing address of its own.
alter table public.crm_accounts drop constraint if exists crm_accounts_mailing_same_blank;
alter table public.crm_accounts add constraint crm_accounts_mailing_same_blank check (
  not mailing_same
  or (mailing_address1 is null and mailing_address2 is null and mailing_city is null
      and mailing_state is null and mailing_zip is null)
);

-- A live customer needs a way to reach them: an email, a cell phone or an office phone (blank
-- text does not count). Deleted rows are exempt so an old customer without one can still be
-- deleted. NOT VALID: existing customers without one are left alone until next saved, when the
-- office is asked for one (the check applies to every insert and update from now on).
alter table public.crm_accounts drop constraint if exists crm_accounts_contact_required;
alter table public.crm_accounts add constraint crm_accounts_contact_required check (
  deleted_at is not null
  or nullif(btrim(email), '') is not null
  or nullif(btrim(phone), '') is not null
  or nullif(btrim(mobile), '') is not null
) not valid;

-- Everyone who can be an account manager, for the pickers and the Customers filter.
create or replace function public.crm_user_options()
returns table (id uuid, full_name text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email
    from public.profiles p
   where public.has_access('customers') or public.has_access('service')
      or public.has_access('estimate')
   order by coalesce(nullif(trim(p.full_name), ''), p.email);
$$;
revoke all on function public.crm_user_options() from public;
grant execute on function public.crm_user_options() to authenticated;
