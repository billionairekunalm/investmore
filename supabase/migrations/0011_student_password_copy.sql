-- The academy wants to see the student password it set (to tell a student who forgot it).
-- Supabase Auth only keeps a one-way hash, so a copy of passwords SET BY STAFF is kept here.
-- No table policies: nobody can read it directly; only the Super Admin, through student_password().
-- Passwords students choose themselves at sign-up are NOT copied.
create table if not exists student_login_secrets (
  student_id text primary key references students(id) on delete cascade,
  password text not null,
  updated_at timestamptz not null default now()
);
alter table student_login_secrets enable row level security;
revoke all on student_login_secrets from anon, authenticated;

create or replace function public.set_student_login(p_student_id text, p_password text) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_staff() then raise exception 'Only staff can set student logins.'; end if;
  select code into c from students where id = p_student_id;
  if c is null then raise exception 'Student not found (save the admission first).'; end if;
  perform public._upsert_login(public.login_email(c, 'student'), p_password);
  insert into student_login_secrets (student_id, password, updated_at) values (p_student_id, p_password, now())
    on conflict (student_id) do update set password = excluded.password, updated_at = now();
  return c;
end $$;

create or replace function public.student_password(p_student_id text) returns text
language sql stable security definer set search_path = public as $$
  select s.password from student_login_secrets s
  where s.student_id = p_student_id and exists (
    select 1 from employees e where e.active and e.role = 'super_admin' and lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.student_password(text) from public, anon;
grant execute on function public.student_password(text) to authenticated;

-- a student who signs up sets their own password: drop any old staff-set copy
create or replace function public.student_signup(p_code text, p_phone text, p_password text) returns text
language plpgsql security definer set search_path = public as $$
declare s students%rowtype; em text; ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  select * into s from students where upper(code) = upper(trim(coalesce(p_code, '')));
  if s.id is null or length(ph) <> 10 or right(regexp_replace(s.phone, '\D', '', 'g'), 10) <> ph then
    raise exception 'Student ID and mobile number do not match our records.';
  end if;
  em := public.login_email(s.code, 'student');
  if exists (select 1 from auth.users where email = em) then
    raise exception 'You already have a login. Sign in, or ask the academy office to reset your password.';
  end if;
  perform public._upsert_login(em, p_password);
  delete from student_login_secrets where student_id = s.id;
  return em;
end $$;
