-- Class notifications that always arrive:
-- 1. Every newly scheduled upcoming class sends the "new class scheduled" push straight away, whatever its date
--    (0022 only did so within 48 hours). Scheduling many classes at once still sends ONE push per batch: the app
--    uploads them in one statement, so they share now() and only the first class of that batch is announced.
--    Classes scheduled one by one are separate statements and each is announced.
-- 2. A student who turns on notifications late still gets what they missed: when a device is registered,
--    their "no device" announcements for classes that haven't ended (and the 30-minute reminder for a class
--    that hasn't started) are sent again.
-- 3. Staff can see which students have notifications turned on (push_ready_students), to ask the others to.

create or replace function public._class_reminders_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform public.plan_class_reminders(new.id);
  if public.class_end(new) <= now() then return new; end if;
  if tg_op = 'INSERT' then
    k := case when new.status = 'scheduled' and not exists (
      select 1 from notification_jobs j join class_sessions x on x.id = j.class_id
       where x.batch_id = new.batch_id and x.id <> new.id and j.kind = 'scheduled' and j.created_at = now()
    ) then 'scheduled' end;
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

create or replace function public.save_push_token(p_token text, p_user_agent text default '') returns void
language plpgsql security definer set search_path = public as $$
declare sid text := public._my_student_id();
begin
  if sid is null then raise exception 'Only students can turn on class reminders.'; end if;
  if coalesce(length(p_token), 0) < 20 then raise exception 'Invalid notification token.'; end if;
  insert into push_tokens (token, student_id, user_agent) values (p_token, sid, left(coalesce(p_user_agent, ''), 300))
  on conflict (token) do update set student_id = sid, last_seen = now(), user_agent = excluded.user_agent;
  -- send again what this student missed while they had no device (only what still makes sense)
  update notification_jobs j set status = 'pending', next_try_at = now(), attempts = 0, error = null
    from class_sessions c
   where j.class_id = c.id and j.student_id = sid and j.status = 'no_device'
     and ((j.kind in ('scheduled', 'rescheduled') and c.status = 'scheduled' and public.class_end(c) > now())
       or (j.kind = 'cancelled' and c.status = 'cancelled' and public.class_end(c) > now())
       or (j.kind = 'soon' and c.status = 'scheduled' and public.class_start(c) > now()));
end $$;
revoke all on function public.save_push_token(text, text) from public, anon;
grant execute on function public.save_push_token(text, text) to authenticated;

create or replace function public.push_ready_students() returns setof text
language sql stable security definer set search_path = public as $$
  select distinct t.student_id from push_tokens t where public.is_staff()
$$;
revoke all on function public.push_ready_students() from public, anon;
grant execute on function public.push_ready_students() to authenticated;
