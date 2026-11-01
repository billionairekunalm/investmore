-- INVESTMORE Academy — initial schema.
-- Money is integer paise (bigint). Calendar dates are 'date' in Asia/Kolkata; event times are timestamptz.
-- Mirrors src/store/schema.ts (checked by src/store/schema.test.ts).
-- Security: RLS on every table; only signed-in ACTIVE staff (auth email = employees.email) can read or write.

begin;

-- ---------------------------------------------------------------- staff & reference data
create table if not exists employees (
  id text primary key,
  name text not null,
  phone text not null,
  email text not null default '',
  role text not null check (role in ('super_admin','admin','calling_manager','caller','teacher','accountant')),
  active boolean not null default true,
  created_at timestamptz
);
create unique index if not exists employees_phone_key on employees (phone);
create unique index if not exists employees_email_key on employees (lower(email)) where email <> '';

create table if not exists courses (
  id text primary key,
  name text not null,
  booking_default bigint not null check (booking_default >= 0),
  instalments jsonb not null default '[]',
  duration_weeks integer not null check (duration_weeks > 0)
);

create table if not exists batches (
  id text primary key,
  name text not null,
  course_id text not null references courses(id),
  teacher_id text references employees(id),
  start_date date not null,
  end_date date not null,
  schedule text not null default '',
  timing text not null default '',
  capacity integer not null check (capacity >= 0),
  status text not null check (status in ('upcoming','running','completed','cancelled')),
  check (end_date >= start_date)
);

-- ---------------------------------------------------------------- CRM
create table if not exists leads (
  id text primary key,
  name text not null,
  phone text not null,
  email text not null default '',
  source text not null default '',
  campaign text not null default '',
  assigned_to text references employees(id),
  status text not null,
  interest text not null check (interest in ('Low','Medium','High')),
  last_call_at timestamptz,
  next_follow_up date,
  notes text not null default '',
  created_at timestamptz not null,
  converted_student_id text,          -- no FK: lead and student reference each other
  import_job_id text
);
create unique index if not exists leads_phone_key on leads (phone);
create index if not exists leads_assigned_idx on leads (assigned_to);
create index if not exists leads_follow_up_idx on leads (next_follow_up);

-- ---------------------------------------------------------------- students & fees
create table if not exists students (
  id text primary key,
  code text not null unique,
  name text not null,
  phone text not null,
  alt_phone text not null default '',
  email text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default '',
  pin text not null default '',
  photo text,
  dob date,
  gender text check (gender in ('Male','Female','Transgender')),
  course_id text not null references courses(id),
  batch_id text references batches(id),
  admission_date date not null,
  lead_id text references leads(id),
  source text not null default '',
  campaign text not null default '',
  counsellor_id text references employees(id),
  status text not null check (status in ('Active','Completed','Inactive','Dropped','Refunded')),
  reminders_opt_out boolean not null default false,
  id_doc jsonb,                       -- masked: type + last 4 digits + name only, never the image
  created_at timestamptz not null
);
create unique index if not exists students_phone_key on students (phone);
create index if not exists students_batch_idx on students (batch_id);
create index if not exists students_status_idx on students (status);

create table if not exists enrolments (
  id text primary key,
  student_id text not null references students(id),
  batch_id text not null references batches(id),
  from_date date not null,
  to_date date,
  reason text not null default ''
);
create index if not exists enrolments_student_idx on enrolments (student_id);

create table if not exists fee_plans (
  id text primary key,
  student_id text not null references students(id),
  policy text not null check (policy in ('additional','credited')),
  booking_amount bigint not null check (booking_amount >= 0),
  total bigint not null check (total >= 0),
  start_date date not null,
  created_at timestamptz not null
);
create index if not exists fee_plans_student_idx on fee_plans (student_id);

create table if not exists instalments (
  id text primary key,
  plan_id text not null references fee_plans(id),
  student_id text not null references students(id),
  seq integer not null,
  label text not null,
  amount bigint not null check (amount >= 0),
  due_date date not null,
  state text not null check (state in ('active','waived','cancelled')),
  unique (plan_id, seq)
);
create index if not exists instalments_student_idx on instalments (student_id);
create index if not exists instalments_due_idx on instalments (due_date);

create table if not exists payments (
  id text primary key,
  key text not null unique,           -- idempotency key: a double-click never records twice
  student_id text not null references students(id),
  amount bigint not null check (amount > 0),
  date date not null,
  method text not null check (method in ('Cash','UPI','Bank Transfer','Card','Online Gateway')),
  reference text not null default '',
  received_by text not null,
  notes text not null default '',
  kind text not null check (kind in ('payment','reversal','refund')),
  reverses_id text references payments(id),
  receipt_no text not null default '',
  verified boolean not null,
  created_at timestamptz not null
);
create unique index if not exists payments_receipt_key on payments (receipt_no) where receipt_no <> '';
create index if not exists payments_student_idx on payments (student_id);
create index if not exists payments_date_idx on payments (date);

