-- The restore door (owner, Oct 13: "go ahead and build it … it needs to be as robust and safe,
-- and get all info where it needs to go accurately"). The portal's /api/restore route
-- (src/lib/restore-door.server.ts) puts a nightly backup (scripts/backup/jbk-backup.ps1) back
-- through the functions below, which it calls with the service role. Idempotent.
--
-- Why functions: the row writes need things PostgREST cannot do — switch a table's user
-- triggers off for the transaction (so a restore re-sends no notices, re-audits nothing and
-- re-stamps no dates), map a backup row onto a table whose columns have moved on, insert with
-- ON CONFLICT on the primary key, and reset the sequences afterwards. They are SECURITY
-- DEFINER (owned by postgres, which owns the tables, so ALTER TABLE … DISABLE TRIGGER works),
-- with search_path pinned, and executable by service_role alone: anon, authenticated and public
-- are revoked (Supabase grants every new public function to anon/authenticated by default; the
-- explicit revokes below undo that).
--
-- Nothing here deletes or truncates. A restore only ever adds rows (skip mode) or overwrites
-- rows with the same primary key (replace mode); rows the backup does not know stay.
--
-- Schema drift: none of these functions names a table or a column. restore_catalog() reads the
-- live schema from pg_catalog, restore_rows() maps each JSON row with jsonb_populate_record
-- against the live table (a column the backup has but the table lost is ignored and reported;
-- a column the table gained and the backup lacks is left out of the INSERT so it takes its
-- default), restore_finish() finds every sequence through pg_depend. A table added next month
-- is covered on the night it appears.

-- Who may run these: the service role (the restore door), or SQL with no request at all (the
-- SQL editor). Never anon, never a signed-in user — the way stamp_cron() decides.
create or replace function public.restore_assert_system()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (coalesce(auth.role(), '') = 'service_role'
          or (auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated'))) then
    raise exception 'Forbidden: the restore runs with the service role only' using errcode = '42501';
  end if;
end $$;
revoke all on function public.restore_assert_system() from public, anon, authenticated;
grant execute on function public.restore_assert_system() to service_role;

-- Tables the restore refuses, mirrored by RESTORE_DENY in src/lib/backup-tables.ts (a test pins
-- the two to the same set). Empty on purpose (owner, Oct 13: "wouldn't the user accounts and
-- secrets be needed?"): app_secrets holds only the VAPID push-signing pair the app generated for
-- itself, and restoring it is what keeps every phone's push subscription valid; the real secrets
-- live in Lovable Cloud › Secrets, never in the database, so no backup carries them.
create or replace function public.restore_deny_list()
returns text[] language sql immutable as $$ select array[]::text[] $$;
revoke all on function public.restore_deny_list() from public, anon, authenticated;
grant execute on function public.restore_deny_list() to service_role;

-- 1. The live catalog: every base table in public with its columns (name, type, nullable,
-- default, is_pk, generated), its primary key, and every foreign key (child table and columns →
-- parent schema, table and columns; profiles.id → auth.users shows up with ref_schema 'auth').
-- The door orders the tables from the foreign keys and finds the user-id columns from them.
create or replace function public.restore_catalog()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tables jsonb;
  v_fks jsonb;
begin
  perform public.restore_assert_system();
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', c.relname,
           'restorable', not (c.relname = any(public.restore_deny_list())),
           'columns', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'name', a.attname,
                      'type', format_type(a.atttypid, a.atttypmod),
                      'nullable', not a.attnotnull,
                      'default', pg_get_expr(d.adbin, d.adrelid),
                      'is_pk', coalesce(a.attnum = any(pk.indkey::int2[]), false),
                      'generated', a.attgenerated <> '' or a.attidentity <> ''
                    ) order by a.attnum), '[]'::jsonb)
               from pg_attribute a
               left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
              where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
           'pk', (
             select coalesce(jsonb_agg(a.attname order by k.ord), '[]'::jsonb)
               from pg_index i
               cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
               join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
              where i.indrelid = c.oid and i.indisprimary)
         ) order by c.relname), '[]'::jsonb)
    into v_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_index pk on pk.indrelid = c.oid and pk.indisprimary
   where n.nspname = 'public' and c.relkind in ('r', 'p');

  select coalesce(jsonb_agg(jsonb_build_object(
           'constraint', con.conname,
           'table', c.relname,
           'columns', (select jsonb_agg(a.attname order by k.ord)
                         from unnest(con.conkey) with ordinality as k(attnum, ord)
                         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum),
           'ref_schema', rn.nspname,
           'ref_table', rc.relname,
           'ref_columns', (select jsonb_agg(a.attname order by k.ord)
                             from unnest(con.confkey) with ordinality as k(attnum, ord)
                             join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum)
         ) order by c.relname, con.conname), '[]'::jsonb)
    into v_fks
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_class rc on rc.oid = con.confrelid
    join pg_namespace rn on rn.oid = rc.relnamespace
   where con.contype = 'f' and n.nspname = 'public';

  return jsonb_build_object('tables', v_tables, 'foreign_keys', v_fks);
