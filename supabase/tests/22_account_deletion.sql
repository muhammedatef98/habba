-- 22 — Deleting an account, and what that must not unlock (migration 0043)
--
-- 0040's guard on user_roles refused every delete, including the cascade from
-- `delete from profiles` — so an account could not be deleted at all. CI found
-- it; no test had needed to delete a profile since the guard landed.
--
-- This suite exists so that never recurs quietly, and so the narrowness of the
-- fix is pinned: the cascade works, and a direct delete still does not.

\echo '── account deletion'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-c000-000000000001', '+966511000001'),
  ('22222222-0000-4000-c000-000000000002', '+966511000002');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-c000-000000000001', 'مالك', '+966511000001'),
  ('22222222-0000-4000-c000-000000000002', 'فنّي', '+966511000002');

select test.grant_role('22222222-0000-4000-c000-000000000002', 'technician');

select test.assert_eq(
  (select count(*)::int from public.user_roles
   where user_id = '22222222-0000-4000-c000-000000000002'),
  2, 'the technician holds two role rows before deletion');


-- 1. An account can be deleted, and its roles go with it -----------------------
delete from public.profiles where id = '22222222-0000-4000-c000-000000000002';

select test.assert_eq(
  (select count(*)::int from public.profiles
   where id = '22222222-0000-4000-c000-000000000002'),
  0, 'the profile is gone');

select test.assert_eq(
  (select count(*)::int from public.user_roles
   where user_id = '22222222-0000-4000-c000-000000000002'),
  0, 'and the cascade took its role rows with it');


-- 2. Deleting role rows directly is still refused ------------------------------
-- The whole point of the guard. If the fix had been an exemption rather than a
-- condition, this would now pass and a user could strip someone's roles.
set role authenticated;
select test.become('11111111-0000-4000-c000-000000000001');

select test.assert_raises(
  $$delete from public.user_roles
    where user_id = '11111111-0000-4000-c000-000000000001'$$,
  'a signed-in user still cannot delete their own role rows',
  '42501');

reset role;

set role service_role;
select test.assert_raises(
  $$delete from public.user_roles
    where user_id = '11111111-0000-4000-c000-000000000001'$$,
  'nor can a leaked service key',
  '42501');
reset role;

select test.assert(
  public.has_role('11111111-0000-4000-c000-000000000001', 'customer'),
  'the surviving account keeps its role');


-- 3. Deleting the PROFILE from a client is still governed by RLS ---------------
-- Account deletion is a real product action later (PDPL erasure), but it is not
-- something one user does to another. This asserts today's answer so a future
-- change to profiles' policies is a deliberate one.
insert into auth.users (id, phone) values
  ('33333333-0000-4000-c000-000000000003', '+966511000003');
insert into public.profiles (id, full_name, phone) values
  ('33333333-0000-4000-c000-000000000003', 'غريب', '+966511000003');

set role authenticated;
select test.become('11111111-0000-4000-c000-000000000001');

delete from public.profiles where id = '33333333-0000-4000-c000-000000000003';

reset role;

-- Counted AFTER reset role, deliberately. As the stranger, this count is 0
-- whether the delete succeeded or was refused — they cannot SELECT that row
-- either — so asserting it there would have passed for the wrong reason. (It
-- did, in the first draft of this file.)
select test.assert_eq(
  (select count(*)::int from public.profiles
   where id = '33333333-0000-4000-c000-000000000003'),
  1, 'one user cannot delete another user''s account');

rollback;

\echo '   account deletion OK'
