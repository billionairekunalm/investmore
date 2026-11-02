-- Staff logins: the Super Admin gives an employee a login ID + password.
-- The app first saves the employee with email = login_email(<login ID>, 'staff'), then calls this.
-- Each staff member then sees only what their role allows (permissions in Settings).
create or replace function public.set_staff_login(p_employee_id text, p_password text) returns text
language plpgsql security definer set search_path = public as $$
declare em text;
begin
  if not exists (select 1 from employees e where e.active and e.role = 'super_admin'
                 and lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))) then
    raise exception 'Only the Super Admin can set staff logins.';
  end if;
  select lower(email) into em from employees where id = p_employee_id;
  if em is null then raise exception 'Employee not found (save first).'; end if;
  if em !~ '^[a-z0-9._-]{3,40}@staff\.investmore\.invalid$' then raise exception 'Choose a login ID: 3-40 letters, numbers, dot, dash or underscore.'; end if;
  if (select count(*) from employees where lower(email) = em) > 1 then raise exception 'This login ID is already used by another employee.'; end if;
  perform public._upsert_login(em, p_password);
  return split_part(em, '@', 1);
end $$;
revoke all on function public.set_staff_login(text, text) from public;
grant execute on function public.set_staff_login(text, text) to authenticated;

create or replace function public.staff_login_exists(p_employee_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and exists (
    select 1 from employees e join auth.users u on lower(u.email) = lower(e.email) where e.id = p_employee_id);
$$;
revoke all on function public.staff_login_exists(text) from public;
grant execute on function public.staff_login_exists(text) to authenticated;
revoke execute on function public.set_staff_login(text, text) from anon;
revoke execute on function public.staff_login_exists(text) from anon;
