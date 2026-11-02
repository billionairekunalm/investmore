-- Same rule as the batch screens: a batch's students are everyone in it except Dropped / Refunded
-- (e.g. a "Completed" student still in the batch gets class notifications and can mark QR attendance).
create or replace function public.in_batch(s students) returns boolean language sql immutable as
$$ select s.status not in ('Dropped', 'Refunded') $$;

create or replace function public.plan_class_reminders(p_class_id text) returns void
language plpgsql security definer set search_path = public as $$
declare c class_sessions; st timestamptz;
begin
  delete from notification_jobs where class_id = p_class_id and status = 'pending' and kind in ('day_before', 'morning', 'soon');
  select * into c from class_sessions where id = p_class_id;
  if c.id is null or c.status <> 'scheduled' then return; end if;
  st := public.class_start(c);
  insert into notification_jobs (class_id, student_id, kind, send_at)
  select c.id, s.id, k.kind, k.at
    from students s
    cross join (values ('day_before', st - interval '24 hours'),
                       ('morning', (c.date + time '08:00') at time zone 'Asia/Kolkata'),
                       ('soon', st - interval '30 minutes')) as k(kind, at)
   where s.batch_id = c.batch_id and public.in_batch(s)
     and k.at > now() and k.at < st
     and not (k.kind = 'morning' and k.at >= st - interval '30 minutes')
  on conflict do nothing;
end $$;
revoke all on function public.plan_class_reminders(text) from public, anon, authenticated;

create or replace function public._class_reminders_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform public.plan_class_reminders(new.id);
  if public.class_end(new) <= now() then return new; end if;
  if tg_op = 'INSERT' then k := case when new.status = 'scheduled' then 'scheduled' end;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then k := 'cancelled';
  elsif new.status = 'scheduled' and old.status = 'cancelled' then k := 'scheduled';
  elsif new.status = 'scheduled' and (new.date, new.start_time, new.end_time) is distinct from (old.date, old.start_time, old.end_time) then k := 'rescheduled';
  end if;
  if k is not null then
    delete from notification_jobs where class_id = new.id and status = 'pending' and kind in ('scheduled', 'rescheduled', 'cancelled');
    insert into notification_jobs (class_id, student_id, kind, send_at)
    select new.id, s.id, k, now() from students s where s.batch_id = new.batch_id and public.in_batch(s)
    on conflict do nothing;
  end if;
  return new;
end $$;

-- QR attendance: same rule
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
  if not public.in_batch(s) or coalesce(s.batch_id, '') = '' then reason := 'You are not in a batch. Please contact the office.'; return; end if;
  select settings -> 'attendanceWindow' into w from app_state where id = 1;
  before_m := coalesce((w ->> 'beforeMins')::int, 15); after_m := coalesce((w ->> 'afterMins')::int, 15);
  select * into c from class_sessions x
   where x.batch_id = s.batch_id and x.status = 'scheduled'
     and now() between public.class_start(x) - make_interval(mins => before_m) and public.class_end(x) + make_interval(mins => after_m)
   order by public.class_start(x) limit 1;
  if c.id is null then reason := 'There is no class of your batch open for attendance right now.'; end if;
end $$;
revoke all on function public._attend_target(text) from public, anon, authenticated;

-- re-plan every upcoming class once, so students who were left out now get their timed reminders
do $$ declare x text; begin
  for x in select id from class_sessions where status = 'scheduled' and public.class_start(class_sessions) > now() loop
    perform public.plan_class_reminders(x);
  end loop;
end $$;
