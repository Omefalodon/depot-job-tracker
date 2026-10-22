-- Invoicing: one invoice number per job (many jobs may share one). Office + admin only, like prices.
create table public.job_invoices (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  invoice_no text not null check (char_length(btrim(invoice_no)) between 1 and 60),
  invoiced_on date not null default current_date,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) default auth.uid()
);
create index job_invoices_no_idx on public.job_invoices (invoice_no);
create index job_invoices_updated_by_idx on public.job_invoices (updated_by);
create trigger invoices_stamp before insert or update on public.job_invoices for each row execute function private.stamp();

create or replace function private.log_invoice() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.job_history (job_id, action, changed_by, old_row, new_row)
  values (coalesce(new.job_id, old.job_id), 'invoice-' || lower(tg_op), auth.uid(),
          case when tg_op <> 'INSERT' then jsonb_build_object('invoice_no', old.invoice_no) end,
          case when tg_op <> 'DELETE' then jsonb_build_object('invoice_no', new.invoice_no) end);
  return null;
end $$;
create trigger invoices_log after insert or update or delete on public.job_invoices for each row execute function private.log_invoice();

alter table public.job_invoices enable row level security;
create policy "price roles read invoices" on public.job_invoices for select to authenticated using ((select private.sees_prices()));
create policy "price roles add invoices" on public.job_invoices for insert to authenticated with check ((select private.sees_prices()));
create policy "price roles edit invoices" on public.job_invoices for update to authenticated using ((select private.sees_prices())) with check ((select private.sees_prices()));
create policy "price roles delete invoices" on public.job_invoices for delete to authenticated using ((select private.sees_prices()));
revoke all on public.job_invoices from anon;

-- invoice and attachment history is for price roles only, like price history
alter policy "staff read history" on public.job_history
  using ((select private.is_staff()) and ((action not like 'price-%' and action not like 'invoice-%' and action not like 'file-%') or (select private.sees_prices())));

alter publication supabase_realtime add table public.job_invoices;
