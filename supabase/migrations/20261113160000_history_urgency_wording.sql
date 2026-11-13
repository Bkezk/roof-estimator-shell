-- A ticket's History says "urgency" for its Standard / Urgent / Emergency choice (owner, Nov 13:
-- "can we change labor rate to urgency on the front end").
--
-- The ticket page's field is now labelled "Urgency"; a change to it was written to History as
-- "labor rate kind 'standard' → 'urgent'", the column's name with spaces. It now reads
-- "urgency 'standard' → 'urgent'". Wording only: the column keeps its name (labor_rate_kind) and
-- still picks the invoice's hourly rates.
--
-- New rows only: History already written is left as it is. The function is
-- 20261110213000_history_property_wording.sql's exactly, plus the one case.

create or replace function public.audit_col_name(p_col text)
returns text language sql immutable set search_path = public as $$
  select replace(
    case
      when p_col = 'site_id' then 'property'
      when p_col = 'site_name' then 'property_name'
      when p_col = 'site_address' then 'property_address'
      when p_col = 'location_id' then 'site'
      when p_col = 'location_name' then 'site_name'
      when p_col = 'labor_rate_kind' then 'urgency'
      when p_col in ('county_code_id', 'account_manager_id', 'assignee_id', 'technician_id',
                     'vendor_id', 'bill_to_vendor_id', 'account_id', 'contact_id',
                     'bid_id', 'opportunity_id', 'invoice_id')
        then left(p_col, -3)
      when p_col = 'signature_path' then 'signature'
      else p_col
    end, '_', ' ');
$$;
