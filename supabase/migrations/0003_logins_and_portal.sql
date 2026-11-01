-- Login IDs (no email) for the admin and for students, plus the student portal.
-- A login ID maps to an internal address on the reserved, never-deliverable '.invalid' domain
-- (so no email is ever sent and nobody can receive a reset link for it):
--   staff   'investmore' -> investmore@staff.investmore.invalid
--   student 'IMNOV0001'  -> imnov0001@student.investmore.invalid
-- Passwords are stored by Supabase Auth (bcrypt). Staff data stays behind is_staff(); a student can only
-- read their own records through my_portal().

begin;

create or replace function public.login_email(login_id text, kind text) returns text
language sql immutable as $$
  select lower(regexp_replace(trim(login_id), '[^A-Za-z0-9._-]', '', 'g')) || '@' || kind || '.investmore.invalid'
$$;
grant execute on function public.login_email(text, text) to anon, authenticated;

-- create the login, or set a new password if it exists (internal helper)
create or replace function public._upsert_login(p_email text, p_password text) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid;
begin
  if coalesce(length(p_password), 0) < 8 then raise exception 'Password must be at least 8 characters.'; end if;
  select id into uid from auth.users where email = p_email;
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now());
  else
    update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = uid;
  end if;
  return uid;
end $$;
revoke all on function public._upsert_login(text, text) from public, anon, authenticated;

-- first run only: create the admin login (before any employee exists)
create or replace function public.setup_admin_login(p_login_id text, p_password text) returns text
language plpgsql security definer set search_path = public as $$
declare e text;
begin
  if exists (select 1 from employees) then raise exception 'The academy is already set up. Sign in instead.'; end if;
  if coalesce(trim(p_login_id), '') !~ '^[A-Za-z0-9._-]{3,40}$' then raise exception 'Login ID: 3-40 letters, numbers, dot, dash or underscore.'; end if;
  e := public.login_email(p_login_id, 'staff');
  perform public._upsert_login(e, p_password);
  return e;
end $$;
revoke all on function public.setup_admin_login(text, text) from public;
grant execute on function public.setup_admin_login(text, text) to anon, authenticated;

-- staff set / reset a student's portal password; login ID = student ID
create or replace function public.set_student_login(p_student_id text, p_password text) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_staff() then raise exception 'Only staff can set student logins.'; end if;
  select code into c from students where id = p_student_id;
  if c is null then raise exception 'Student not found (save the admission first).'; end if;
  perform public._upsert_login(public.login_email(c, 'student'), p_password);
  return c;
end $$;
revoke all on function public.set_student_login(text, text) from public;
grant execute on function public.set_student_login(text, text) to authenticated;

create or replace function public.student_login_exists(p_student_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and exists (
    select 1 from students s join auth.users u on u.email = public.login_email(s.code, 'student') where s.id = p_student_id);
$$;
revoke all on function public.student_login_exists(text) from public;
grant execute on function public.student_login_exists(text) to authenticated;

-- the signed-in student's own records (nothing else)
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
    'academy', (select settings -> 'academyName' from app_state where id = 1)
  );
end $$;
revoke all on function public.my_portal() from public;
grant execute on function public.my_portal() to authenticated;

-- the login page needs to know whether to show first-run setup
grant execute on function public.has_employees() to anon;

commit;
