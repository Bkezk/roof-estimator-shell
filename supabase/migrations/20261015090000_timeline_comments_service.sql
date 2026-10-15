-- The Contact box is a timeline (owner, Oct 14: "I kind of want this box to be a timeline for
-- both opps and service, so I'd like a comment button, and I'd like it to log and show when
-- service is completed and a brief summary there as well"). Two more contact-log methods:
--   comment — a note someone wrote on the timeline (the Comment button; @mentions tell people);
--   service — "Service done": written by the close-out with a brief summary, on the ticket and on
--             the opportunity the ticket was started from.
-- Neither is a contact: like 'note', they stamp nothing and move nothing. Applied live Oct 15.
alter table public.crm_contact_log drop constraint if exists crm_contact_log_method_check;
alter table public.crm_contact_log add constraint crm_contact_log_method_check
  check (method in ('called','texted','emailed','visited','other','note','comment','service'));

create or replace function public.crm_contact_log_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A note, a comment or a "service done" row is not a contact: nothing is stamped or moved.
  if new.method in ('note', 'comment', 'service') then
    return new;
  end if;
  if new.kind = 'ticket' then
    update public.service_jobs set contacted_at = new.at
     where id = new.item_id and (contacted_at is null or contacted_at < new.at);
    insert into public.service_job_events (service_job_id, kind, note, by_user, by_name, at, meta)
    values (new.item_id, 'contact', new.note, new.by_user, new.by_name, new.at,
            jsonb_build_object('method', new.method));
  else
    update public.crm_opportunities
       set contacted_at = greatest(coalesce(contacted_at, new.at), new.at),
           status = case when status = 'open' then 'contacted' else status end,
           updated_by_name = coalesce(new.by_name, updated_by_name)
     where id = new.item_id;
  end if;
  return new;
end $$;
