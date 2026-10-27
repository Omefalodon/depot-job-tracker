-- Suggestion board: anyone approved can post an idea and vote; the author edits their own text; an admin sets the status and a reply.
create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  status text not null default 'new' check (status in ('new','planned','done','declined')),
  admin_note text not null default '' check (char_length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) default auth.uid()
);
create index suggestions_created_by_idx on public.suggestions (created_by);
create index suggestions_updated_by_idx on public.suggestions (updated_by);

create table public.suggestion_votes (
  suggestion_id uuid not null references public.suggestions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  primary key (suggestion_id, user_id)
);
create index suggestion_votes_user_idx on public.suggestion_votes (user_id);

create or replace function private.guard_suggestion() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_at := now(); new.created_by := auth.uid();
    if not private.is_admin() then new.status := 'new'; new.admin_note := ''; end if;
  else
    new.created_at := old.created_at; new.created_by := old.created_by;
    if not private.is_admin() then new.status := old.status; new.admin_note := old.admin_note; end if;
    if old.created_by is distinct from auth.uid() and not private.is_admin() then new.body := old.body; end if;
  end if;
  return new;
end $$;
create trigger suggestions_guard before insert or update on public.suggestions for each row execute function private.guard_suggestion();

alter table public.suggestions enable row level security;
alter table public.suggestion_votes enable row level security;
create policy "staff read suggestions" on public.suggestions for select to authenticated using ((select private.is_staff()));
create policy "staff add suggestions" on public.suggestions for insert to authenticated with check ((select private.is_staff()));
create policy "author or admin edits suggestion" on public.suggestions for update to authenticated
  using ((select private.is_staff()) and (created_by = (select auth.uid()) or (select private.is_admin())))
  with check ((select private.is_staff()));
create policy "author or admin deletes suggestion" on public.suggestions for delete to authenticated
  using ((select private.is_staff()) and (created_by = (select auth.uid()) or (select private.is_admin())));
create policy "staff read votes" on public.suggestion_votes for select to authenticated using ((select private.is_staff()));
create policy "staff vote as themselves" on public.suggestion_votes for insert to authenticated with check ((select private.is_staff()) and user_id = (select auth.uid()));
create policy "staff remove own vote" on public.suggestion_votes for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.suggestions, public.suggestion_votes from anon;
revoke update on public.suggestion_votes from authenticated;

alter publication supabase_realtime add table public.suggestions, public.suggestion_votes;
