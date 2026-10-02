-- 55 — The ticking functions' shared secret, from Vault
--
-- Companion to 0087. Only the service key may read a tick secret, and only
-- the three the functions use.

\echo '── edge tick secrets'

begin;

insert into auth.users (id, phone) values ('11111111-0000-4000-5555-000000000001', '+966509550001');
insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-5555-000000000001', 'العميل', '+966509550001');

set role authenticated;
select test.become('11111111-0000-4000-5555-000000000001');
select test.assert_raises($$select public.edge_tick_secret('push_tick_secret')$$,
  'a signed-in user cannot read a tick secret', '42501');

select test.become_anon();
set role anon;
select test.assert_raises($$select public.edge_tick_secret('push_tick_secret')$$,
  'nor can anyone signed out', '42501');
reset role;

set role service_role;
select test.assert(public.edge_tick_secret('push_tick_secret') is null,
  'without Vault (this harness) there is no secret, and no error: the function stays closed');
select test.assert_raises($$select public.edge_tick_secret('some_other_secret')$$,
  'the service key reads only the three tick secrets, nothing else in Vault', '22023');
reset role;

rollback;

\echo '   edge tick secrets OK'
