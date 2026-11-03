-- An inspection ends at Done (owner, Nov 3: "inspections just need the steps open, scheduled,
-- and done"). Nobody reviews or invoices one, so the Authorize timer (crm_followups kind
-- 'invoice', "Authorize Ticket #…") opened when an inspection reached Done is closed, and none is
-- opened from now on (ticket-events.server.ts afterTicketStage; Work Overview and the Owner page
-- leave inspections out of Needs authorization).
update public.crm_followups f
   set status = 'closed', closed_at = now(), closed_reason = 'an inspection ends at Done',
       closed_by_sync = true
  from public.service_jobs j
 where j.id = f.item_id and f.kind = 'invoice' and f.status = 'open'
   and j.service_type = 'inspection';
