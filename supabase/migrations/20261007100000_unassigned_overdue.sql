-- Owner, Oct 7: "sometimes the front desk gets calls about opportunities and service so the
-- workflow should be they can put them in w/o assignment and then the managers/owners can see
-- that as a need assignment. there should be a timer in setup for when needs assignment should
-- get the overdue flag just by nature of being unassigned."
--
-- Work Overview lists nobody's tickets and opportunities under "Unassigned" for everyone but a
-- technician-only user; once one has waited this many days for a person it carries the Overdue
-- flag there (src/lib/my-work.ts unassignedOverdue). 0 = the day it is entered. Setup › Reminders.
alter table public.crm_settings
  add column if not exists unassigned_overdue_days integer not null default 1
    check (unassigned_overdue_days between 0 and 365);

comment on column public.crm_settings.unassigned_overdue_days is
  'Owner, Oct 7: a ticket or opportunity nobody is assigned to is flagged Overdue on Work Overview once it has waited this many days for a person.';
