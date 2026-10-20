alter policy "staff read history" on public.job_history
  using ((select private.is_staff()) and (action not like 'price-%' or (select private.sees_prices())));
create index if not exists jobs_created_by_idx on public.jobs (created_by);
create index if not exists jobs_updated_by_idx on public.jobs (updated_by);
create index if not exists job_prices_updated_by_idx on public.job_prices (updated_by);
create index if not exists day_notes_updated_by_idx on public.day_notes (updated_by);
