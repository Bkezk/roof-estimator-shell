-- A won bid with a live invoice stays Won (owner, Nov 18, of the audit: "fix please").
--
-- A trade bid that had been invoiced could be set back to Draft or Lost. Its invoices stayed
-- live and collectable, and both the bid and the invoices dropped out of the Margin report.
-- The guard that already refuses deleting such a bid (20261117090000) now refuses taking it
-- off Won too. Void the invoice first, as for a delete.
--
-- SECURITY DEFINER as before: an estimator changes a bid's status and cannot read invoices.
-- Safe with the older site still published: it shows the refusal's words. Safe to run twice.
create or replace function public.bids_invoiced_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_numbers text;
  v_leaving_won boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_leaving_won := old.status = 'won' and new.status is distinct from 'won';
    if not (old.deleted_at is null and new.deleted_at is not null) and not v_leaving_won then
      return new;
    end if;
  end if;
  select string_agg(coalesce(i.display_number, i.number::text), ', ' order by i.created_at)
    into v_numbers
    from public.invoices i
   where i.bid_id = old.id and i.status <> 'void';
  if v_numbers is not null then
    if v_leaving_won and not (old.deleted_at is null and new.deleted_at is not null) then
      raise exception 'This bid has an invoice (%). Void the invoice before changing the bid from Won.',
        v_numbers using errcode = '23503';
    end if;
    raise exception 'This bid has an invoice (%). Void the invoice before deleting the bid.',
      v_numbers using errcode = '23503';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
drop trigger if exists bids_invoiced_guard on public.bids;
create trigger bids_invoiced_guard
  before delete or update of deleted_at, status on public.bids
  for each row execute function public.bids_invoiced_guard();
revoke all on function public.bids_invoiced_guard() from public, anon, authenticated;
