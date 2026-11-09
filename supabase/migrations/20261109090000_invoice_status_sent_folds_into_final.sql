-- Invoice statuses condensed (owner, Nov 9: "condense the invoice statuses, how would you know
-- the difference between final and sent?"): Draft → Final → Paid, with Void to the side. Sent is
-- a stamp (sent_at / sent_to / sent_by_name, kept as they are), not a status: a final invoice
-- shows when it was sent, or that it is not sent yet. Idempotent.

-- 1. Any invoice stored as 'sent' is a final invoice that was sent (none live on Nov 9).
update public.invoices set status = 'final' where status = 'sent';

-- 2. The check no longer admits 'sent'.
alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check check (status in ('draft', 'final', 'paid', 'void'));
