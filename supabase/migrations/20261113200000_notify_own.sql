-- Notices about your own changes (owner, Nov 13: "notifications should go out to myself even if
-- im the one who did it").
--
-- The site has never told a person about what they did themselves: assign a ticket to yourself
-- and no "Assigned to you" arrives. That stays the rule for everyone who does not ask otherwise.
-- One more per-person switch on My account, off by default:
--
-- 1. profiles.notify_own (boolean, not null, default false). On: the person is also told about
--    their own changes (an assignment to themselves, their own ticket marked done when they are a
--    reviewer, a date they moved on their own ticket, a task or a mention they wrote for
--    themselves). The senders read it (src/lib/own-notices.server.ts).
-- 2. set_my_notify_own(p_on): the My account switch's save. SECURITY DEFINER on the caller's own
--    row, like set_my_notify_prefs (only admins may update profiles directly); returns the value
--    the row holds after the write.
--
-- Idempotent. Additive to the data: one column with a default, no row changes. The owner's own
-- switch is turned on by hand after this is applied (docs/qa/own-notices-2026-11-13.md).

alter table public.profiles add column if not exists notify_own boolean not null default false;

comment on column public.profiles.notify_own is
  'Owner, Nov 13: also notify this person about their own changes (assigning to themselves and the like); off by default';

create or replace function public.set_my_notify_own(p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_on boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'on or off is required' using errcode = '22004';
  end if;
  update public.profiles as p
     set notify_own = p_on
   where p.id = auth.uid()
  returning p.notify_own into v_on;
  if not found then
    raise exception 'Your profile was not found' using errcode = 'P0002';
  end if;
  return v_on;
end $$;

revoke all on function public.set_my_notify_own(boolean) from public, anon;
grant execute on function public.set_my_notify_own(boolean) to authenticated;
