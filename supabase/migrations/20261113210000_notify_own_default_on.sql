-- "My own changes" is on for everyone (owner, Nov 13, asked whether it should stay opt-in: "It
-- should be on for everyone").
--
-- 20261113200000_notify_own.sql added profiles.notify_own off by default, with only the owner's
-- turned on. Now:
--   1. every person's switch is turned on;
--   2. a new person starts with it on.
-- The switch stays on My account, so anyone can still turn their own off
-- (set_my_notify_own, unchanged).
--
-- Idempotent. Changes data: one flag on every profiles row, to true.

alter table public.profiles alter column notify_own set default true;

update public.profiles set notify_own = true where notify_own is distinct from true;

comment on column public.profiles.notify_own is
  'Owner, Nov 13: also notify this person about their own changes (assigning to themselves and the like); on by default, each person may turn their own off';
