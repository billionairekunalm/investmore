-- QR attendance: when no class is open, tell the student exactly when their next class is and when attendance opens.
create or replace function public._attend_target(p_token text, out s students, out c class_sessions, out reason text)
language plpgsql stable security definer set search_path = public as $$
declare em text := lower(coalesce(auth.jwt() ->> 'email', '')); w jsonb; before_m int; after_m int; nx class_sessions;
begin
  if em !~ '@student\.investmore\.invalid$' then reason := 'Please sign in with your student login.'; return; end if;
  if not exists (select 1 from classroom_qr where token = coalesce(p_token, '') and active) then
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

-- the student portal shows a "class is on — scan now" prompt while attendance is open
create or replace function public.attendance_window() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('beforeMins', coalesce((settings -> 'attendanceWindow' ->> 'beforeMins')::int, 15),
                            'afterMins', coalesce((settings -> 'attendanceWindow' ->> 'afterMins')::int, 15))
  from app_state where id = 1
$$;
revoke all on function public.attendance_window() from public, anon;
grant execute on function public.attendance_window() to authenticated;
