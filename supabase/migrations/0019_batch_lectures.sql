-- YouTube lectures assigned to a batch (staff add them; only that batch's students see them in the app),
-- and the student app's certificate download.
create table if not exists batch_videos (
  id text primary key,
  batch_id text not null references batches(id) on delete cascade,
  title text not null,
  url text not null,
  video_id text not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  added_by text not null default ''
);
create index if not exists batch_videos_batch_idx on batch_videos (batch_id, created_at desc);
alter table batch_videos enable row level security;
drop policy if exists staff_all on batch_videos;
create policy staff_all on batch_videos for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on batch_videos from anon;

-- the student app: + lectures of my batch, + the academy's YouTube channel link
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
    'academy', (select settings -> 'academyName' from app_state where id = 1)
  );
end $$;

-- the student downloads their own issued certificate (template + filled-in data); nobody else's
create or replace function public.my_certificate(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cert', jsonb_build_object('id', c.id, 'data', c.data),
    'template', jsonb_build_object('id', t.id, 'name', t.name, 'fileType', t.file_type, 'data', t.data, 'fields', t.fields, 'createdAt', t.created_at))
  from certificates c join certificate_templates t on t.id = c.template_id
  where c.id = p_id and c.status = 'Issued' and c.student_id = public._my_student_id()
$$;
revoke all on function public.my_certificate(text) from public, anon;
grant execute on function public.my_certificate(text) to authenticated;
