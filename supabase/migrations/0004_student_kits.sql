-- Course kit handed to the student: when, and by which staff member (both empty = not received yet).
alter table students add column if not exists kit_received_at timestamptz;
alter table students add column if not exists kit_received_by text;
