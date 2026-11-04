-- A Super Admin moves their own login from a Login ID (fake @staff.investmore.invalid address) to their real email,
-- so "Forgot password?" on the sign-in page can email them a reset link (Supabase Auth recovery).
-- The app checks their current password before calling this, then signs in again with the new email.
create or replace function public.set_my_login_email(p_email text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  old text := lower(coalesce(auth.jwt() ->> 'email', ''));
  em text := lower(trim(coalesce(p_email, '')));
begin
  if not exists (select 1 from employees e where e.active and e.role = 'super_admin' and lower(e.email) = old) then
    raise exception 'Only a Super Admin can do this.';
  end if;
  if em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' or em like '%.investmore.invalid' then
    raise exception 'Enter a valid email address.';
  end if;
  if em = old then return em; end if;
  if exists (select 1 from auth.users where lower(email) = em) or exists (select 1 from employees where lower(email) = em) then
    raise exception 'This email is already used by another login.';
  end if;
  update auth.users set email = em, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = auth.uid();
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', em) where provider = 'email' and user_id = auth.uid();
  update employees set email = em where lower(email) = old;
  return em;
end $$;
revoke all on function public.set_my_login_email(text) from public, anon;
grant execute on function public.set_my_login_email(text) to authenticated;
