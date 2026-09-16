-- 45 — What the payouts screen rests on
--
-- The ops console now has a screen that builds payouts and marks them sent.
-- That is the one surface in the product where a mistake is money leaving an
-- account, or a provider who worked a month and was not settled — so the rules
-- under it are worth pinning rather than assuming.
--
-- Three properties, and the third is the one the index in 0031 was written for.

\echo '── payout console surface'

begin;

select public.test_seed_auth_user('11111111-0000-4000-d000-000000000001', '+966506000001');
select public.test_seed_auth_user('22222222-0000-4000-d000-000000000002', '+966506000002');
select public.test_seed_auth_user('33333333-0000-4000-d000-000000000003', '+966506000003');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-d000-000000000001', 'المشغّل', '+966506000001'),
  ('22222222-0000-4000-d000-000000000002', 'الفنّي أ', '+966506000002'),
  ('33333333-0000-4000-d000-000000000003', 'الفنّي ب', '+966506000003');

select test.grant_role('11111111-0000-4000-d000-000000000001', 'ops');
select test.grant_role('22222222-0000-4000-d000-000000000002', 'technician');
select test.grant_role('33333333-0000-4000-d000-000000000003', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-d000-000000000001', 'جدة', 'JeddahPay', 'مكة', 'Makkah',
   extensions.st_point(39.1925, 21.4858)::extensions.geography);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id)
values
  ('e0000000-0000-4000-d000-000000000001', '22222222-0000-4000-d000-000000000002',
   'individual', 'فنّي جدة', 'approved', 'c0000000-0000-4000-d000-000000000001'),
  ('e0000000-0000-4000-d000-000000000002', '33333333-0000-4000-d000-000000000003',
   'individual', 'فنّي آخر', 'approved', 'c0000000-0000-4000-d000-000000000001');

insert into public.payouts
  (id, provider_id, period_start, period_end, gross_amount, commission, net_amount, order_count)
values
  ('f0000000-0000-4000-d000-000000000001', 'e0000000-0000-4000-d000-000000000001',
   '2026-08-01', '2026-08-31', 1000.00, 174.00, 826.00, 5);


-- 1. Who may read a payout ---------------------------------------------------------
set role authenticated;

select test.become('22222222-0000-4000-d000-000000000002');
select test.assert_eq(
  (select count(*)::int from public.payouts), 1,
  'a provider reads their own payout');

-- ⚠️ The isolation the console's list depends on. `listPayouts` deliberately
-- applies NO provider filter — `payouts_read` (0031) is the control — so this
-- assertion is what stands between an operator's screen and a provider's.
select test.become('33333333-0000-4000-d000-000000000003');
select test.assert_eq(
  (select count(*)::int from public.payouts), 0,
  'and another provider reads none of it');

select test.become('11111111-0000-4000-d000-000000000001');
select test.assert_eq(
  (select count(*)::int from public.payouts), 1,
  'an operator reads every payout, which is what the console lists');

reset role;


-- 2. Who may mark one paid ----------------------------------------------------------
set role authenticated;

-- ⚠️ The provider being paid must not be able to declare themselves paid. That
-- would close the row, take it out of the console's pending list, and leave
-- nobody looking for the transfer that never happened.
select test.become('22222222-0000-4000-d000-000000000002');
update public.payouts
   set status = 'paid', paid_at = now(), reference = 'forged'
 where id = 'f0000000-0000-4000-d000-000000000001';

select test.assert_eq(
  (select status::text from public.payouts where id = 'f0000000-0000-4000-d000-000000000001'),
  'pending',
  'a provider cannot mark their own payout paid — the write finds no row');

-- The operator can, and the constraint holds the timestamp to it.
select test.become('11111111-0000-4000-d000-000000000001');
update public.payouts
   set status = 'paid', paid_at = now(), reference = 'SARIE-TEST-1'
 where id = 'f0000000-0000-4000-d000-000000000001';

select test.assert_eq(
  (select status::text from public.payouts where id = 'f0000000-0000-4000-d000-000000000001'),
  'paid', 'an operator marks it sent');

select test.assert(
  (select paid_at from public.payouts where id = 'f0000000-0000-4000-d000-000000000001')
    is not null,
  'and the time it was sent is recorded with it');

-- `payouts_paid_consistent` refuses the two being written apart, which is why
-- the console sets them in one statement.
select test.assert_raises(
  $$update public.payouts set paid_at = null
     where id = 'f0000000-0000-4000-d000-000000000001'$$,
  'a payout cannot claim to be paid with no time against it',
  '23514');

reset role;


-- 3. The same period cannot be built twice --------------------------------------------
-- ⚠️ The mistake this whole index exists to stop: a settlement run repeated,
-- and a provider paid for August twice. The console surfaces the refusal as a
-- sentence rather than swallowing it, because an operator who saw it fail
-- silently would assume it worked.
set role authenticated;
select test.become('11111111-0000-4000-d000-000000000001');

select test.assert_raises(
  $$insert into public.payouts
      (provider_id, period_start, period_end, gross_amount, commission, net_amount, order_count)
    values ('e0000000-0000-4000-d000-000000000001', '2026-08-01', '2026-08-31', 50, 8.7, 41.3, 1)$$,
  'a second payout for the same provider and period is refused',
  '23505');

-- A different period is fine — the index is about repetition, not about
-- stopping a provider being paid again next month.
insert into public.payouts
  (provider_id, period_start, period_end, gross_amount, commission, net_amount, order_count)
values ('e0000000-0000-4000-d000-000000000001', '2026-09-01', '2026-09-30', 50, 8.70, 41.30, 1);

select test.assert_eq(
  (select count(*)::int from public.payouts
    where provider_id = 'e0000000-0000-4000-d000-000000000001'),
  2, 'and the next period settles normally');

-- The reconciliation the screen refuses to recompute.
select test.assert_raises(
  $$insert into public.payouts
      (provider_id, period_start, period_end, gross_amount, commission, net_amount, order_count)
    values ('e0000000-0000-4000-d000-000000000002', '2026-08-01', '2026-08-31', 100, 20, 90, 1)$$,
  'net must equal gross minus commission — the console shows all three for this reason',
  '23514');

reset role;

rollback;
