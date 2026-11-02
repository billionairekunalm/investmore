-- Reminders greet the student by name and mention the course, batch, day and time.
drop function if exists public.claim_due_jobs(int);
create function public.claim_due_jobs(p_limit int default 200) returns table (
  id bigint, kind text, attempts int, class_id text, student_id text, student text, course text, batch text,
  date date, start_time text, end_time text, tokens text[])
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
    array(select t.token from push_tokens t where t.student_id = j.student_id);
end $$;
revoke all on function public.claim_due_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_due_jobs(int) to service_role;
