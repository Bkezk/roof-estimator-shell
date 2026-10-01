-- Tasks on a calendar with email notices (owner, Sep 30, item 11: "Due date on calendar and
-- generates email notifications. What you're going to do, property, calendar, attendee,
-- company, notes."). Idempotent.
--
-- A task now carries a company (crm_accounts) and a property (one of its crm_sites), a due date
-- AND time (due_at; all_day tasks sit at 08:00 America/New_York and show the date only), user
-- attendees (the assignee is always one) and outside attendee emails. due_date stays in sync
-- with due_at's local date for the older readers and writers (prospect.functions.ts). The
-- notified_* stamps make each email notice fire once (src/lib/tasks.ts dueTaskNotices).

do $$
declare
  fresh boolean;
begin
  fresh := not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'notified_created_at'
  );
  alter table public.tasks
    add column if not exists due_at timestamptz,
    add column if not exists all_day boolean not null default true,
    add column if not exists attendees uuid[] not null default '{}',
    add column if not exists external_emails text[] not null default '{}',
    add column if not exists account_id uuid references public.crm_accounts(id) on delete set null,
    add column if not exists account_name text,
    add column if not exists site_id uuid references public.crm_sites(id) on delete set null,
    add column if not exists site_name text,
    add column if not exists notified_created_at timestamptz,
    add column if not exists notified_morning_at timestamptz,
    add column if not exists notified_overdue_at timestamptz,
    add column if not exists notify_error text;
  if fresh then
    -- Existing tasks: due at 08:00 Eastern on their date, all day.
    update public.tasks
       set due_at = (due_date::timestamp + time '08:00') at time zone 'America/New_York',
           all_day = true
     where due_at is null and due_date is not null;
    -- A task made on the map had no assignee: it is its creator's.
    update public.tasks
       set assignee = created_by, assignee_name = coalesce(assignee_name, created_by_name)
     where assignee is null and created_by is not null;
    update public.tasks
       set attendees = array_append(attendees, assignee)
     where assignee is not null and not (assignee = any(attendees));
    -- They predate the notices: count what would already have gone out as sent, so the first
    -- reminder pass does not email a burst of old news.
    update public.tasks set notified_created_at = created_at;
    update public.tasks set notified_morning_at = now()
     where status = 'done' or due_date <= (now() at time zone 'America/New_York')::date;
    update public.tasks set notified_overdue_at = now()
     where status = 'done' or due_date < (now() at time zone 'America/New_York')::date;
  end if;
end $$;

create index if not exists tasks_due_at_idx on public.tasks (status, due_at);
create index if not exists tasks_attendees_idx on public.tasks using gin (attendees);
create index if not exists tasks_account_idx on public.tasks (account_id);

-- due_date <-> due_at, the assignee among the attendees, and a moved due time re-arms the
-- morning-of and morning-after notices.
create or replace function public.tasks_sync()
returns trigger language plpgsql set search_path = public as $$
declare
  local_time time;
begin
  if tg_op = 'INSERT' then
    if new.due_at is not null then
      new.due_date := (new.due_at at time zone 'America/New_York')::date;
    elsif new.due_date is not null then
      new.due_at := (new.due_date::timestamp + time '08:00') at time zone 'America/New_York';
      new.all_day := true;
    end if;
  else
    if new.due_at is distinct from old.due_at then
      new.due_date := case when new.due_at is null then null
                           else (new.due_at at time zone 'America/New_York')::date end;
    elsif new.due_date is distinct from old.due_date then
      -- An older writer moved the date only: keep the time of day.
      if new.due_date is null then
        new.due_at := null;
      else
        local_time := case when new.all_day or old.due_at is null then time '08:00'
                           else (old.due_at at time zone 'America/New_York')::time end;
        new.due_at := (new.due_date::timestamp + local_time) at time zone 'America/New_York';
      end if;
    end if;
    if new.due_at is distinct from old.due_at then
      new.notified_morning_at := null;
      new.notified_overdue_at := null;
    end if;
  end if;
  new.attendees := coalesce(new.attendees, '{}');
  new.external_emails := coalesce(new.external_emails, '{}');
  if new.assignee is not null and not (new.assignee = any(new.attendees)) then
    new.attendees := array_append(new.attendees, new.assignee);
  end if;
  return new;
end $$;
drop trigger if exists tasks_sync on public.tasks;
create trigger tasks_sync before insert or update on public.tasks
  for each row execute function public.tasks_sync();

-- Visibility (owner, Sep 30): the creator, the assignee and the attendees; admins and managers
-- see every task (is_manager() from 20260930093000_manager_role.sql).
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (
    created_by = auth.uid()
    or assignee = auth.uid()
    or auth.uid() = any(attendees)
    or public.is_admin()
    or public.is_manager()
  );
drop policy if exists tasks_write on public.tasks;
create policy tasks_write on public.tasks for all to authenticated
  using (
    created_by = auth.uid()
    or assignee = auth.uid()
    or auth.uid() = any(attendees)
    or public.is_admin()
    or public.is_manager()
  )
  with check (
    created_by = auth.uid()
    or assignee = auth.uid()
    or auth.uid() = any(attendees)
    or public.is_admin()
    or public.is_manager()
  );

-- The attendee roster: every user's id, name and email. SECURITY DEFINER because profiles RLS
-- hides other users' rows from non-admins.
create or replace function public.assignable_users()
returns table (id uuid, full_name text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email
    from public.profiles p
   where auth.uid() is not null or auth.role() = 'service_role'
   order by coalesce(nullif(trim(p.full_name), ''), p.email);
$$;
revoke all on function public.assignable_users() from public;
grant execute on function public.assignable_users() to authenticated, service_role;

-- Task notices reach any user, and are sent by the cron's service role (auth.uid() is null
-- there, so the page checks alone returned no recipients) or by whoever saves a task.
create or replace function public.notify_recipients(ids uuid[])
returns table (id uuid, email text, full_name text, notify_email boolean, notify_push boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name, p.notify_email, p.notify_push
    from public.profiles p
   where p.id = any(ids)
     and (auth.role() = 'service_role' or auth.uid() is not null);
$$;
revoke all on function public.notify_recipients(uuid[]) from public;
grant execute on function public.notify_recipients(uuid[]) to authenticated, service_role;

-- Whoever saves a task may drop its notices in the attendees' inboxes (the page-access insert
-- policy leaves out Prospecting-only users).
drop policy if exists notifications_insert_tasks on public.notifications;
create policy notifications_insert_tasks on public.notifications for insert to authenticated
  with check (kind in ('task', 'task_today', 'task_overdue'));
