-- The History triggers for a property's inner sites and its warranties (owner, Oct 6). The
-- branches they need are in 20261006200000_audit_ticket_readable.sql's audit_row(); this runs
-- after it so a trigger never fires into a function without them. Both tables are logged as
-- entity 'site' under their property, so they appear in the customer's History fold. Idempotent.

drop trigger if exists property_sites_audit on public.property_sites;
create trigger property_sites_audit after insert or update or delete on public.property_sites
  for each row execute function public.audit_row();
drop trigger if exists site_warranties_audit on public.site_warranties;
create trigger site_warranties_audit after insert or update or delete on public.site_warranties
  for each row execute function public.audit_row();
