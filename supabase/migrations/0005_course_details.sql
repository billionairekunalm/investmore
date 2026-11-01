-- Courses: description, launch status/date, and the founders' split of each course's fees.
alter table courses add column if not exists description text;
alter table courses add column if not exists status text check (status in ('upcoming', 'active', 'closed'));
alter table courses add column if not exists launch_date date;
alter table courses add column if not exists shares jsonb;