end $$;
revoke all on function public.restore_catalog() from public, anon, authenticated;
grant execute on function public.restore_catalog() to service_role;
comment on function public.restore_catalog() is
  'Restore door: the live public schema (tables, columns, primary keys, foreign keys) read from pg_catalog. Service role only.';

-- 2. Exact row counts of every public base table, { table: n }: identify and finish return
-- them so the script can compare with the backup's manifest.
create or replace function public.restore_live_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  v_n bigint;
  v_out jsonb := '{}'::jsonb;
begin
  perform public.restore_assert_system();
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname
  loop
    execute format('select count(*) from public.%I', r.relname) into v_n;
    v_out := v_out || jsonb_build_object(r.relname, v_n);
  end loop;
  return v_out;
end $$;
revoke all on function public.restore_live_counts() from public, anon, authenticated;
grant execute on function public.restore_live_counts() to service_role;

-- The table check every writing function runs: a plain name, a base table in public, not denied.
create or replace function public.restore_table_oid(p_table text)
returns oid language plpgsql stable security definer set search_path = public as $$
declare
  v_oid oid;
begin
  perform public.restore_assert_system();
  if p_table is null or p_table !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception 'restore: % is not a plain table name', coalesce(p_table, '(null)');
  end if;
  if p_table = any(public.restore_deny_list()) then
    raise exception 'restore: % is on the deny list', p_table;
  end if;
  select c.oid into v_oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = p_table and c.relkind in ('r', 'p');
  if v_oid is null then
    raise exception 'restore: public.% is not a table in this project', p_table;
  end if;
  return v_oid;
end $$;
revoke all on function public.restore_table_oid(text) from public, anon, authenticated;
grant execute on function public.restore_table_oid(text) to service_role;

