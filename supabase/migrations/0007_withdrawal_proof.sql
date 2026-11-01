-- Founder withdrawals: photo / screenshot of the payment ({ name, data }).
alter table founder_withdrawals add column if not exists proof jsonb;
