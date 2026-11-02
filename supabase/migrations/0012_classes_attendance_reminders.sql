-- Class schedule, per-class attendance, classroom QR attendance and class reminder (push) jobs.
-- Class times are India time (Asia/Kolkata); reminders are planned and sent by the server, never by browser timers.

-- ---------------- classes & attendance (synced with the app, staff only) ----------------
create table if not exists class_sessions (
  id text primary key,
  batch_id text not null references batches(id) on delete cascade,
  date date not null,
  start_time text not null check (start_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  end_time text not null check (end_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists class_sessions_batch_idx on class_sessions (batch_id, date);

create table if not exists class_marks (
  id text primary key,                         -- '<class id>:<student id>'
  class_id text not null references class_sessions(id) on delete cascade,
  student_id text not null references students(id) on delete cascade,
  status text not null check (status in ('present', 'absent')),
  at timestamptz not null default now(),
  method text not null check (method in ('qr', 'manual')),
  marked_by text not null default '',
  unique (class_id, student_id)                -- one record per student per class
);
create index if not exists class_marks_student_idx on class_marks (student_id);

do $$
declare t text;
begin
  foreach t in array array['class_sessions', 'class_marks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists staff_all on %I', t);
    execute format('create policy staff_all on %I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

-- class start / end as real moments in time
create or replace function public.class_start(c class_sessions) returns timestamptz language sql immutable as
$$ select (c.date + c.start_time::time) at time zone 'Asia/Kolkata' $$;
create or replace function public.class_end(c class_sessions) returns timestamptz language sql immutable as
$$ select (c.date + c.end_time::time) at time zone 'Asia/Kolkata' $$;

-- ---------------- classroom QR (one active code, reusable for every class) ----------------
create table if not exists classroom_qr (
  id text primary key default gen_random_uuid()::text,
  token text not null unique,
  classroom text not null default 'Main classroom',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table classroom_qr enable row level security;
revoke all on classroom_qr from anon, authenticated;   -- only through the functions below

create or replace function public.classroom_qr_token(p_regenerate boolean default false) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if not public.is_staff() then raise exception 'Only staff can see the classroom QR code.'; end if;
  if p_regenerate then update classroom_qr set active = false, revoked_at = now() where active; end if;
  select token into t from classroom_qr where active order by created_at desc limit 1;
  if t is null then
    t := encode(gen_random_bytes(18), 'hex');
    insert into classroom_qr (token) values (t);
  end if;
  return t;
end $$;
revoke all on function public.classroom_qr_token(boolean) from public, anon;
grant execute on function public.classroom_qr_token(boolean) to authenticated;

-- ---------------- student: mark own attendance with the QR ----------------
-- Everything is checked here, never trusted from the phone: the QR is active, the signed-in student is
-- enrolled (active) in the batch, and one of that batch's classes is open right now.
create or replace function public._attend_target(p_token text, out s students, out c class_sessions, out reason text)
language plpgsql stable security definer set search_path = public as $$
declare em text := lower(coalesce(auth.jwt() ->> 'email', '')); w jsonb; before_m int; after_m int;
begin
  if em !~ '@student\.investmore\.invalid$' then reason := 'Please sign in with your student login.'; return; end if;
  if not exists (select 1 from classroom_qr where token = coalesce(p_token, '') and active) then
    reason := 'This QR code is not valid any more. Please scan the code in the classroom.'; return;
  end if;
  select * into s from students where public.login_email(code, 'student') = em;
  if s.id is null then reason := 'No student record found for this login.'; return; end if;
  if s.status <> 'Active' or coalesce(s.batch_id, '') = '' then reason := 'You are not in an active batch. Please contact the office.'; return; end if;
  select settings -> 'attendanceWindow' into w from app_state where id = 1;
  before_m := coalesce((w ->> 'beforeMins')::int, 15); after_m := coalesce((w ->> 'afterMins')::int, 15);
  select * into c from class_sessions x
   where x.batch_id = s.batch_id and x.status = 'scheduled'
     and now() between public.class_start(x) - make_interval(mins => before_m) and public.class_end(x) + make_interval(mins => after_m)
   order by public.class_start(x) limit 1;
  if c.id is null then reason := 'There is no class of your batch open for attendance right now.'; end if;
end $$;
revoke all on function public._attend_target(text) from public, anon, authenticated;

create or replace function public.attend_lookup(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; m class_marks;
begin
  select * into r from public._attend_target(p_token);
  if r.reason is not null then return jsonb_build_object('ok', false, 'reason', r.reason); end if;
  select * into m from class_marks where class_id = (r.c).id and student_id = (r.s).id;
  return jsonb_build_object('ok', true, 'classId', (r.c).id, 'batch', (select name from batches where id = (r.c).batch_id),
    'date', (r.c).date, 'start', (r.c).start_time, 'end', (r.c).end_time, 'student', (r.s).name,
    'already', m.status = 'present', 'at', m.at);
end $$;
revoke all on function public.attend_lookup(text) from public, anon;
grant execute on function public.attend_lookup(text) to authenticated;

create or replace function public.attend_mark(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; m class_marks;
begin
  select * into r from public._attend_target(p_token);
  if r.reason is not null then return jsonb_build_object('ok', false, 'reason', r.reason); end if;
  select * into m from class_marks where class_id = (r.c).id and student_id = (r.s).id;
  if m.status = 'present' then return jsonb_build_object('ok', true, 'already', true, 'at', m.at); end if;
  insert into class_marks (id, class_id, student_id, status, at, method, marked_by)
  values ((r.c).id || ':' || (r.s).id, (r.c).id, (r.s).id, 'present', now(), 'qr', 'self')
  on conflict (id) do update set status = 'present', at = now(), method = 'qr', marked_by = 'self'
  returning * into m;
  -- keep the day-level attendance record (student profile, reports, portal) in step
  update attendance set present = (select coalesce(jsonb_agg(distinct v), '[]') from jsonb_array_elements_text(present || to_jsonb((r.s).id)) v)
   where batch_id = (r.c).batch_id and date = (r.c).date;
  if not found then
    insert into attendance (id, batch_id, date, present) values (gen_random_uuid()::text, (r.c).batch_id, (r.c).date, jsonb_build_array((r.s).id));
  end if;
  insert into audit_log (id, at, by_user, action, entity, entity_id, detail)
  values (gen_random_uuid()::text, now(), (r.s).id, 'attendance.qr', 'student', (r.s).id, (r.s).name || ' marked present by QR · ' || (r.c).date || ' ' || (r.c).start_time);
  return jsonb_build_object('ok', true, 'already', false, 'at', m.at);
end $$;
revoke all on function public.attend_mark(text) from public, anon;
grant execute on function public.attend_mark(text) to authenticated;

-- ---------------- push notification devices ----------------
create table if not exists push_tokens (
  token text primary key,
  student_id text not null references students(id) on delete cascade,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists push_tokens_student_idx on push_tokens (student_id);
alter table push_tokens enable row level security;
revoke all on push_tokens from anon, authenticated;

create or replace function public._my_student_id() returns text
language sql stable security definer set search_path = public as $$
  select id from students where public.login_email(code, 'student') = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;
revoke all on function public._my_student_id() from public, anon, authenticated;

-- a student saves this browser's push token (one row per device / browser)
create or replace function public.save_push_token(p_token text, p_user_agent text default '') returns void
language plpgsql security definer set search_path = public as $$
declare sid text := public._my_student_id();
begin
  if sid is null then raise exception 'Only students can turn on class reminders.'; end if;
  if coalesce(length(p_token), 0) < 20 then raise exception 'Invalid notification token.'; end if;
  insert into push_tokens (token, student_id, user_agent) values (p_token, sid, left(coalesce(p_user_agent, ''), 300))
  on conflict (token) do update set student_id = sid, last_seen = now(), user_agent = excluded.user_agent;
end $$;
revoke all on function public.save_push_token(text, text) from public, anon;
grant execute on function public.save_push_token(text, text) to authenticated;

-- ---------------- reminder jobs ----------------
create table if not exists notification_jobs (
  id bigserial primary key,
  class_id text references class_sessions(id) on delete cascade,   -- null for a test message
  student_id text not null references students(id) on delete cascade,
  kind text not null check (kind in ('day_before', 'morning', 'soon', 'test')),
  send_at timestamptz not null,
  next_try_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'no_device', 'expired')),
  attempts int not null default 0,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (class_id, student_id, kind, send_at)                      -- no duplicates for the same moment
);
create index if not exists notification_jobs_due_idx on notification_jobs (status, coalesce(next_try_at, send_at));
create index if not exists notification_jobs_class_idx on notification_jobs (class_id);
alter table notification_jobs enable row level security;
drop policy if exists staff_read on notification_jobs;
create policy staff_read on notification_jobs for select to authenticated using (public.is_staff());
revoke all on notification_jobs from anon;
revoke insert, update, delete on notification_jobs from authenticated;

-- (Re)plan the 3 reminders of one class for every active student of its batch.
-- Pending reminders are dropped first, so a reschedule replaces them and a cancel removes them.
create or replace function public.plan_class_reminders(p_class_id text) returns void
language plpgsql security definer set search_path = public as $$
declare c class_sessions; st timestamptz;
begin
  delete from notification_jobs where class_id = p_class_id and status = 'pending';
  select * into c from class_sessions where id = p_class_id;
  if c.id is null or c.status <> 'scheduled' then return; end if;
  st := public.class_start(c);
  insert into notification_jobs (class_id, student_id, kind, send_at)
  select c.id, s.id, k.kind, k.at
    from students s
    cross join (values ('day_before', st - interval '24 hours'),
                       ('morning', (c.date + time '08:00') at time zone 'Asia/Kolkata'),
                       ('soon', st - interval '30 minutes')) as k(kind, at)
   where s.batch_id = c.batch_id and s.status = 'Active'
     and k.at > now() and k.at < st
     and not (k.kind = 'morning' and k.at >= st - interval '30 minutes')   -- early class: the 30-minute one is enough
  on conflict do nothing;
end $$;
revoke all on function public.plan_class_reminders(text) from public, anon, authenticated;

create or replace function public._class_reminders_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.plan_class_reminders(new.id); return new; end $$;
drop trigger if exists class_reminders on class_sessions;
create trigger class_reminders after insert or update of date, start_time, end_time, status, batch_id on class_sessions
  for each row execute function public._class_reminders_trg();

-- a student joins / leaves a batch: re-plan that batch's upcoming classes
create or replace function public._student_batch_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare x text;
begin
  for x in select id from class_sessions
            where batch_id in (new.batch_id, case when tg_op = 'UPDATE' then old.batch_id end)
              and status = 'scheduled' and public.class_start(class_sessions) > now() loop
    perform public.plan_class_reminders(x);
  end loop;
  return new;
end $$;
drop trigger if exists student_batch_reminders on students;
create trigger student_batch_reminders after insert or update of batch_id, status on students
  for each row execute function public._student_batch_trg();

-- a student asks for a test message on their devices
create or replace function public.send_test_reminder() returns void
language plpgsql security definer set search_path = public as $$
declare sid text := public._my_student_id();
begin
  if sid is null then raise exception 'Only students can do this.'; end if;
  if not exists (select 1 from push_tokens where student_id = sid) then raise exception 'Turn on notifications on this device first.'; end if;
  insert into notification_jobs (class_id, student_id, kind, send_at) values (null, sid, 'test', now()) on conflict do nothing;
end $$;
revoke all on function public.send_test_reminder() from public, anon;
grant execute on function public.send_test_reminder() to authenticated;

-- the sender (server function, service role only) takes due jobs; stuck ones are taken again after 10 minutes
create or replace function public.claim_due_jobs(p_limit int default 200) returns table (
  id bigint, kind text, attempts int, class_id text, student_id text, batch text, date date, start_time text, tokens text[])
language plpgsql security definer set search_path = public as $$
begin
  -- too late to be useful (class already started / message hours old)
  update notification_jobs j set status = 'expired', error = 'Too late to send'
   where j.status = 'pending' and coalesce(j.next_try_at, j.send_at) < now() - interval '2 hours';
  return query
  with due as (
    select j.id from notification_jobs j
     where (j.status = 'pending' and coalesce(j.next_try_at, j.send_at) <= now())
        or (j.status = 'sending' and j.next_try_at < now() - interval '10 minutes')
     order by j.send_at limit p_limit for update skip locked)
  update notification_jobs j set status = 'sending', attempts = j.attempts + 1, next_try_at = now()
    from due where j.id = due.id
  returning j.id, j.kind, j.attempts, j.class_id, j.student_id,
    (select b.name from class_sessions c join batches b on b.id = c.batch_id where c.id = j.class_id),
    (select c.date from class_sessions c where c.id = j.class_id),
    (select c.start_time from class_sessions c where c.id = j.class_id),
    array(select t.token from push_tokens t where t.student_id = j.student_id);
end $$;
revoke all on function public.claim_due_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_due_jobs(int) to service_role;

-- ---------------- student portal: add classes & own attendance ----------------
create or replace function public.my_portal() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare em text := lower(coalesce(auth.jwt() ->> 'email', '')); s students%rowtype;
begin
  if em !~ '@student\.investmore\.invalid$' then return null; end if;
  select * into s from students where public.login_email(code, 'student') = em;
  if s.id is null then return null; end if;
  return jsonb_build_object(
    'student', to_jsonb(s) - 'id_doc',
    'course', (select to_jsonb(c) from courses c where c.id = s.course_id),
    'batch', (select to_jsonb(b) from batches b where b.id = s.batch_id),
    'teacher', (select e.name from batches b join employees e on e.id = b.teacher_id where b.id = s.batch_id),
    'instalments', coalesce((select jsonb_agg(to_jsonb(i) order by i.seq) from instalments i where i.student_id = s.id), '[]'),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from payments p where p.student_id = s.id), '[]'),
    'enrolments', coalesce((select jsonb_agg(to_jsonb(x)) from enrolments x where x.student_id = s.id), '[]'),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object('date', a.date, 'present', a.present ? s.id) order by a.date desc)
       from attendance a join enrolments x on x.batch_id = a.batch_id and x.student_id = s.id
       where a.date >= x.from_date and (x.to_date is null or a.date <= x.to_date)), '[]'),
    'certificates', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'issued_at', c.issued_at, 'status', c.status)) from certificates c where c.student_id = s.id), '[]'),
    'classes', coalesce((select jsonb_agg(to_jsonb(c) order by c.date, c.start_time) from class_sessions c
       where c.batch_id = s.batch_id and c.date between (now() at time zone 'Asia/Kolkata')::date - 60 and (now() at time zone 'Asia/Kolkata')::date + 60), '[]'),
    'marks', coalesce((select jsonb_agg(to_jsonb(m)) from class_marks m where m.student_id = s.id), '[]'),
    'academy', (select settings -> 'academyName' from app_state where id = 1)
  );
end $$;