create table if not exists calls (
  id text primary key,
  entity text not null check (entity in ('lead','student')),
  entity_id text not null,
  by_user text not null,
  at timestamptz not null,
  outcome text not null,
  notes text not null default '',
  next_follow_up date
);
create index if not exists calls_entity_idx on calls (entity, entity_id);

-- ---------------------------------------------------------------- expenses & profit
create table if not exists recurring_expenses (
  id text primary key,
  category text not null,
  description text not null default '',
  amount bigint not null check (amount >= 0),
  day_of_month integer not null check (day_of_month between 1 and 31),
  active boolean not null default true,
  start_month text not null check (start_month ~ '^\d{4}-\d{2}$')
);

create table if not exists expenses (
  id text primary key,
  category text not null,
  kind text not null check (kind in ('fixed','variable')),
  description text not null default '',
  amount bigint not null check (amount >= 0),
  date date not null,
  method text not null,
  receipt jsonb,
  added_by text not null,
  status text not null check (status in ('Pending','Approved','Rejected')),
  notes text not null default '',
  recurring_id text references recurring_expenses(id),
  adjustments jsonb not null default '[]'
);
create index if not exists expenses_date_idx on expenses (date);

create table if not exists financial_periods (
  id text primary key check (id ~ '^\d{4}-\d{2}$'),
  status text not null check (status in ('open','closed')),
  snapshot jsonb,
  history jsonb not null default '[]'
);

create table if not exists distributions (
  id text primary key,
  period_id text not null references financial_periods(id),
  figures jsonb not null,
  adjustments jsonb not null default '[]',
  distributable bigint not null,
  shares jsonb not null,
  status text not null,
  approved_by text,
  payments jsonb not null default '[]',
  created_at timestamptz not null
);

-- ---------------------------------------------------------------- academics
create table if not exists certificate_templates (
  id text primary key,
  name text not null,
  file_type text not null,
  data text not null,
  fields jsonb not null default '[]',
  created_at timestamptz not null
);

create table if not exists certificates (
  id text primary key,
  student_id text not null references students(id),
  template_id text not null references certificate_templates(id),
  issued_at timestamptz not null,
  issued_by text not null,
  status text not null check (status in ('Issued','Revoked')),
  data jsonb not null,
  history jsonb not null default '[]'
);

create table if not exists attendance (
  id text primary key,
  batch_id text not null references batches(id),
  date date not null,
  present jsonb not null default '[]'
);
create index if not exists attendance_batch_idx on attendance (batch_id, date);

-- ---------------------------------------------------------------- activity
create table if not exists notifications (
  id text primary key,
  key text not null unique,
  at timestamptz not null,
  title text not null,
  body text not null default '',
  link text not null default '',
  for_roles jsonb not null default '[]',
  for_user text,
  read_by jsonb not null default '[]',
  phone text
);

create table if not exists audit_log (
  id text primary key,
  at timestamptz not null,
  by_user text not null,
  action text not null,
  entity text not null,
  entity_id text not null,
  detail text not null default ''
);
create index if not exists audit_entity_idx on audit_log (entity_id);
create index if not exists audit_at_idx on audit_log (at desc);

create table if not exists import_jobs (
  id text primary key,
  at timestamptz not null,
  by_user text not null,
  file_name text not null,
  total integer not null,
  imported integer not null,
  duplicates integer not null,
  invalid integer not null,
  errors jsonb not null default '[]'
);

create table if not exists login_events (
  id text primary key,
  user_id text not null,
  at timestamptz not null,
  user_agent text not null default ''
);

-- settings + id counters (single row)
create table if not exists app_state (
  id integer primary key default 1 check (id = 1),
  version integer not null default 1,
  settings jsonb not null,
  counters jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- security
-- Signed-in user is staff when their auth email belongs to an ACTIVE employee.
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from employees e
    where e.active and e.email <> '' and lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
-- First run only: before any employee exists, a signed-in user may create the first records (the Super Admin).
create or replace function public.is_first_run() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and not exists (select 1 from employees);
$$;
revoke all on function public.is_staff() from public;
revoke all on function public.is_first_run() from public;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_first_run() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['employees','courses','batches','leads','students','enrolments','fee_plans','instalments','payments','calls',
    'recurring_expenses','expenses','financial_periods','distributions','certificate_templates','certificates','attendance',
    'notifications','audit_log','import_jobs','login_events','app_state']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists staff_all on %I', t);
    execute format('create policy staff_all on %I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

-- bootstrap: the first signed-in user may create the first employee and the settings row
drop policy if exists first_run_insert on employees;
create policy first_run_insert on employees for insert to authenticated with check (public.is_first_run());
drop policy if exists first_run_insert on app_state;
create policy first_run_insert on app_state for insert to authenticated with check (public.is_first_run());
-- lets the app tell "no employees yet" (show setup) apart from "you are not staff"
create or replace function public.has_employees() returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from employees); $$;
grant execute on function public.has_employees() to authenticated;

commit;
