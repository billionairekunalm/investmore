-- the student app: + what their fee invoices need (academy details, GST, who received each payment)
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
    'videos', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc) from batch_videos v where v.batch_id = s.batch_id), '[]'),
    'youtubeChannel', (select settings ->> 'youtubeChannel' from app_state where id = 1),
    'academy', (select settings -> 'academyName' from app_state where id = 1),
    'invoiceSettings', (select jsonb_build_object('invoice', settings -> 'invoice', 'gstRateBp', coalesce((settings ->> 'gstRateBp')::int, 0), 'academyName', settings ->> 'academyName') from app_state where id = 1),
    'staffNames', coalesce((select jsonb_object_agg(e.id, e.name) from employees e where e.id in (select p.received_by from payments p where p.student_id = s.id)), '{}'::jsonb)
  );
end $$;

