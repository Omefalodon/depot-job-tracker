-- Job attachments: files in the private bucket "job-files", one row per file in public.job_files.
-- Path inside the bucket: <job id>/<random>-<file name>. Only price roles (office, admin) can see them,
-- because documents (invoices, quotes) may carry prices.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-files', 'job-files', false, 26214400, array[
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/tiff',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain',
  'application/vnd.ms-outlook', 'message/rfc822',
  'application/zip'
]);

create table public.job_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  path text not null unique check (char_length(path) <= 400),
  name text not null check (char_length(name) between 1 and 200),
  size bigint not null check (size >= 0 and size <= 26214400),
  mime text not null default '' check (char_length(mime) <= 120),
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references auth.users(id) default auth.uid(),
  check (split_part(path, '/', 1) = job_id::text)
);
create index job_files_job_idx on public.job_files (job_id);
create index job_files_uploaded_by_idx on public.job_files (uploaded_by);

create or replace function private.stamp_file() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.uploaded_at := now();
  new.uploaded_by := auth.uid();
  return new;
end $$;
create trigger job_files_stamp before insert on public.job_files for each row execute function private.stamp_file();

create or replace function private.log_file() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.job_history (job_id, action, changed_by, old_row, new_row)
  values (coalesce(new.job_id, old.job_id), 'file-' || lower(tg_op), auth.uid(),
          case when tg_op = 'DELETE' then jsonb_build_object('name', old.name) end,
          case when tg_op = 'INSERT' then jsonb_build_object('name', new.name) end);
  return null;
end $$;
create trigger job_files_log after insert or delete on public.job_files for each row execute function private.log_file();

alter table public.job_files enable row level security;
create policy "price roles read files" on public.job_files for select to authenticated using ((select private.sees_prices()));
create policy "price roles add files" on public.job_files for insert to authenticated with check ((select private.sees_prices()));
create policy "price roles delete files" on public.job_files for delete to authenticated using ((select private.sees_prices()));
revoke all on public.job_files from anon;
revoke update on public.job_files from authenticated;

-- Storage: same people, only inside this bucket, only under an existing job's folder.
create policy "job files: price roles read" on storage.objects for select to authenticated
  using (bucket_id = 'job-files' and (select private.sees_prices()));
create policy "job files: price roles upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'job-files' and (select private.sees_prices())
              and exists (select 1 from public.jobs j where j.id::text = (storage.foldername(name))[1]));
create policy "job files: price roles delete" on storage.objects for delete to authenticated
  using (bucket_id = 'job-files' and (select private.sees_prices()));

alter publication supabase_realtime add table public.job_files;
