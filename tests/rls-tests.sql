-- Database rule tests (Row Level Security). Run in the Supabase SQL editor, or through Claude.
-- Everything inside the test block is rolled back: no jobs, prices or notes are left behind.
-- Expected: every row ok = true.
--
-- One-time setup (already done on 2026-10-20): four test logins that cannot sign in
-- (no password, .invalid emails). The app's Users screen hides them.
--   insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
--    ('00000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','test-admin@example.invalid','', now(), now(), now(), '{}','{}'),
--    ('00000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','test-office@example.invalid','', now(), now(), now(), '{}','{}'),
--    ('00000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','test-depot@example.invalid','', now(), now(), now(), '{}','{}'),
--    ('00000000-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','test-pending@example.invalid','', now(), now(), now(), '{}','{}');
update public.profiles set active = true, role = 'admin' where id = '00000000-0000-4000-8000-0000000000a1';
update public.profiles set active = true, role = 'office' where id = '00000000-0000-4000-8000-0000000000b2';
update public.profiles set active = true, role = 'depot' where id = '00000000-0000-4000-8000-0000000000c3';
update public.profiles set active = false, role = 'office' where id = '00000000-0000-4000-8000-0000000000d4';

create temp table t_results (n serial, test text, ok boolean);
do $$
declare c int; jid uuid; err text; r text[] := array[]::text[]; b boolean[] := array[]::boolean[];
begin
  begin
  -- OFFICE
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
  insert into public.jobs (client, status, created_by) values ('RLS test', 'open', '00000000-0000-4000-8000-0000000000a1') returning id into jid;
  select count(*) into c from public.jobs where id = jid and created_by = '00000000-0000-4000-8000-0000000000b2';
  r := array_append(r, 'office: add job, created_by forced to self'); b := array_append(b, c = 1);
  insert into public.job_prices (job_id, price) values (jid, 123.45);
  select count(*) into c from public.job_prices where job_id = jid;
  r := array_append(r, 'office: add + read price'); b := array_append(b, c = 1);
  insert into public.day_notes (day, note) values ('2026-10-20', 'test note');
  r := array_append(r, 'office: add day note'); b := array_append(b, true);
  update public.profiles set role = 'admin', active = true where id = '00000000-0000-4000-8000-0000000000b2';
  select count(*) into c from public.profiles where id = '00000000-0000-4000-8000-0000000000b2' and role = 'office';
  r := array_append(r, 'office: cannot make self admin'); b := array_append(b, c = 1);
  update public.profiles set full_name = 'Office Tester' where id = '00000000-0000-4000-8000-0000000000b2';
  select count(*) into c from public.profiles where full_name = 'Office Tester';
  r := array_append(r, 'office: can set own name'); b := array_append(b, c = 1);
  update public.profiles set full_name = 'hacked' where id = '00000000-0000-4000-8000-0000000000a1';
  select count(*) into c from public.profiles where full_name = 'hacked';
  r := array_append(r, 'office: cannot rename others'); b := array_append(b, c = 0);
  begin insert into public.job_history (job_id, action) values (jid, 'fake'); err := 'allowed'; exception when others then err := 'blocked'; end;
  r := array_append(r, 'office: cannot write history'); b := array_append(b, err = 'blocked');
  select count(*) into c from public.job_history where job_id = jid;
  r := array_append(r, 'office: sees job + price history (' || c || ')'); b := array_append(b, c = 2);
  -- DEPOT
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
  select count(*) into c from public.jobs where id = jid;
  r := array_append(r, 'depot: sees job'); b := array_append(b, c = 1);
  select count(*) into c from public.job_prices;
  r := array_append(r, 'depot: sees no prices'); b := array_append(b, c = 0);
  select count(*) into c from public.job_history where job_id = jid;
  r := array_append(r, 'depot: no price history (' || c || ')'); b := array_append(b, c = 1);
  begin insert into public.job_prices (job_id, price) values (jid, 1); err := 'allowed'; exception when others then err := 'blocked'; end;
  r := array_append(r, 'depot: cannot write price'); b := array_append(b, err = 'blocked');
  -- PENDING (not yet approved)
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
  select count(*) into c from public.jobs;
  r := array_append(r, 'pending: sees no jobs'); b := array_append(b, c = 0);
  select count(*) into c from public.day_notes;
  r := array_append(r, 'pending: sees no notes'); b := array_append(b, c = 0);
  begin insert into public.jobs (client) values ('x'); err := 'allowed'; exception when others then err := 'blocked'; end;
  r := array_append(r, 'pending: cannot add job'); b := array_append(b, err = 'blocked');
  select count(*) into c from public.profiles;
  r := array_append(r, 'pending: sees only own profile (' || c || ')'); b := array_append(b, c = 1);
  update public.profiles set active = true where id = '00000000-0000-4000-8000-0000000000d4';
  perform set_config('role', 'postgres', true);
  select count(*) into c from public.profiles where id = '00000000-0000-4000-8000-0000000000d4' and active;
  r := array_append(r, 'pending: cannot approve self'); b := array_append(b, c = 0);
  -- NOT SIGNED IN
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin select count(*) into c from public.jobs; err := 'allowed ' || c; exception when others then err := 'blocked'; end;
  r := array_append(r, 'anon: cannot read jobs (' || err || ')'); b := array_append(b, err = 'blocked' or err = 'allowed 0');
  begin select count(*) into c from public.profiles; err := 'allowed ' || c; exception when others then err := 'blocked'; end;
  r := array_append(r, 'anon: cannot read profiles (' || err || ')'); b := array_append(b, err = 'blocked' or err = 'allowed 0');
  -- ADMIN
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  update public.profiles set active = true where id = '00000000-0000-4000-8000-0000000000d4';
  select count(*) into c from public.profiles where id = '00000000-0000-4000-8000-0000000000d4' and active;
  r := array_append(r, 'admin: can approve a user'); b := array_append(b, c = 1);
  begin update public.profiles set role = 'office' where id = '00000000-0000-4000-8000-0000000000a1'; err := 'allowed'; exception when others then err := 'blocked'; end;
  r := array_append(r, 'admin: cannot demote self'); b := array_append(b, err = 'blocked');
  raise exception 'rollback';
  exception when others then
    perform set_config('role', 'postgres', true);
    if sqlerrm <> 'rollback' then r := array_append(r, 'SUITE CRASHED: ' || sqlerrm); b := array_append(b, false); end if;
  end;
  for i in 1 .. coalesce(array_length(r, 1), 0) loop insert into t_results(test, ok) values (r[i], b[i]); end loop;
