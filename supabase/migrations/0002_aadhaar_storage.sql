-- Private storage for students' Aadhaar card images (front/back), saved with consent at admission.
-- Files live at aadhaar/<student id>/front.<ext> and back.<ext>; only signed-in ACTIVE staff can read or write.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('aadhaar', 'aadhaar', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists aadhaar_staff_read on storage.objects;
drop policy if exists aadhaar_staff_insert on storage.objects;
drop policy if exists aadhaar_staff_update on storage.objects;
drop policy if exists aadhaar_staff_delete on storage.objects;
create policy aadhaar_staff_read on storage.objects for select to authenticated using (bucket_id = 'aadhaar' and public.is_staff());
create policy aadhaar_staff_insert on storage.objects for insert to authenticated with check (bucket_id = 'aadhaar' and public.is_staff());
create policy aadhaar_staff_update on storage.objects for update to authenticated using (bucket_id = 'aadhaar' and public.is_staff()) with check (bucket_id = 'aadhaar' and public.is_staff());
create policy aadhaar_staff_delete on storage.objects for delete to authenticated using (bucket_id = 'aadhaar' and public.is_staff());
