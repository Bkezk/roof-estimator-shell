-- Service phase B, part 1 (docs/service-module-design.md §11, owner Sep 26–27): follow-up
-- timers with reminders by email and push, opportunities (potential new customers), the
-- admin reminder settings, and the notification plumbing (in-app inbox, push subscriptions,
-- server-only secrets for the push signing keys). Idempotent.

-- Secrets the server reads with the service role (VAPID push keys). RLS on, no policies: no
-- client, however signed in, can read or write a row.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;

-- Per-user reminder channels (owner: email + push; text later, if ever).
alter table public.profiles add column if not exists notify_email boolean not null default true;
alter table public.profiles add column if not exists notify_push boolean not null default true;

-- Admin reminder settings, one row. Lengths are per item type (owner, Sep 26).
create table if not exists public.crm_settings (
  id integer primary key default 1 check (id = 1),
  opportunity_close_days integer not null default 30 check (opportunity_close_days between 1 and 365),
  opportunity_first_days integer not null default 3 check (opportunity_first_days between 0 and 365),
  opportunity_every_days integer not null default 7 check (opportunity_every_days between 1 and 365),
  ticket_first_days integer not null default 1 check (ticket_first_days between 0 and 365),
  ticket_every_days integer not null default 3 check (ticket_every_days between 1 and 365),
  -- The dispatcher's last pass (the lazy fallback throttles on it).
  last_dispatch_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.crm_settings (id) values (1) on conflict (id) do nothing;
alter table public.crm_settings enable row level security;
drop policy if exists crm_settings_read on public.crm_settings;
create policy crm_settings_read on public.crm_settings for select to authenticated using (true);
drop policy if exists crm_settings_write on public.crm_settings;
create policy crm_settings_write on public.crm_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Opportunities: a potential new customer (or new work for one), assigned to a user with an
-- expected close date; the follow-up timer runs until it is Won / Lost / No response.
create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.crm_accounts(id) on delete set null,
  title text not null,
  description text,
  assignee_id uuid references public.profiles(id) on delete set null,
  expected_close date,
  status text not null default 'open'
    check (status in ('open','contacted','quoted','won','lost','no_response')),
  lead_source text,
  est_value numeric,
  bid_id uuid references public.bids(id) on delete set null,
  notes text,
  created_by uuid default auth.uid(),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists crm_opportunities_assignee_idx on public.crm_opportunities (assignee_id, status);
create index if not exists crm_opportunities_account_idx on public.crm_opportunities (account_id);
drop trigger if exists crm_opportunities_updated_at on public.crm_opportunities;
create trigger crm_opportunities_updated_at before update on public.crm_opportunities
  for each row execute function public.update_updated_at_column();
alter table public.crm_opportunities enable row level security;
drop policy if exists crm_opportunities_read on public.crm_opportunities;
create policy crm_opportunities_read on public.crm_opportunities for select to authenticated
  using (public.has_access('customers') or public.has_access('estimate') or assignee_id = auth.uid());
drop policy if exists crm_opportunities_write on public.crm_opportunities;
create policy crm_opportunities_write on public.crm_opportunities for all to authenticated
  using (public.has_access('customers') or assignee_id = auth.uid())
  with check (public.has_access('customers') or assignee_id = auth.uid());

-- Follow-up timers: one open row per assigned item. Reminders fire at next_remind_at and then
-- every `every_days` until the item reaches a closing status (the server closes the row).
create table if not exists public.crm_followups (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ticket','opportunity')),
  item_id uuid not null,
  account_id uuid references public.crm_accounts(id) on delete set null,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  url text not null,
  due_at timestamptz not null,
  next_remind_at timestamptz not null,
  every_days integer not null default 3,
  reminders_sent integer not null default 0,
  last_reminded_at timestamptz,
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  closed_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_followups_open_item_idx
  on public.crm_followups (kind, item_id) where status = 'open';
create index if not exists crm_followups_due_idx on public.crm_followups (status, next_remind_at);
create index if not exists crm_followups_assignee_idx on public.crm_followups (assignee_id, status);
drop trigger if exists crm_followups_updated_at on public.crm_followups;
create trigger crm_followups_updated_at before update on public.crm_followups
  for each row execute function public.update_updated_at_column();
alter table public.crm_followups enable row level security;
drop policy if exists crm_followups_read on public.crm_followups;
create policy crm_followups_read on public.crm_followups for select to authenticated
  using (public.has_access('customers') or assignee_id = auth.uid());
drop policy if exists crm_followups_write on public.crm_followups;
create policy crm_followups_write on public.crm_followups for all to authenticated
  using (public.has_access('customers') or public.has_access('service') or assignee_id = auth.uid())
  with check (public.has_access('customers') or public.has_access('service') or assignee_id = auth.uid());

-- In-app inbox. Rows are written by the server; a user reads and marks their own.
create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  url text,
  followup_id uuid references public.crm_followups(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  email_sent_at timestamptz,
  email_error text,
  push_sent_at timestamptz,
  push_error text
);
create index if not exists notifications_user_idx on public.notifications (user_id, read_at, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- Web push subscriptions (one per browser / installed app), owned by the user.
create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  failed_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- The dispatcher (any office / service user) reads every subscription to send.
drop policy if exists push_subscriptions_dispatch on public.push_subscriptions;
create policy push_subscriptions_dispatch on public.push_subscriptions for select to authenticated
  using (public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
drop policy if exists push_subscriptions_dispatch_update on public.push_subscriptions;
create policy push_subscriptions_dispatch_update on public.push_subscriptions for update to authenticated
  using (public.has_access('customers') or public.has_access('service') or public.has_access('estimate'))
  with check (true);

-- The dispatcher needs every recipient's channels and email: a SECURITY DEFINER read that
-- returns only what sending needs, for users allowed to dispatch.
create or replace function public.notify_recipients(ids uuid[])
returns table (id uuid, email text, full_name text, notify_email boolean, notify_push boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name, p.notify_email, p.notify_push
    from public.profiles p
   where p.id = any(ids)
     and (public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
$$;
revoke all on function public.notify_recipients(uuid[]) from public;
grant execute on function public.notify_recipients(uuid[]) to authenticated;

-- The reminder pass may run as an office user (the preview has no service-role key; the
-- published app does): it marks other users' notification rows and stamps the last pass
-- through a SECURITY DEFINER function, settings themselves stay admin-only.
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.has_access('customers') or public.has_access('service') or public.has_access('estimate'))
  with check (user_id = auth.uid() or public.is_admin() or public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
create or replace function public.stamp_dispatch()
returns void language sql security definer set search_path = public as $$
  update public.crm_settings set last_dispatch_at = now() where id = 1
    and (public.has_access('customers') or public.has_access('service') or public.has_access('estimate'));
$$;
revoke all on function public.stamp_dispatch() from public;
grant execute on function public.stamp_dispatch() to authenticated;

-- Owner, Sep 27 (automation): a ticket reaching Done opens an "Invoice ticket #" follow-up for
-- the office (kind 'invoice') and tells office users; it closes when the invoice goes out.
alter table public.crm_followups drop constraint if exists crm_followups_kind_check;
alter table public.crm_followups add constraint crm_followups_kind_check check (kind in ('ticket','opportunity','invoice'));
