-- The manager-only trigger on crm_followups guards more columns (the seventh audit, Oct 21;
-- owner approved item 4). crm_followups_manager_only (20261002140000_followup_guard.sql) refused
-- a signed-in non-manager who changed snoozed_until / status / closed_by_sync, the reminder
-- fields (due_at, next_remind_at, every_days, reminders_sent, last_reminded_at) and what the
-- follow-up is for (assignee_id, kind, item_id) — but not title, url, account_id, the hold's
-- record (hold_reason, hold_via, held_by, held_by_name, held_at, hold_count; 20261009150000) or
-- the close's reason and time (closed_reason, closed_at). crm_followups_update
-- (20261021090000_followups_write_split.sql) lets the assignee update their own row, so a
-- technician could, with one direct REST PATCH, make their follow-up read "On hold … held by
-- <manager>" with any reason, or rename it and point its link anywhere (proved live as the
-- technician-only test login, rolled back).
--
-- The same function, with those columns refused too, under the same bypass set: the system
-- (followup_is_system: the service role, or SQL with no request), an admin, a manager, or the
-- transaction-local flag jbk.followup_sync the app's own functions set. Who legitimately writes
-- each column, and why they keep working:
--   title, url, account_id   followup_sync_upsert (20261002140000; SECURITY DEFINER, sets the
--                            flag before its update / insert) — the refresh of what the item is
--                            called; and followups.server.ts syncFollowup's pre-migration
--                            fallback, through the admin client (service role → the system).
--   hold_reason, hold_via, held_by, held_by_name, held_at, hold_count
--                            hold_followup (20261009150000; SECURITY DEFINER, its own check —
--                            an admin / a manager, or the assignee for a logged contact — then
--                            the flag). SECURITY DEFINER changes neither auth.uid() nor
--                            is_manager(), so the flag is what lets it through, as it did for
--                            snoozed_until / next_remind_at before.
--   closed_reason, closed_at followup_sync_close and followup_sync_upsert's hand-over (the
--                            flag); followups.functions.ts closeFollowup, a manager's
--                            (canManageFollowup → is_admin / is_manager); the admin client's
--                            fallback close in followups.server.ts.
-- Left open on purpose: dispatch_errors, last_dispatch_error, last_dispatch_error_at — the
-- reminder pass's own diagnostics (notify.server.ts recordFailure), which the preview runs as
-- the signed-in user (no service key there); they say nothing about the follow-up itself.
-- No app path writes any other column of crm_followups through a user token, so nothing that
-- works today stops working.
--
-- Idempotent: `create or replace` of the one function; the three triggers of 20261002140000
-- (before update / delete / insert) stay bound to it and are not touched. Pinned by
-- src/lib/work-overview-oct21-audit7-data.test.ts.
create or replace function public.crm_followups_manager_only()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.followup_is_system() or public.is_admin() or public.is_manager()
     or coalesce(current_setting('jbk.followup_sync', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    raise exception 'A follow-up is started by the app when an item is assigned'
      using errcode = '42501';
  end if;
  -- A snooze, a close by hand, a reopen, or the sync's marker set by hand (Oct 2); Oct 21: the
  -- close's reason and time as well.
  if new.snoozed_until is distinct from old.snoozed_until
     or new.status is distinct from old.status
     or new.closed_by_sync is distinct from old.closed_by_sync
     or new.closed_reason is distinct from old.closed_reason
     or new.closed_at is distinct from old.closed_at then
    raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501';
  end if;
  -- The reminder fields, and what the follow-up is for and whose it is (Oct 2).
  if new.due_at is distinct from old.due_at
     or new.next_remind_at is distinct from old.next_remind_at
     or new.every_days is distinct from old.every_days
     or new.reminders_sent is distinct from old.reminders_sent
     or new.last_reminded_at is distinct from old.last_reminded_at
     or new.assignee_id is distinct from old.assignee_id
     or new.kind is distinct from old.kind
     or new.item_id is distinct from old.item_id then
    raise exception 'Only a manager can change a follow-up''s reminders' using errcode = '42501';
  end if;
  -- What the follow-up says (its title, link and customer) and the hold's record (Oct 21): the
  -- sync and hold_followup write these under the flag; nobody writes them by hand.
  if new.title is distinct from old.title
     or new.url is distinct from old.url
     or new.account_id is distinct from old.account_id
     or new.hold_reason is distinct from old.hold_reason
     or new.hold_via is distinct from old.hold_via
     or new.held_by is distinct from old.held_by
     or new.held_by_name is distinct from old.held_by_name
     or new.held_at is distinct from old.held_at
     or new.hold_count is distinct from old.hold_count then
    raise exception 'Only a manager can change what a follow-up says or its hold'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.crm_followups_manager_only() from public;
