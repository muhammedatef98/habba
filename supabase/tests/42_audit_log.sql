-- 42 — audit_log
--
-- Companion to 0070. Amendment B (§5.1.6) says "every admin action writes an
-- immutable audit row". Three things have to be true for that sentence to mean
-- anything, and this suite checks each:
--
--   1. The row appears without anyone remembering to write it.
--   2. Nobody can edit or delete it afterwards, including ops.
--   3. A new ops-writable table cannot appear unaudited.
--
-- (3) is the standing half, in the same spirit as 16, 17 and 41.

\echo '── audit log'

begin;

select public.test_seed_auth_user('88888888-0000-4000-0000-000000000001', '+966595000001');
select public.test_seed_auth_user('88888888-0000-4000-0000-000000000002', '+966595000002');

insert into public.profiles (id, full_name, phone) values
  ('88888888-0000-4000-0000-000000000001', 'مشغّل', '+966595000001'),
  ('88888888-0000-4000-0000-000000000002', 'فنّي', '+966595000002');

select test.grant_role('88888888-0000-4000-0000-000000000001', 'ops');
select test.grant_role('88888888-0000-4000-0000-000000000002', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c8000000-0000-4000-0000-000000000001', 'حائل', 'HailAudit', 'حائل', 'Hail',
   extensions.st_point(41.6900, 27.5114)::extensions.geography);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id,
   national_id_encrypted, iban_encrypted)
values
  ('e8000000-0000-4000-0000-000000000001', '88888888-0000-4000-0000-000000000002',
   'individual', 'ورشة حائل', 'pending', 'c8000000-0000-4000-0000-000000000001',
   'CIPHERTEXT_NID', 'CIPHERTEXT_IBAN');


-- Nobody has to remember -------------------------------------------------------
set role authenticated;
select test.become('88888888-0000-4000-0000-000000000001');

select public.set_provider_verification(
  'e8000000-0000-4000-0000-000000000001', 'approved', 'المستندات سليمة');

select test.assert_eq(
  (select count(*)::int from public.audit_log
    where target_table = 'providers'
      and target_id = 'e8000000-0000-4000-0000-000000000001'
      and actor_id = '88888888-0000-4000-0000-000000000001'),
  1,
  'approving a provider writes an audit row without the RPC mentioning the log');

select test.assert(
  (select changed_columns from public.audit_log where target_table = 'providers' limit 1)
    @> array['verification_status'],
  'and names the column that moved');

-- ⚠️ The KYC ciphertext must not be copied into a table with different access
-- rules on every edit. Only the changed columns are recorded, which is the
-- whole reason `before`/`after` are narrowed rather than whole-row snapshots.
select test.assert(
  not exists (
    select 1 from public.audit_log
     where (after ? 'national_id_encrypted') or (before ? 'national_id_encrypted')
        or (after ? 'iban_encrypted') or (before ? 'iban_encrypted')
  ),
  'an unchanged KYC column is never copied into the audit log');

reset role;


-- A technician's own writes are not "admin actions" ------------------------------
select test.assert_eq(
  (select count(*)::int from public.audit_log where actor_role = 'technician'),
  0,
  'a non-ops write produces no audit row — the log is ops actions, not a firehose');


-- Immutable ----------------------------------------------------------------------
--
-- ⚠️ These DO raise, unlike the storage-object case suite 24 documents.
--
-- There, RLS denies by matching zero rows and the statement "succeeds" having
-- changed nothing. Here the table-level `revoke insert, update, delete` in 0070
-- means the privilege check fails before RLS is ever consulted, so the
-- statement is refused outright. That is the stronger of the two outcomes and
-- the reason the revoke is there as well as the missing policy: an operator who
-- tries to edit the log gets an error rather than a silent no-op they might
-- mistake for success.
set role authenticated;
select test.become('88888888-0000-4000-0000-000000000001');

select test.assert_raises(
  $$update public.audit_log set action = 'nothing happened'$$,
  'ops cannot rewrite the log — an audit its subject can edit is not evidence',
  '42501');

select test.assert_raises(
  $$delete from public.audit_log$$,
  'nor delete from it',
  '42501');

select test.assert(
  (select count(*)::int from public.audit_log) > 0,
  'and the rows are still there');

-- Nor can they forge one against a colleague.
select test.become('88888888-0000-4000-0000-000000000002');
select test.assert_raises(
  $$select public.record_ops_action('exported_everything', 'providers', null, null)$$,
  'a technician cannot write an audit row at all',
  '42501');

select test.assert_eq(
  (select count(*)::int from public.audit_log),
  0,
  'and cannot read the log either');

reset role;


-- The explicit entry, for actions no trigger can see ------------------------------
set role authenticated;
select test.become('88888888-0000-4000-0000-000000000001');

select public.record_ops_action(
  'viewed_customer_contact', 'orders', 'f8000000-0000-4000-0000-000000000001',
  jsonb_build_object('reason', 'نزاع'));

select test.assert_eq(
  (select count(*)::int from public.audit_log where action = 'viewed_customer_contact'),
  1,
  'a read, an export or a dispute lookup can be recorded — a trigger cannot see those');

reset role;


-- ⚠️ Standing check: no ops-writable table may be unaudited ------------------------
--
-- Every table 16 classifies as ops-writable must carry the audit trigger. A new
-- one arrives audited or fails here — the same shape as 16, 17 and 41, and for
-- the same reason: a rule nobody is forced to follow is a rule with holes where
-- somebody was in a hurry.
create temporary view ops_writable_tables as
  select distinct c.relname as table_name
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and p.polcmd in ('*', 'w', 'a', 'd')
     and pg_get_expr(coalesce(p.polqual, p.polwithcheck), p.polrelid) like '%is_ops%';

create temporary view audited_tables as
  select c.relname as table_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc f on f.oid = t.tgfoid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and f.proname = 'audit_ops_write';

select test.assert_eq(
  (select coalesce(string_agg(w.table_name, ', ' order by w.table_name), '(none)')
     from ops_writable_tables w
    where w.table_name not in (select table_name from audited_tables)),
  '(none)',
  'every table ops can write carries the audit trigger');

rollback;
