-- Sender (Αποστολέας) and receiver (Παραλήπτης) of the cargo, George 2026-10-27.
alter table public.jobs
  add column sender text not null default '' check (char_length(sender) <= 120),
  add column receiver text not null default '' check (char_length(receiver) <= 120);
