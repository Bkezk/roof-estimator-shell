-- Four more ticks under "Which notices you get" (owner, Nov 24: "we also need notifications for
-- a new opportunity", and "go on 1, 2 ... 3 go" on a tick for a request from the public pages,
-- one for the Roof Care plan's payment and expiry, and one for no access at a plan inspection).
--
-- The database's own list of the keys a person may turn off grows by four. It is the same
-- list, in the same order, as NOTICE_TYPE_KEYS in src/lib/notice-types.ts (a test keeps the two
-- the same). Nothing else changes: no column, no row, no grant.

create or replace function public.notice_fine_keys()
returns text[] language sql stable set search_path = public as $$
  select array[
    'service_opened',
    'service_assigned_me',
    'service_reassigned',
    'service_scheduled',
    'service_date_moved',
    'service_reminders',
    'service_not_started',
    'service_nobody',
    'service_done',
    'service_authorized',
    'service_ready_to_invoice',
    'service_invoiced',
    'service_closed',
    'service_moved_back',
    'service_deleted',
    'service_care_no_access',
    'opportunities_assigned_me',
    'opportunities_follow_up',
    'opportunities_not_started',
    'opportunities_nobody',
    'opportunities_steps',
    'opportunities_new',
    'opportunities_public_request',
    'opportunities_care_plan',
    'bids_due_soon',
    'bids_past_due',
    'bids_my_reminders',
    'bids_steps'
  ]::text[];
$$;

revoke all on function public.notice_fine_keys() from public, anon, authenticated;
