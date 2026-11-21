-- Roof Care: card money that has to go back can be marked as sent back (owner, Nov 20: "go
-- with ... new issue 1").
--
-- A card payment that should not have been taken is kept in roof_care_card_payments as money
-- to send back (20261120620000): one for a plan already paid, one for a plan that had ended,
-- one that did not cover what was owed, and the part of a payment over what was owed. The
-- admins and managers are told once. After that nothing showed which amounts were still owed,
-- and there was no way to say "this one went back".
--
--   roof_care_card_sent_back(payment, day, reference)   a manager or an admin only. The payment
--       has money to go back that is not marked yet. The day is today or earlier, and not
--       before the payment came in. Who marked it is kept (sent_back_by_name).
--
-- What is owed back of a row: its whole amount when it is "send_back", and the part over what
-- was owed (`over`) when it started the plan. The Owner page's Needs attention lists each one
-- until it is marked, and the plan's card has the button.

alter table public.roof_care_card_payments
  add column if not exists sent_back_by_name text;

create or replace function public.roof_care_card_sent_back(
  p_payment uuid, p_on date, p_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  c public.roof_care_card_payments%rowtype;
  v_name text;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_manager()) then
    raise exception 'Only a manager or an admin marks card money as sent back'
      using errcode = '42501';
  end if;
  select * into c from public.roof_care_card_payments where id = p_payment for update;
  if not found then
    raise exception 'That card payment was not found';
  end if;
  if not (c.outcome = 'send_back' or coalesce(c.over, 0) > 0) then
    raise exception 'Nothing of that card payment is owed back';
  end if;
  if c.sent_back_on is not null then
    raise exception 'That card payment was already marked sent back on %.',
      to_char(c.sent_back_on, 'Mon FMDD, YYYY');
  end if;
  if p_on is null or p_on > v_today then
    raise exception 'Pick the day the money was sent back, today or earlier';
  end if;
  if p_on < c.paid_on then
    raise exception 'The money cannot have gone back before it came in on %.',
      to_char(c.paid_on, 'Mon FMDD, YYYY');
  end if;
  select coalesce(nullif(trim(pr.full_name), ''), pr.email, '') into v_name
    from public.profiles pr where pr.id = auth.uid();
  update public.roof_care_card_payments
     set sent_back_on = p_on,
         sent_back_ref = nullif(trim(coalesce(p_ref, '')), ''),
         sent_back_by_name = coalesce(v_name, '')
   where id = p_payment;
end;
$function$;

revoke all on function public.roof_care_card_sent_back(uuid, date, text) from public, anon;
grant execute on function public.roof_care_card_sent_back(uuid, date, text) to authenticated;

notify pgrst, 'reload schema';
