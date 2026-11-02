-- Student self sign-up: only an enrolled student can create their own login, by giving their
-- student ID + the mobile number on their admission. One login per student; after that, the office resets it.
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
  return em;
end $$;
revoke all on function public.student_signup(text, text, text) from public;
grant execute on function public.student_signup(text, text, text) to anon, authenticated;
