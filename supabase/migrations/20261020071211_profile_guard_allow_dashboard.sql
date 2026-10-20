create or replace function private.guard_profile() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.id := old.id; new.email := old.email; new.created_at := old.created_at;
  -- From the app (role "authenticated") only an admin may change role / active.
  -- The Supabase dashboard / SQL editor (postgres) may, so the first admin can be set there.
  if current_user = 'authenticated' and not private.is_admin() then
    new.role := old.role; new.active := old.active;
  end if;
  if current_user = 'authenticated' and old.id = auth.uid() and old.role = 'admin' and (new.role <> 'admin' or not new.active) then
    raise exception 'You cannot remove your own admin access';
  end if;
  return new;
end $$;
