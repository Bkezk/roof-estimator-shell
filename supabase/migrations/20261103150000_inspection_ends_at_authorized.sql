-- An inspection ends at Authorized, not Done (owner, Nov 3, after 20261103100000: "we may need
-- the authorized step just so the owner can see it was completed and signed off on it … when
-- authorized that's when it's considered done"). The Authorize timers that migration closed on
-- the live Done inspections (#6036, #6040, #6053) reopen as they were — the ticket still waits
-- for the sign-off — unless a newer one is already open for the ticket. The guard trigger
-- (20261002140000) takes a status change from the sync alone, so the sync's flag is set first.
select set_config('jbk.followup_sync', 'on', true);
update public.crm_followups f
   set status = 'open', closed_at = null, closed_reason = null, closed_by_sync = false
  from public.service_jobs j
 where j.id = f.item_id and f.kind = 'invoice' and f.status = 'closed'
   and f.closed_reason = 'an inspection ends at Done'
   and j.service_type = 'inspection' and j.stage = 'done' and j.deleted_at is null
   and not exists (
     select 1 from public.crm_followups o
      where o.item_id = f.item_id and o.kind = 'invoice' and o.status = 'open');
