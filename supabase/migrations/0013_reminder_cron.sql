-- Runs the reminder sender (Edge Function send-class-reminders) every minute.
-- <CRON_SECRET> must match the function's CRON_SECRET secret; the real value is set directly in the
-- database and Supabase secrets, never committed.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'send-class-reminders';
select cron.schedule('send-class-reminders', '* * * * *', $$
  select net.http_post(
    url := 'https://vthcgzywpyamxwbpdaif.supabase.co/functions/v1/send-class-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb, timeout_milliseconds := 30000)
$$);
