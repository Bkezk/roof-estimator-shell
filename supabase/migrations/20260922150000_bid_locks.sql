-- Bid edit locks: the first browser TAB to open a saved bid holds it; any other tab (another
-- user, or the same account in a second window) sees the estimator read-only until the holder
-- leaves or its heartbeat lapses. Keyed by a per-tab session key, not the user, so two logins
-- on one account still exclude each other. Writes go through the SECURITY DEFINER functions
-- below (serialised per bid with an advisory lock); saveBid refuses a live lock held elsewhere.
create table if not exists public.bid_locks (
  bid_id uuid primary key references public.bids(id) on delete cascade,
  session_key text not null,
  user_id uuid not null,
  holder_name text not null,
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()
);
alter table public.bid_locks enable row level security;
drop policy if exists bid_locks_read on public.bid_locks;
create policy bid_locks_read on public.bid_locks for select to authenticated using (true);

create or replace function public.acquire_bid_lock(
  p_bid uuid, p_session text, p_name text, p_ttl_seconds integer default 45
) returns table (
  acquired boolean, holder_name text, holder_user uuid, holder_session text, heartbeat_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  cur public.bid_locks%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_bid::text));
  select * into cur from public.bid_locks where bid_id = p_bid;
  if not found
     or cur.session_key = p_session
     or cur.heartbeat_at < now() - make_interval(secs => p_ttl_seconds) then
    insert into public.bid_locks (bid_id, session_key, user_id, holder_name, acquired_at, heartbeat_at)
    values (p_bid, p_session, auth.uid(), p_name, now(), now())
    on conflict (bid_id) do update
      set session_key = excluded.session_key,
          user_id = excluded.user_id,
          holder_name = excluded.holder_name,
          acquired_at = case when public.bid_locks.session_key = excluded.session_key
                             then public.bid_locks.acquired_at else now() end,
          heartbeat_at = now()
    returning * into cur;
    return query select true, cur.holder_name, cur.user_id, cur.session_key, cur.heartbeat_at;
  else
    return query select false, cur.holder_name, cur.user_id, cur.session_key, cur.heartbeat_at;
  end if;
end $$;

create or replace function public.release_bid_lock(p_bid uuid, p_session text)
returns void language sql security definer set search_path = public as $$
  delete from public.bid_locks where bid_id = p_bid and session_key = p_session;
$$;

revoke all on function public.acquire_bid_lock(uuid, text, text, integer) from public;
revoke all on function public.release_bid_lock(uuid, text) from public;
grant execute on function public.acquire_bid_lock(uuid, text, text, integer) to authenticated;
grant execute on function public.release_bid_lock(uuid, text) to authenticated;