end $$;
select test, ok from t_results order by n;

-- ===== Attachments (job_files + bucket job-files), added 2026-10-20. Same pattern: run, read the table, nothing is kept. =====
create temp table if not exists t_results (n serial, test text, ok boolean);
truncate t_results;
do $$
declare c int; jid uuid; err text; r text[] := array[]::text[]; b boolean[] := array[]::boolean[];
begin
  begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
  insert into public.jobs (client) values ('file test') returning id into jid;
  insert into public.job_files (job_id, path, name, size, mime, uploaded_by) values (jid, jid::text || '/x-a.pdf', 'a.pdf', 10, 'application/pdf', '00000000-0000-4000-8000-0000000000a1');
  select count(*) into c from public.job_files where job_id = jid and uploaded_by = '00000000-0000-4000-8000-0000000000b2';
  r := array_append(r, 'office: add file row, uploader forced to self'); b := array_append(b, c = 1);
  begin insert into public.job_files (job_id, path, name, size) values (jid, 'other/x-b.pdf', 'b.pdf', 1); err := 'allowed'; exception when others then err := 'blocked'; end;
  r := array_append(r, 'office: file path must be under its job'); b := array_append(b, err = 'blocked');
  select count(*) into c from public.job_history where job_id = jid and action = 'file-insert';
  r := array_append(r, 'file upload is logged in history'); b := array_append(b, c = 1);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
  select count(*) into c from public.job_files;
  r := array_append(r, 'depot: sees no files'); b := array_append(b, c = 0);
  begin insert into public.job_files (job_id, path, name, size) values (jid, jid::text || '/x-c.pdf', 'c.pdf', 1); err := 'allowed'; exception when others then err := 'blocked'; end;
  r := array_append(r, 'depot: cannot add file'); b := array_append(b, err = 'blocked');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
  select count(*) into c from public.job_files;
  r := array_append(r, 'pending: sees no files'); b := array_append(b, c = 0);
  select count(*) into c from storage.objects where bucket_id = 'job-files';
  r := array_append(r, 'pending: sees no stored objects'); b := array_append(b, c = 0);
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin select count(*) into c from public.job_files; err := 'allowed ' || c; exception when others then err := 'blocked'; end;
  r := array_append(r, 'anon: cannot read files (' || err || ')'); b := array_append(b, err = 'blocked' or err = 'allowed 0');
  raise exception 'rollback';
  exception when others then
    perform set_config('role', 'postgres', true);
    if sqlerrm <> 'rollback' then r := array_append(r, 'SUITE CRASHED: ' || sqlerrm); b := array_append(b, false); end if;
  end;
  for i in 1 .. coalesce(array_length(r, 1), 0) loop insert into t_results(test, ok) values (r[i], b[i]); end loop;
end $$;
select test, ok from t_results order by n;

