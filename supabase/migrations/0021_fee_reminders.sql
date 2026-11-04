-- Fee reminders as app (push) notifications, sent through the same pipeline as class reminders.
-- Every morning at 9:30 AM India time the server checks each unpaid instalment and queues a reminder:
--   fee_soon    3 days before the due date
--   fee_today   on the due date
--   fee_overdue 1, 3, 7, 14, 21 and 28 days after the due date, while money is still owed
-- "Still owed" uses the app's own rule: verified payments (minus reversed ones) fill instalments in order.
-- Students who are Dropped / Refunded, or opted out of payment reminders, get none.

alter table notification_jobs add column if not exists instalment_id text references instalments(id) on delete cascade;
alter table notification_jobs add column if not exists for_day date;
alter table notification_jobs add column if not exists title text;
alter table notification_jobs add column if not exists body text;
alter table notification_jobs drop constraint if exists notification_jobs_kind_check;
alter table notification_jobs add constraint notification_jobs_kind_check
  check (kind in ('day_before', 'morning', 'soon', 'test', 'scheduled', 'rescheduled', 'cancelled', 'fee_soon', 'fee_today', 'fee_overdue'));
-- one reminder per instalment, kind and day, even if the planner runs twice
create unique index if not exists notification_jobs_fee_once on notification_jobs (instalment_id, kind, for_day) where instalment_id is not null;

create or replace function public.plan_fee_reminders(p_day date default (now() at time zone 'Asia/Kolkata')::date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with paid as (   -- money received per student, as the app counts it
    select p.student_id, sum(p.amount) as pool
      from payments p
     where p.kind = 'payment' and p.verified
       and not exists (select 1 from payments r where r.kind = 'reversal' and r.reverses_id = p.id)
     group by p.student_id),
  lines as (       -- active instalments with what is still owed on each (filled oldest first)
    select i.id, i.student_id, i.label, i.amount, i.due_date,
           i.amount - least(i.amount, greatest(0, coalesce(pd.pool, 0)
             - coalesce(sum(i.amount) over (partition by i.student_id order by i.seq rows between unbounded preceding and 1 preceding), 0))) as owed
      from instalments i left join paid pd on pd.student_id = i.student_id
     where i.state = 'active'),
  due as (
    select l.*, s.name,
           case when l.due_date = p_day + 3 then 'fee_soon'
                when l.due_date = p_day then 'fee_today'
                when p_day - l.due_date in (1, 3, 7, 14, 21, 28) then 'fee_overdue' end as kind
      from lines l join students s on s.id = l.student_id
     where l.owed > 0 and s.status not in ('Dropped', 'Refunded') and not s.reminders_opt_out),
  msg as (
    select d.*, coalesce(nullif(split_part(trim(d.name), ' ', 1), ''), 'there') as first,
           '₹' || to_char(round(d.owed / 100.0), 'FM99,99,99,99,999') as rs,
           to_char(d.due_date, 'FMDay, FMDD FMMonth') as on_day
      from due d where d.kind is not null)
  insert into notification_jobs (student_id, instalment_id, kind, for_day, send_at, title, body)
  select m.student_id, m.id, m.kind, p_day, now(),
         case m.kind
           when 'fee_soon'  then '💳 Hi ' || m.first || ', your fee is due in 3 days'
           when 'fee_today' then '📌 Hi ' || m.first || ', your fee is due today'
           else '⚠️ Hi ' || m.first || ', your fee payment is overdue' end,
         case m.kind
           when 'fee_soon'  then m.rs || ' (' || m.label || ') is due on ' || m.on_day || '. Pay at the academy office or by UPI to keep your course on track. — InvestMore Training Academy'
           when 'fee_today' then m.rs || ' (' || m.label || ') is due today. Please pay at the academy office or by UPI today. — InvestMore Training Academy'
           else m.rs || ' (' || m.label || ') was due on ' || m.on_day || '. Please pay as soon as possible, or talk to the academy office if you need help. — InvestMore Training Academy' end
    from msg m
  on conflict (instalment_id, kind, for_day) where instalment_id is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.plan_fee_reminders(date) from public, anon, authenticated;

-- the sender now also receives the ready-made fee message
drop function if exists public.claim_due_jobs(int);
create function public.claim_due_jobs(p_limit int default 200) returns table (
  id bigint, kind text, attempts int, class_id text, student_id text, student text, course text, batch text,
  date date, start_time text, end_time text, tokens text[], title text, body text)
language plpgsql security definer set search_path = public as $$
begin
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
    (select s.name from students s where s.id = j.student_id),
    (select co.name from class_sessions c join batches b on b.id = c.batch_id join courses co on co.id = b.course_id where c.id = j.class_id),
    (select b.name from class_sessions c join batches b on b.id = c.batch_id where c.id = j.class_id),
    (select c.date from class_sessions c where c.id = j.class_id),
    (select c.start_time from class_sessions c where c.id = j.class_id),
    (select c.end_time from class_sessions c where c.id = j.class_id),
    array(select t.token from push_tokens t where t.student_id = j.student_id),
    j.title, j.body;
end $$;
revoke all on function public.claim_due_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_due_jobs(int) to service_role;

-- every day at 04:00 UTC = 9:30 AM India time; the every-minute sender delivers them
select cron.unschedule(jobid) from cron.job where jobname = 'plan-fee-reminders';
select cron.schedule('plan-fee-reminders', '0 4 * * *', $$ select public.plan_fee_reminders() $$);
