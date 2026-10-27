-- Cancelled status (whole project can be cancelled, George 2026-10-27) and one note per project.
alter table public.jobs drop constraint jobs_status_check,
  add constraint jobs_status_check check (status in ('open','scheduled','in-progress','done','cancelled'));

create table public.project_notes (
  project text primary key check (char_length(project) between 1 and 200),
  note text not null default '' check (char_length(note) <= 8000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) default auth.uid()
);
create index project_notes_updated_by_idx on public.project_notes (updated_by);
create trigger project_notes_stamp before insert or update on public.project_notes for each row execute function private.stamp();
alter table public.project_notes enable row level security;
create policy "staff read project notes" on public.project_notes for select to authenticated using ((select private.is_staff()));
create policy "staff add project notes" on public.project_notes for insert to authenticated with check ((select private.is_staff()));
create policy "staff edit project notes" on public.project_notes for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "staff delete project notes" on public.project_notes for delete to authenticated using ((select private.is_staff()));
revoke all on public.project_notes from anon;
alter publication supabase_realtime add table public.project_notes;
