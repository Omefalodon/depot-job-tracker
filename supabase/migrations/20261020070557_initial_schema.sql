-- Depot Job Tracker: initial schema (2026-10-20)
create schema if not exists private;

-- People who may use the app. One row per login, created automatically, approved by an admin.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 120),
  role text not null default 'office' check (role in ('admin','office','depot')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  client text not null default '' check (char_length(client) <= 120),
  shipping_container text not null default '' check (char_length(shipping_container) <= 20),
  hct_container text not null default '' check (char_length(hct_container) <= 20),
  truck_plate text not null default '' check (char_length(truck_plate) <= 20),
  transporter text not null default '' check (char_length(transporter) <= 120),
  cargo_type text not null default '' check (char_length(cargo_type) <= 120),
  weight integer check (weight >= 0),
  pieces integer check (pieces >= 0),
  job_date date,
  job_time time,
  project text not null default '' check (char_length(project) <= 120),
  ref text not null default '' check (char_length(ref) <= 80),
  notes text not null default '' check (char_length(notes) <= 4000),
  status text not null default 'open' check (status in ('open','scheduled','in-progress','done')),
  checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 50),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) default auth.uid()
);
create index jobs_date_idx on public.jobs (job_date);
create index jobs_project_idx on public.jobs (project);

-- Prices kept apart from jobs so a no-price role can be added without touching jobs.
create table public.job_prices (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  price numeric(12,2) check (price >= 0),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) default auth.uid()
);

create table public.day_notes (
  day date primary key,
  note text not null default '' check (char_length(note) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) default auth.uid()
);

-- Who changed what. Written only by triggers.
create table public.job_history (
  id bigint generated always as identity primary key,
  job_id uuid not null,
  action text not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_row jsonb,
  new_row jsonb
);
create index job_history_job_idx on public.job_history (job_id, changed_at desc);

-- ---------- helper functions (private schema: not callable through the API) ----------
create or replace function private.my_role() returns text
language sql stable security definer set search_path = ''
as $$ select p.role from public.profiles p where p.id = (select auth.uid()) and p.active $$;

create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role() in ('admin','office','depot'), false) $$;

create or replace function private.sees_prices() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role() in ('admin','office'), false) $$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role() = 'admin', false) $$;

grant usage on schema private to authenticated;
grant execute on function private.my_role(), private.is_staff(), private.sees_prices(), private.is_admin() to authenticated;
revoke execute on function private.my_role(), private.is_staff(), private.sees_prices(), private.is_admin() from anon, public;

-- New login -> profile row, inactive until an admin approves it.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Stamp who/when on every change; the client can't fake it.
create or replace function private.stamp() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' and tg_table_name = 'jobs' then
    new.created_at := now();
    new.created_by := auth.uid();
  elsif tg_op = 'UPDATE' and tg_table_name = 'jobs' then
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
create trigger jobs_stamp before insert or update on public.jobs for each row execute function private.stamp();
create trigger prices_stamp before insert or update on public.job_prices for each row execute function private.stamp();
create trigger notes_stamp before insert or update on public.day_notes for each row execute function private.stamp();

create or replace function private.log_job() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.job_history (job_id, action, changed_by, old_row, new_row)
  values (coalesce(new.id, old.id), lower(tg_op), auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
create trigger jobs_log after insert or update or delete on public.jobs for each row execute function private.log_job();

create or replace function private.log_price() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.job_history (job_id, action, changed_by, old_row, new_row)
  values (coalesce(new.job_id, old.job_id), 'price-' || lower(tg_op), auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
create trigger prices_log after insert or update or delete on public.job_prices for each row execute function private.log_price();

-- Only an admin may change role / active; nobody may change id or email from the API.
-- (replaced by 20261020071211_profile_guard_allow_dashboard.sql)
create or replace function private.guard_profile() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.id := old.id; new.email := old.email; new.created_at := old.created_at;
  if not private.is_admin() then
    new.role := old.role; new.active := old.active;
  end if;
  -- an admin can't lock themselves out
  if old.id = auth.uid() and (new.role <> 'admin' or not new.active) and old.role = 'admin' then
    raise exception 'You cannot remove your own admin access';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function private.guard_profile();

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.job_prices enable row level security;
alter table public.day_notes enable row level security;
alter table public.job_history enable row level security;

create policy "own profile or staff can read" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));
create policy "own name or admin can update" on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()))
  with check (id = (select auth.uid()) or (select private.is_admin()));

create policy "staff read jobs" on public.jobs for select to authenticated using ((select private.is_staff()));
create policy "staff add jobs" on public.jobs for insert to authenticated with check ((select private.is_staff()));
create policy "staff edit jobs" on public.jobs for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "staff delete jobs" on public.jobs for delete to authenticated using ((select private.is_staff()));

create policy "price roles read" on public.job_prices for select to authenticated using ((select private.sees_prices()));
create policy "price roles add" on public.job_prices for insert to authenticated with check ((select private.sees_prices()));
create policy "price roles edit" on public.job_prices for update to authenticated using ((select private.sees_prices())) with check ((select private.sees_prices()));
create policy "price roles delete" on public.job_prices for delete to authenticated using ((select private.sees_prices()));

create policy "staff read notes" on public.day_notes for select to authenticated using ((select private.is_staff()));
create policy "staff add notes" on public.day_notes for insert to authenticated with check ((select private.is_staff()));
create policy "staff edit notes" on public.day_notes for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "staff delete notes" on public.day_notes for delete to authenticated using ((select private.is_staff()));

create policy "staff read history" on public.job_history for select to authenticated using ((select private.is_staff()));

-- anon gets nothing at all
revoke all on public.profiles, public.jobs, public.job_prices, public.day_notes, public.job_history from anon;
revoke insert, delete on public.profiles from authenticated;
revoke insert, update, delete on public.job_history from authenticated;

-- live updates
alter publication supabase_realtime add table public.jobs, public.job_prices, public.day_notes;
