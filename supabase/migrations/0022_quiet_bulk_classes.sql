-- Scheduling many classes at once (Batches → Attendance QR → Schedule classes) must not flood students with
-- "a new class is scheduled" pushes. A new class now sends that instant announcement only when it starts within the next
-- 48 hours. Every class still gets its normal reminders (day before, morning of, 30 minutes before), and
-- rescheduled / cancelled announcements are unchanged.
create or replace function public._class_reminders_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform public.plan_class_reminders(new.id);
  if public.class_end(new) <= now() then return new; end if;
  if tg_op = 'INSERT' then
    k := case when new.status = 'scheduled' and public.class_start(new) <= now() + interval '48 hours' then 'scheduled' end;
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

-- The app asks this before it allows scheduling many classes at once: if this update is not installed it stays
-- limited to the next few days, so students are never spammed.
create or replace function public.bulk_schedule_ready() returns boolean language sql stable as $$ select true $$;
grant execute on function public.bulk_schedule_ready() to authenticated;