-- 3. Which keys already exist (the dry run's primary-key clash count). p_keys is a JSON array
-- of up to 1,000 keys; each is an object of column → value (any live columns, the primary key
-- as a rule), or a bare value for a single-column primary key. Returns
-- { existing, indices: [positions of the keys that exist] }.
create or replace function public.restore_exists(p_table text, p_keys jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_oid oid;
  v_pk text[];
  v_cols text[];
  v_live text[];
  v_key jsonb;
  v_i integer;
  v_hit boolean;
  v_found integer[] := '{}';
  v_sql text;
  v_where text;
begin
  perform public.restore_assert_system();
  v_oid := public.restore_table_oid(p_table);
  if p_keys is null or jsonb_typeof(p_keys) <> 'array' then
    raise exception 'restore: p_keys must be a JSON array';
  end if;
  if jsonb_array_length(p_keys) > 1000 then
    raise exception 'restore: at most 1000 keys a call';
  end if;
  select array_agg(a.attname order by k.ord) into v_pk
    from pg_index i
    cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
   where i.indrelid = v_oid and i.indisprimary;
  select array_agg(a.attname) into v_live
    from pg_attribute a where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped;

  for v_i in 0 .. jsonb_array_length(p_keys) - 1 loop
    v_key := p_keys -> v_i;
    if jsonb_typeof(v_key) <> 'object' then
      if v_pk is null or cardinality(v_pk) <> 1 then
        raise exception 'restore: % needs a key object, not a bare value', p_table;
      end if;
      v_key := jsonb_build_object(v_pk[1], v_key);
    end if;
    select array_agg(k) into v_cols from jsonb_object_keys(v_key) k;
    if v_cols is null or not (v_cols <@ v_live) then
      raise exception 'restore: key % names a column % does not have', v_key::text, p_table;
    end if;
    select string_agg(format('t.%I = r.%I', c, c), ' and ') into v_where from unnest(v_cols) c;
    v_sql := format('select exists (select 1 from public.%I t, jsonb_populate_record(null::public.%I, $1) r where %s)',
                    p_table, p_table, v_where);
    execute v_sql into v_hit using v_key;
    if v_hit then v_found := v_found || v_i; end if;
  end loop;
  return jsonb_build_object('existing', cardinality(v_found), 'indices', to_jsonb(v_found));
end $$;
revoke all on function public.restore_exists(text, jsonb) from public, anon, authenticated;
grant execute on function public.restore_exists(text, jsonb) to service_role;

-- 4. One batch of rows (up to 1,000) into one table.
--   * The table is validated against pg_catalog (public, a base table, not denied); the mode is
--     'skip' (rows whose primary key exists are left alone) or 'replace' (they are overwritten,
--     every column the backup carries = the backup's value).
--   * Each JSON row is mapped with jsonb_populate_record(null::<table>, row): a column the backup
--     has and the table no longer has is ignored (reported once in dropped_columns), a column the
--     table has and the backup lacks is left out of the INSERT so its default applies. Generated
--     and identity columns are never written.
--   * The table's user triggers are off for the transaction (alter table … disable trigger user
--     before, enable trigger user after, same transaction): restoring re-fires nothing. Foreign
--     keys are system triggers and stay enforced.
--   * Every row is its own sub-transaction: a refused row (a foreign key to a row that is not
--     there yet, a unique clash on another column) is reported in errors[{index, message, code}]
--     and the batch carries on. Nothing is deleted, ever.
--   * A table with no primary key is inserted plainly (no_pk true); skip/replace cannot apply.
-- Returns { inserted, replaced, skipped, dropped_columns, errors, no_pk }.
create or replace function public.restore_rows(p_table text, p_rows jsonb, p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_oid oid;
  v_pk text[];
  v_live text[];          -- every live column
  v_writable text[];      -- live, not generated
  v_has_identity boolean := false;
  v_keys text[];          -- every key the batch's rows carry
  v_cols text[];          -- the INSERT column list: writable ∩ keys
  v_dropped text[];
  v_set text;
  v_conflict text := '';
  v_sql text;
  v_row jsonb;
  v_i integer;
  v_flag boolean;
  v_inserted integer := 0;
  v_replaced integer := 0;
  v_skipped integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_n integer;
  v_overriding text := '';
begin
  perform public.restore_assert_system();
  v_oid := public.restore_table_oid(p_table);
  if p_mode is null or p_mode not in ('skip', 'replace') then
    raise exception 'restore: p_mode must be skip or replace';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'restore: p_rows must be a JSON array of rows';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 1000 then
    raise exception 'restore: at most 1000 rows a call';
  end if;

  select array_agg(a.attname order by a.attnum),
         array_agg(a.attname order by a.attnum) filter (where a.attgenerated = ''),
         coalesce(bool_or(a.attidentity = 'a'), false)
    into v_live, v_writable, v_has_identity
    from pg_attribute a
   where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped;
  -- Generated columns are never written (the database computes them). An identity column the
  -- backup carries is written as it was, which needs OVERRIDING SYSTEM VALUE.
  if v_has_identity then v_overriding := ' overriding system value'; end if;
  select array_agg(a.attname order by k.ord) into v_pk
    from pg_index i
    cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
   where i.indrelid = v_oid and i.indisprimary;

  select array_agg(distinct k order by k) into v_keys
    from jsonb_array_elements(p_rows) r
    cross join lateral jsonb_object_keys(case when jsonb_typeof(r) = 'object' then r else '{}'::jsonb end) k;
  if v_n = 0 or v_keys is null then
    return jsonb_build_object('inserted', 0, 'replaced', 0, 'skipped', 0,
                              'dropped_columns', '[]'::jsonb, 'errors', '[]'::jsonb,
                              'no_pk', v_pk is null);
  end if;
  select array_agg(k order by k) into v_dropped from unnest(v_keys) k where not (k = any(v_live));
  select array_agg(k order by k) into v_cols from unnest(v_keys) k where k = any(v_writable);
  if v_cols is null then
    raise exception 'restore: none of the backup''s columns (%) exist on % any more', array_to_string(v_keys, ', '), p_table;
  end if;

  if v_pk is not null then
    if p_mode = 'skip' then
      v_conflict := format(' on conflict (%s) do nothing', (select string_agg(format('%I', c), ', ') from unnest(v_pk) c));
    else
      select string_agg(format('%I = excluded.%I', c, c), ', ') into v_set
        from unnest(v_cols) c where not (c = any(v_pk));
      if v_set is null then
        v_conflict := format(' on conflict (%s) do nothing', (select string_agg(format('%I', c), ', ') from unnest(v_pk) c));
      else
        v_conflict := format(' on conflict (%s) do update set %s',
                             (select string_agg(format('%I', c), ', ') from unnest(v_pk) c), v_set);
      end if;
    end if;
  end if;

  v_sql := format('insert into public.%I as t (%s)%s select %s from jsonb_populate_record(null::public.%I, $1) r%s returning (t.xmax = 0)',
                  p_table,
                  (select string_agg(format('%I', c), ', ') from unnest(v_cols) c),
                  v_overriding,
                  (select string_agg(format('r.%I', c), ', ') from unnest(v_cols) c),
                  p_table,
                  v_conflict);

  -- User triggers off for this transaction; the enable below (and restore_finish) turn them back
  -- on. Should this function fail outright, the whole transaction, this ALTER included, rolls back.
  execute format('alter table public.%I disable trigger user', p_table);

  for v_i in 0 .. v_n - 1 loop
    v_row := p_rows -> v_i;
    if jsonb_typeof(v_row) <> 'object' then
      v_errors := v_errors || jsonb_build_object('index', v_i, 'message', 'not a JSON object', 'code', '22023');
      continue;
    end if;
    begin
      v_flag := null;
      execute v_sql into v_flag using v_row;
      if v_flag is null then v_skipped := v_skipped + 1;
      elsif v_flag then v_inserted := v_inserted + 1;
      else v_replaced := v_replaced + 1;
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('index', v_i, 'message', sqlerrm, 'code', sqlstate);
    end;
  end loop;

  execute format('alter table public.%I enable trigger user', p_table);

  return jsonb_build_object(
    'inserted', v_inserted, 'replaced', v_replaced, 'skipped', v_skipped,
    'dropped_columns', coalesce(to_jsonb(v_dropped), '[]'::jsonb),
    'errors', v_errors,
    'no_pk', v_pk is null);
end $$;
revoke all on function public.restore_rows(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.restore_rows(text, jsonb, text) to service_role;
comment on function public.restore_rows(text, jsonb, text) is
  'Restore door: one batch of backup rows into one public table (skip or replace on the primary key), user triggers off for the transaction, never deletes. Service role only.';

-- 5. After the tables: every sequence a public column draws from (serial / bigserial / identity
-- / a plain nextval default, found through pg_depend) is set past the column's highest value
-- (never below its start, so an empty table keeps e.g. ticket numbers from 6000, and never
-- backwards from where it already is, so no number is handed out twice); any user
-- trigger left disabled is enabled again (defensive — restore_rows re-enables its own); and the
-- live counts come back for the script to compare with the manifest.
create or replace function public.restore_finish()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_max bigint;
  v_set bigint;
  v_seqs jsonb := '[]'::jsonb;
  v_trig jsonb := '[]'::jsonb;
begin
  perform public.restore_assert_system();
  for r in
    with owned as (
      -- serial / bigserial / identity: the sequence depends on its column
      select d.objid as seq, d.refobjid as tbl, d.refobjsubid as col
        from pg_depend d
        join pg_class s on s.oid = d.objid and s.relkind = 'S'
       where d.classid = 'pg_class'::regclass and d.refclassid = 'pg_class'::regclass
         and d.deptype in ('a', 'i') and d.refobjsubid > 0
      union
      -- a plain `default nextval('seq')`: the column default depends on the sequence
      select d.refobjid as seq, ad.adrelid as tbl, ad.adnum as col
        from pg_depend d
        join pg_attrdef ad on d.classid = 'pg_attrdef'::regclass and d.objid = ad.oid
        join pg_class s on s.oid = d.refobjid and s.relkind = 'S'
       where d.refclassid = 'pg_class'::regclass
    )
    select distinct s.relname as seq_name, c.relname as tbl_name, a.attname as col_name,
           coalesce(q.start_value, 1) as start_value,
           q.last_value
      from owned o
      join pg_class s on s.oid = o.seq
      join pg_namespace sn on sn.oid = s.relnamespace
      join pg_class c on c.oid = o.tbl
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = o.tbl and a.attnum = o.col and not a.attisdropped
      join pg_type t on t.oid = a.atttypid
      left join pg_sequences q on q.schemaname = sn.nspname and q.sequencename = s.relname
     where sn.nspname = 'public' and n.nspname = 'public' and c.relkind in ('r', 'p')
       and t.typname in ('int2', 'int4', 'int8', 'numeric')
     order by c.relname, a.attname
  loop
    execute format('select max(%I)::bigint from public.%I', r.col_name, r.tbl_name) into v_max;
    -- Never backwards: a sequence already past max(column) (rows deleted since) keeps its place,
    -- so a restore into a live project can never hand out a ticket or invoice number again.
    v_set := greatest(coalesce(v_max, 0) + 1, r.start_value, coalesce(r.last_value, 0) + 1);
    perform setval(format('public.%I', r.seq_name)::regclass, v_set, false);
    v_seqs := v_seqs || jsonb_build_object('sequence', r.seq_name, 'table', r.tbl_name,
                                           'column', r.col_name, 'max', v_max, 'next', v_set);
  end loop;

  for r in
    select c.relname as tbl_name, t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'D'
     order by c.relname, t.tgname
  loop
    execute format('alter table public.%I enable trigger %I', r.tbl_name, r.tgname);
    v_trig := v_trig || jsonb_build_object('table', r.tbl_name, 'trigger', r.tgname);
  end loop;

  return jsonb_build_object('sequences', v_seqs, 'triggers_enabled', v_trig,
                            'live_counts', public.restore_live_counts());
end $$;
revoke all on function public.restore_finish() from public, anon, authenticated;
grant execute on function public.restore_finish() to service_role;
comment on function public.restore_finish() is
  'Restore door: after the tables — sequences past max(column), disabled user triggers back on, live counts. Service role only.';