-- ===== Invoices (job_invoices), added 2026-10-22. Run on its own; read the result table. =====
create temp table if not exists t_inv (n serial, test text, ok boolean);
do $$
declare c int; j1 uuid; j2 uuid; err text; r text[] := array[]::text[]; b boolean[] := array[]::boolean[];
begin
  begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
  insert into public.jobs (client) values ('inv 1') returning id into j1;
  insert into public.jobs (client) values ('inv 2') returning id into j2;
  insert into public.job_invoices (job_id, invoice_no) values (j1, 'INV-100'), (j2, 'INV-100');
  select count(*) into c from public.job_invoices where invoice_no = 'INV-100' and updated_by = '00000000-0000-4000-8000-0000000000b2';
  r := array_append(r, 'office: one invoice no on two jobs'); b := array_append(b, c = 2);
  insert into public.job_invoices (job_id, invoice_no) values (j1, 'INV-101') on conflict (job_id) do update set invoice_no = excluded.invoice_no;
  select count(*) into c from public.job_invoices where job_id = j1 and invoice_no = 'INV-101';
  r := array_append(r, 'office: change invoice no (upsert)'); b := array_append(b, c = 1);
  begin insert into public.job_invoices (job_id, invoice_no) values (j2, '  ') on conflict (job_id) do update set invoice_no = excluded.invoice_no; err := 'allowed'; exception when others then err := 'blocked'; end;
  r := array_append(r, 'blank invoice no refused'); b := array_append(b, err = 'blocked');
  select count(*) into c from public.job_history where job_id = j1 and action like 'invoice-%';
  r := array_append(r, 'invoice changes logged'); b := array_append(b, c = 2);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
  select count(*) into c from public.job_invoices;
  r := array_append(r, 'depot: sees no invoices'); b := array_append(b, c = 0);
  select count(*) into c from public.job_history where job_id = j1 and action like 'invoice-%';
  r := array_append(r, 'depot: no invoice history'); b := array_append(b, c = 0);
  begin insert into public.job_invoices (job_id, invoice_no) values (j2, 'X') on conflict (job_id) do update set invoice_no = excluded.invoice_no; err := 'allowed'; exception when others then err := 'blocked'; end;
  r := array_append(r, 'depot: cannot set invoice'); b := array_append(b, err = 'blocked');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
  select count(*) into c from public.job_invoices;
  r := array_append(r, 'pending: sees no invoices'); b := array_append(b, c = 0);
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin select count(*) into c from public.job_invoices; err := 'allowed ' || c; exception when others then err := 'blocked'; end;
  r := array_append(r, 'anon: cannot read invoices (' || err || ')'); b := array_append(b, err = 'blocked' or err = 'allowed 0');
  raise exception 'rollback';
  exception when others then
    perform set_config('role', 'postgres', true);
    if sqlerrm <> 'rollback' then r := array_append(r, 'SUITE CRASHED: ' || sqlerrm); b := array_append(b, false); end if;
  end;
  for i in 1 .. coalesce(array_length(r, 1), 0) loop insert into t_inv(test, ok) values (r[i], b[i]); end loop;
end $$;
select test, ok from t_inv order by n;

-- ===== Suggestions, added 2026-10-27. Run on its own; read the result table. =====
create temp table if not exists t_sug (n serial, test text, ok boolean);
do $$
declare c int; sid uuid; err text; r text[] := array[]::text[]; b boolean[] := array[]::boolean[];
begin
  begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
  insert into public.suggestions (body, status, admin_note) values ('Bigger buttons', 'done', 'x') returning id into sid;
  select count(*) into c from public.suggestions where id = sid and status = 'new' and admin_note = '' and created_by = '00000000-0000-4000-8000-0000000000c3';
  r := array_append(r, 'depot: can post; cannot set status/reply'); b := array_append(b, c = 1);
  insert into public.suggestion_votes (suggestion_id) values (sid);
  begin insert into public.suggestion_votes (suggestion_id, user_id) values (sid, '00000000-0000-4000-8000-0000000000b2'); err := 'allowed'; exception when others then err := 'blocked'; end;
  r := array_append(r, 'cannot vote for someone else'); b := array_append(b, err = 'blocked');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
  update public.suggestions set body = 'hacked' where id = sid;
  select count(*) into c from public.suggestions where id = sid and body = 'Bigger buttons';
  r := array_append(r, 'office: cannot edit someone else''s text'); b := array_append(b, c = 1);
  insert into public.suggestion_votes (suggestion_id) values (sid);
  select count(*) into c from public.suggestion_votes where suggestion_id = sid;
  r := array_append(r, 'two people voted'); b := array_append(b, c = 2);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  update public.suggestions set status = 'planned', admin_note = 'Next week' where id = sid;
  select count(*) into c from public.suggestions where id = sid and status = 'planned' and admin_note = 'Next week';
  r := array_append(r, 'admin: sets status and reply'); b := array_append(b, c = 1);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d4","role":"authenticated"}', true);
  select count(*) into c from public.suggestions;
  r := array_append(r, 'pending: sees no suggestions'); b := array_append(b, c = 0);
  perform set_config('role', 'anon', true); perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin select count(*) into c from public.suggestions; err := 'allowed ' || c; exception when others then err := 'blocked'; end;
  r := array_append(r, 'anon: nothing (' || err || ')'); b := array_append(b, err = 'blocked' or err = 'allowed 0');
  raise exception 'rollback';
  exception when others then
    perform set_config('role', 'postgres', true);
    if sqlerrm <> 'rollback' then r := array_append(r, 'SUITE CRASHED: ' || sqlerrm); b := array_append(b, false); end if;
  end;
  for i in 1 .. coalesce(array_length(r, 1), 0) loop insert into t_sug(test, ok) values (r[i], b[i]); end loop;
end $$;
select test, ok from t_sug order by n;
