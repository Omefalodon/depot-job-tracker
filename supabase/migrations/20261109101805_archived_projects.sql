-- Finished projects can be archived: hidden from the project list, suggestions and the side panel, data kept (George 2026-11-09).
create table public.archived_projects (
  project text primary key check (char_length(project) between 1 and 200),
  archived_at timestamptz not null default now(),
  archived_by uuid references auth.users(id) default auth.uid()
);
create or replace function private.stamp_archive() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.archived_at := now();
  new.archived_by := auth.uid();
  return new;
end $$;
create trigger archived_projects_stamp before insert on public.archived_projects for each row execute function private.stamp_archive();
create index archived_projects_archived_by_idx on public.archived_projects (archived_by);
alter table public.archived_projects enable row level security;
create policy "staff read archived projects" on public.archived_projects for select to authenticated using ((select private.is_staff()));
create policy "office archives projects" on public.archived_projects for insert to authenticated with check ((select private.sees_prices()));
create policy "office unarchives projects" on public.archived_projects for delete to authenticated using ((select private.sees_prices()));
revoke all on public.archived_projects from anon;
revoke update on public.archived_projects from authenticated;
alter publication supabase_realtime add table public.archived_projects;
