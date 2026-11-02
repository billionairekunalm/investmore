-- Tell the batch's students straight away when a class is scheduled, rescheduled or cancelled
-- (sent within a minute by the reminder sender), in addition to the 3 timed reminders.
alter table notification_jobs drop constraint if exists notification_jobs_kind_check;
alter table notification_jobs add constraint notification_jobs_kind_check
  check (kind in ('day_before', 'morning', 'soon', 'test', 'scheduled', 'rescheduled', 'cancelled'));

create or replace function public._class_reminders_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform public.plan_class_reminders(new.id);
  if public.class_end(new) <= now() then return new; end if;            -- past classes: no announcement
  if tg_op = 'INSERT' then k := case when new.status = 'scheduled' then 'scheduled' end;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then k := 'cancelled';
  elsif new.status = 'scheduled' and old.status = 'cancelled' then k := 'scheduled';
  elsif new.status = 'scheduled' and (new.date, new.start_time, new.end_time) is distinct from (old.date, old.start_time, old.end_time) then k := 'rescheduled';
  end if;
  if k is not null then
    -- an announcement not sent yet for this class is replaced by the newest one
    delete from notification_jobs where class_id = new.id and status = 'pending' and kind in ('scheduled', 'rescheduled', 'cancelled');
    insert into notification_jobs (class_id, student_id, kind, send_at)
    select new.id, s.id, k, now() from students s where s.batch_id = new.batch_id and s.status = 'Active'
    on conflict do nothing;
  end if;
  return new;
end $$;
-- plan_class_reminders only clears the 3 timed reminders now, so a pending announcement survives it
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
   where s.batch_id = c.batch_id and s.status = 'Active'
     and k.at > now() and k.at < st
     and not (k.kind = 'morning' and k.at >= st - interval '30 minutes')
  on conflict do nothing;
end $$;
revoke all on function public.plan_class_reminders(text) from public, anon, authenticated;
