-- The Owner page's "Needs attention" list (owner, Nov 15: "keep the owner on top of things").
-- The list is read-only and sends nothing; these two numbers decide when a row appears on it
-- (src/lib/owner-attention.ts attentionLimits). Setup › Reminders edits them.
--
--   attention_bid_days        a submitted bid with no follow-up date ("Remind me on") shows this
--                             many days after it was sent (default 7).
--   attention_authorize_days  a Done ticket shows this many days after it was marked Done when
--                             nobody has authorized it (default 3).
--
-- The list's other limits already exist: ticket_untouched_days, opportunity_untouched_days and
-- unassigned_overdue_days.
alter table public.crm_settings
  add column if not exists attention_bid_days integer not null default 7;
alter table public.crm_settings
  add column if not exists attention_authorize_days integer not null default 3;

alter table public.crm_settings drop constraint if exists crm_settings_attention_bid_days_check;
alter table public.crm_settings
  add constraint crm_settings_attention_bid_days_check
  check (attention_bid_days between 0 and 365);
alter table public.crm_settings drop constraint if exists crm_settings_attention_authorize_days_check;
alter table public.crm_settings
  add constraint crm_settings_attention_authorize_days_check
  check (attention_authorize_days between 0 and 365);

comment on column public.crm_settings.attention_bid_days is
  'Owner page, Needs attention: a submitted bid with no follow-up date shows after this many days.';
comment on column public.crm_settings.attention_authorize_days is
  'Owner page, Needs attention: a Done ticket shows after this many days without being authorized.';
