-- Students can also mark attendance from the app without scanning (method 'app'), when the academy allows it
-- (settings.attendanceNoQr, default on). Same rules as the QR: own batch, class open now, once per class.
alter table class_marks drop constraint if exists class_marks_method_check;
alter table class_marks add constraint class_marks_method_check check (method in ('qr', 'manual', 'app'));

drop function if exists public.attend_lookup(text);
drop function if exists public.attend_mark(text);
drop function if exists public._attend_target(text);

-- p_token null = marking from the app without a QR scan
create function public._attend_target(p_token text, out s students, out c class_sessions, out nx class_sessions, out reason text)
language plpgsql stable security definer set search_path = public as $$
declare em text := lower(coalesce(auth.jwt() ->> 'email', '')); w jsonb; before_m int; after_m int;
begin
  if em !~ '@student\.investmore\.invalid$' then reason := 'Please sign in with your student login.'; return; end if;
  if p_token is not null and not exists (select 1 from classroom_qr where token = p_token and active) then
    reason := 'This QR code is old or not valid. Please scan the QR code put up in the classroom.'; return;
  end if;
  select * into s from students where public.login_email(code, 'student') = em;
  if s.id is null then reason := 'No student record found for this login.'; return; end if;
  if not public.in_batch(s) or coalesce(s.batch_id, '') = '' then reason := 'You are not in a batch yet. Please ask the academy office to add you to your batch.'; return; end if;
  select settings -> 'attendanceWindow' into w from app_state where id = 1;
  before_m := coalesce((w ->> 'beforeMins')::int, 15); after_m := coalesce((w ->> 'afterMins')::int, 15);
  select * into c from class_sessions x
   where x.batch_id = s.batch_id and x.status = 'scheduled'
     and now() between public.class_start(x) - make_interval(mins => before_m) and public.class_end(x) + make_interval(mins => after_m)
   order by public.class_start(x) limit 1;
  if c.id is not null then return; end if;
  select * into nx from class_sessions x where x.batch_id = s.batch_id and x.status = 'scheduled' and public.class_start(x) > now()
   order by public.class_start(x) limit 1;
  reason := case when nx.id is null
    then 'Your batch has no class scheduled right now, so attendance is closed.'
    else format('Attendance is closed now. Your next class is on %s at %s — you can mark attendance from %s minutes before it starts.',
      to_char(nx.date, 'FMDay, FMDD Mon'), to_char(nx.start_time::time, 'FMHH12:MI AM'), before_m) end;
end $$;
revoke all on function public._attend_target(text) from public, anon, authenticated;

create or replace function public._no_qr_allowed() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select (settings ->> 'attendanceNoQr')::boolean from app_state where id = 1), true) $$;
revoke all on function public._no_qr_allowed() from public, anon, authenticated;

create function public.attend_lookup(p_token text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; m class_marks; cc class_sessions;
begin
  select * into r from public._attend_target(p_token);
  cc := coalesce(r.c, r.nx);
  if cc.id is not null then select * into m from class_marks where class_id = cc.id and student_id = (r.s).id; end if;
  return jsonb_build_object(
    'ok', r.reason is null, 'reason', r.reason, 'open', (r.c).id is not null, 'noQrAllowed', public._no_qr_allowed(),
    'classId', cc.id, 'date', cc.date, 'start', cc.start_time, 'end', cc.end_time, 'notes', cc.notes,
    'batch', (select name from batches where id = cc.batch_id),
    'course', (select co.name from batches b join courses co on co.id = b.course_id where b.id = cc.batch_id),
    'teacher', (select e.name from batches b join employees e on e.id = b.teacher_id where b.id = cc.batch_id),
    'already', coalesce(m.status = 'present', false), 'at', m.at, 'method', m.method);
end $$;
revoke all on function public.attend_lookup(text) from public, anon;
grant execute on function public.attend_lookup(text) to authenticated;

create function public.attend_mark(p_token text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; m class_marks; how text := case when p_token is null then 'app' else 'qr' end;
begin
  if p_token is null and not public._no_qr_allowed() then
    return jsonb_build_object('ok', false, 'reason', 'Please scan the classroom QR code to mark your attendance.');
  end if;
  select * into r from public._attend_target(p_token);
  if r.reason is not null then return jsonb_build_object('ok', false, 'reason', r.reason); end if;
  select * into m from class_marks where class_id = (r.c).id and student_id = (r.s).id;
  if m.status = 'present' then return jsonb_build_object('ok', true, 'already', true, 'at', m.at); end if;
  insert into class_marks (id, class_id, student_id, status, at, method, marked_by)
  values ((r.c).id || ':' || (r.s).id, (r.c).id, (r.s).id, 'present', now(), how, 'self')
  on conflict (id) do update set status = 'present', at = now(), method = how, marked_by = 'self'
  returning * into m;
  update attendance set present = (select coalesce(jsonb_agg(distinct v), '[]') from jsonb_array_elements_text(present || to_jsonb((r.s).id)) v)
   where batch_id = (r.c).batch_id and date = (r.c).date;
  if not found then
    insert into attendance (id, batch_id, date, present) values (gen_random_uuid()::text, (r.c).batch_id, (r.c).date, jsonb_build_array((r.s).id));
  end if;
  insert into audit_log (id, at, by_user, action, entity, entity_id, detail)
  values (gen_random_uuid()::text, now(), (r.s).id, 'attendance.' || how, 'student', (r.s).id,
    (r.s).name || ' marked present ' || case how when 'qr' then 'by QR' else 'in the app (no QR)' end || ' · ' || (r.c).date || ' ' || (r.c).start_time);
  return jsonb_build_object('ok', true, 'already', false, 'at', m.at, 'method', how);
end $$;
revoke all on function public.attend_mark(text) from public, anon;
grant execute on function public.attend_mark(text) to authenticated;
