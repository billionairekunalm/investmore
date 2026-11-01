-- Founders taking money out of the profit (owner withdrawals). Staff-only, like every other table.
create table if not exists founder_withdrawals (
  id text primary key,
  founder text not null,
  amount bigint not null check (amount > 0),
  date date not null,
  for_month text not null check (for_month ~ '^\d{4}-\d{2}$'),
  method text not null check (method in ('Cash','UPI','Bank Transfer','Card','Online Gateway')),
  reference text not null default '',
  notes text not null default '',
  by_user text not null,
  created_at timestamptz not null
);
create index if not exists founder_withdrawals_month_idx on founder_withdrawals (for_month);

alter table founder_withdrawals enable row level security;
drop policy if exists staff_all on founder_withdrawals;
create policy staff_all on founder_withdrawals for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on founder_withdrawals from anon;
