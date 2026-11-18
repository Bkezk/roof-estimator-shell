-- Four database rules brought in line with what the site already does (owner, Nov 18, of the
-- audit: "Close all four"). None of them changes what anyone sees or does on a screen.
--
-- 1. An inventory entry made by someone without Estimate access (a technician, the office) is
--    made now, by them, with the sign its reason has: stock coming in is above zero, stock
--    going out is below. An estimator's entries and a saved count are as they were.
-- 2. A bid's job number is given once, by the numbering function, when the bid is first
--    invoiced. Nothing else sets or changes it. (A bid's price stays the estimator's to set, as
--    it is on the bid itself; every change to a bid is kept in History.)
-- 3. The "nobody is on it" marks are read by the office, not by a technician-only login.
-- 4. An Activity entry is "Viewable to technicians" only on a ticket, only on an entry a person
--    makes, and only from someone who works tickets (Service access, a manager or an admin).
--
-- Safe with the older site still published. Safe to run twice.

-- 1 ---------------------------------------------------------------------------------------------
drop policy if exists inventory_movements_insert on public.inventory_movements;
create policy inventory_movements_insert on public.inventory_movements
  for insert to authenticated
  with check (
    (select public.has_access('estimate'))
    or (
      ((select public.has_access('inventory')) or (select public.has_access('service')))
      and (
        reason in ('leftover', 'received', 'consumed', 'transfer_out', 'transfer_in')
        or (reason = 'released' and service_job_id is not null)
      )
      and created_by = (select auth.uid())
      and count_id is null
      and created_at between now() - interval '5 minutes' and now() + interval '5 minutes'
      and case when reason in ('consumed', 'transfer_out') then qty < 0 else qty > 0 end
    )
  );

-- 2 ---------------------------------------------------------------------------------------------
create or replace function public.bids_trade_number_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  -- The numbering function, and the system itself (a restore: nobody is signed in).
  if coalesce(current_setting('jbk.trade_number', true), '') = 'on' or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.trade_number is not null then
      raise exception 'A bid is given its job number when it is first invoiced'
        using errcode = '42501';
    end if;
  elsif new.trade_number is distinct from old.trade_number then
    raise exception 'A bid''s job number cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$function$;
drop trigger if exists bids_trade_number_guard on public.bids;
create trigger bids_trade_number_guard
  before insert or update of trade_number on public.bids
  for each row execute function public.bids_trade_number_guard();
revoke all on function public.bids_trade_number_guard() from public, anon, authenticated;

-- The numbering function, unchanged but for the flag around its own write.
create or replace function public.trade_bid_number(p_bid uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_bid public.bids%rowtype;
begin
  if not (public.is_admin() or public.is_manager() or public.is_sales_pm()) then
    raise exception 'Only an admin, a manager or someone with Invoices access makes an invoice'
      using errcode = '42501';
  end if;
  select * into v_bid from public.bids where id = p_bid for update;
  if not found or v_bid.deleted_at is not null then
    raise exception 'Bid not found (it may have been deleted)' using errcode = 'P0002';
  end if;
  if v_bid.kind <> 'trade' then
    raise exception 'Only a trade bid is invoiced from the bid' using errcode = '22023';
  end if;
  if v_bid.status <> 'won' then
    raise exception 'Mark the bid Won before invoicing it' using errcode = '22023';
  end if;
  if v_bid.trade_number is null then
    perform set_config('jbk.trade_number', 'on', true);
    update public.bids
       set trade_number = nextval('public.trade_bid_number_seq')
     where id = p_bid
    returning trade_number into v_bid.trade_number;
    perform set_config('jbk.trade_number', '', true);
  end if;
  return v_bid.trade_number;
end;
$function$;

-- 3 ---------------------------------------------------------------------------------------------
drop policy if exists unassigned_marks_read on public.unassigned_marks;
create policy unassigned_marks_read on public.unassigned_marks for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_manager())
    or (
      ((select public.has_access('service')) or (select public.has_access('customers')))
      and not (select public.is_technician())
    )
  );

-- 4 ---------------------------------------------------------------------------------------------
drop policy if exists crm_contact_log_insert on public.crm_contact_log;
create policy crm_contact_log_insert on public.crm_contact_log for insert to authenticated
  with check (
    by_user = (select auth.uid())
    and (
      (kind = 'ticket' and exists (select 1 from public.service_jobs j where j.id = item_id))
      or (kind = 'opportunity'
          and exists (select 1 from public.crm_opportunities o where o.id = item_id))
    )
    and (
      not tech_visible
      or (
        kind = 'ticket'
        and method not in ('note', 'service')
        and ((select public.is_admin()) or (select public.is_manager())
             or (select public.has_access('service')))
      )
    )
  );
