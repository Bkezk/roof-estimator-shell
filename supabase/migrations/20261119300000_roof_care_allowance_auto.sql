-- Roof Care: the minor repairs allowance is ticked by itself (owner, Nov 19: "can we have the
-- tick auto ticked if there is still any allowance left?").
--
-- A repair invoice at a property whose plan has allowance left now takes it without being asked.
-- The answer kept on the invoice gains a third value for that: 'auto', beside the two a person
-- gives ('applied' with a typed amount, 'declined'). The rule that refuses Finalise stays as it
-- is: it lets any answer through, and still stops an invoice on which nothing was ever chosen.
alter table public.invoices
  drop constraint if exists invoices_care_allowance_choice_check;
alter table public.invoices
  add constraint invoices_care_allowance_choice_check
  check (care_allowance_choice is null
         or care_allowance_choice in ('auto', 'applied', 'declined'));
