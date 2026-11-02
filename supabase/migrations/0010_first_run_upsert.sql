-- The app saves with upsert (INSERT ... ON CONFLICT DO UPDATE), which under RLS also needs SELECT and UPDATE
-- policies. During first run (signed in, no employees yet) only INSERT was allowed, so creating the academy
-- failed with "new row violates row-level security policy for table employees". Same rule, all three verbs.
drop policy if exists first_run_select on employees;
create policy first_run_select on employees for select to authenticated using (public.is_first_run());
drop policy if exists first_run_update on employees;
create policy first_run_update on employees for update to authenticated using (public.is_first_run()) with check (public.is_first_run());
drop policy if exists first_run_select on app_state;
create policy first_run_select on app_state for select to authenticated using (public.is_first_run());
drop policy if exists first_run_update on app_state;
create policy first_run_update on app_state for update to authenticated using (public.is_first_run()) with check (public.is_first_run());
