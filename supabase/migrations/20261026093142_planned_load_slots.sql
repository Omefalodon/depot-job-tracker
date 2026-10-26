-- A planned load ("slot") is a placeholder job for a project and day; it is later filled with one of the project's real jobs.
alter table public.jobs add column is_slot boolean not null default false;
