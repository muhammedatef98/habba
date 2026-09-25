-- 56 — The SMS hook's secrets, from Vault
--
-- Companion to 0088. Only the service key may read them, and only these two.

\echo '── edge provider secrets'

begin;

insert into auth.users (id, phone) values ('11111111-0000-4000-5656-000000000001', '+966509560001');
insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-5656-000000000001', 'العميل', '+966509560001');

set role authenticated;
select test.become('11111111-0000-4000-5656-000000000001');
select test.assert_raises($$select public.edge_provider_secret('authentica_api_key')$$,
  'a signed-in user cannot read the SMS key', '42501');

select test.become_anon();
set role anon;
select test.assert_raises($$select public.edge_provider_secret('send_sms_hook_secret')$$,
  'nor can anyone signed out', '42501');
reset role;

set role service_role;
select test.assert(public.edge_provider_secret('authentica_api_key') is null,
  'without Vault (this harness) there is no key, and no error: the hook stays closed');
select test.assert_raises($$select public.edge_provider_secret('push_tick_secret')$$,
  'the service key reads only the two provider secrets, not the tick secrets', '22023');
reset role;

rollback;

\echo '   edge provider secrets OK'
