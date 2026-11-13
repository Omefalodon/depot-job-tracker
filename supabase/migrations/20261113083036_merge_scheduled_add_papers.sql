-- George 2026-11-13: Open and Scheduled become one status (open); new status "papers" = loading done, pending papers.
-- 'scheduled' stays allowed so browser tabs that still run the old page keep saving; the app reads it as open.
alter table public.jobs drop constraint jobs_status_check,
  add constraint jobs_status_check check (status in ('open','scheduled','in-progress','papers','done','cancelled'));
update public.jobs set status = 'open' where status = 'scheduled';
