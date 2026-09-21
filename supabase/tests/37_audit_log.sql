-- 37 — audit_log: the record of what an operator did
--
-- Companion to 0064. Amendment B (CLAUDE.md §5.1.6) says every admin action
-- writes an immutable audit row, and the value of that sentence is entirely in
-- the word "immutable" — a log its subject can edit, or fabricate, records
-- nothing. So most of this suite is about what CANNOT be done to the table.

\echo '── audit log'

begin;

insert into auth.users (id, phone) values
  ('a1111111-0000-4000-e000-000000000001', '+966507000001'),  -- ops
  ('a2222222-0000-4000-e000-000000000002', '+966507000002'),  -- the provider
  ('a3333333-0000-4000-e000-000000000003', '+966507000003');  -- a customer

insert into public.profiles (id, full_name, phone) values
  ('a1111111-0000-4000-e000-000000000001', 'المشغّل',  '+966507000001'),
  ('a2222222-0000-4000-e000-000000000002', 'الفنّي',   '+966507000002'),
  ('a3333333-0000-4000-e000-000000000003', 'عميل',     '+966507000003');

select test.grant_role('a1111111-0000-4000-e000-000000000001', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c1000000-0000-4000-e000-000000000001', 'الرياض', 'RiyadhAudit', 'الرياض', 'Riyadh',
   extensions.st_point(46.6753, 24.7136)::extensions.geography);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id, is_online)
values
  ('e1000000-0000-4000-e000-000000000001', 'a2222222-0000-4000-e000-000000000002',
   'individual', 'ورشة تحت المراجعة', 'pending', 'c1000000-0000-4000-e000-000000000001', false);


-- The action writes the row ----------------------------------------------------
set role authenticated;
select test.become('a1111111-0000-4000-e000-000000000001');

select public.set_provider_verification(
  'e1000000-0000-4000-e000-000000000001', 'approved', 'الهوية والسجل مطابقان');

select test.assert_eq(
  (select count(*)::int from public.audit_log
    where target_table = 'providers'
      and target_id = 'e1000000-0000-4000-e000-000000000001'),
  1,
  'approving a provider writes exactly one audit row');

select test.assert_eq(
  (select actor_id from public.audit_log
    where target_id = 'e1000000-0000-4000-e000-000000000001'),
  'a1111111-0000-4000-e000-000000000001'::uuid,
  'naming the operator, from the JWT rather than from anything they sent');

select test.assert_eq(
  (select action from public.audit_log
    where target_id = 'e1000000-0000-4000-e000-000000000001'),
  'provider.approved',
  'and what was decided — the string an operator would actually search for');

-- The point of `before`: the row afterwards says `approved` and says nothing
-- about what it used to say. Without this an audit row cannot distinguish a
-- first approval from a reinstatement after a suspension.
select test.assert_eq(
  (select before ->> 'verification_status' from public.audit_log
    where target_id = 'e1000000-0000-4000-e000-000000000001'),
  'pending',
  'the row state before the action is recorded');

select test.assert_eq(
  (select after ->> 'verification_status' from public.audit_log
    where target_id = 'e1000000-0000-4000-e000-000000000001'),
  'approved',
  'and after it');


-- What must never reach the log ------------------------------------------------
-- 0037 revoked the encrypted KYC columns from every client SELECT surface. A
-- `to_jsonb(row)` snapshot here would copy them into a table every ops user
-- can read, which is the same leak by another route.
select test.assert(
  not exists (
    select 1 from public.audit_log
    where before ?| array['national_id_encrypted', 'iban_encrypted']
       or after  ?| array['national_id_encrypted', 'iban_encrypted']
  ),
  'the audit snapshot is curated — it never copies the KYC columns 0037 revoked');


-- A decision that changed nothing is not an action -----------------------------
select public.set_provider_verification(
  'e1000000-0000-4000-e000-000000000001', 'approved', 'مراجعة ثانية');

select test.assert_eq(
  (select count(*)::int from public.audit_log
    where target_id = 'e1000000-0000-4000-e000-000000000001'),
  1,
  're-confirming a decision writes nothing — a log full of no-ops is unread');


-- Suspension records both halves of what it did --------------------------------
-- It flips `verification_status` AND forces the provider offline, and an
-- operator reading this later needs to know the second one happened: a
-- provider who was online is one who had live offers in flight.
select public.set_provider_verification(
  'e1000000-0000-4000-e000-000000000001', 'suspended', 'شكاوى متكرّرة');

select test.assert_eq(
  (select after ->> 'is_online' from public.audit_log
    where target_id = 'e1000000-0000-4000-e000-000000000001'
      and action = 'provider.suspended'),
  'false',
  'suspension records that the provider was forced offline, not just re-statused');

-- A refused action leaves no trace, because it did not happen. One transaction:
-- the audit row cannot outlive the write it describes.
select test.assert_raises(
  $$select public.set_provider_verification(
      'e1000000-0000-4000-e000-000000000001', 'rejected')$$,
  'a rejection with no stated reason is refused',
  '23514');

select test.assert_eq(
  (select count(*)::int from public.audit_log
    where target_id = 'e1000000-0000-4000-e000-000000000001'
      and action = 'provider.rejected'),
  0,
  'and writes no audit row — a record of something that did not happen is worse than none');

reset role;


-- Immutable ---------------------------------------------------------------------
select test.assert_raises(
  $$update public.audit_log set action = 'provider.rejected'
     where target_id = 'e1000000-0000-4000-e000-000000000001'$$,
  'the log cannot be rewritten, even by the migration role',
  '23001');

select test.assert_raises(
  $$delete from public.audit_log
     where target_id = 'e1000000-0000-4000-e000-000000000001'$$,
  'nor can a row be deleted',
  '23001');

-- ENABLE ALWAYS, not ENABLE ORIGIN. RLS never applies to `service_role`, and
-- the admin console is the one app holding a service-role key — so the actor
-- most able to quietly edit this table is the one RLS cannot reach.
select test.assert(
  (select tg.tgenabled = 'A' from pg_trigger tg
   join pg_class c on c.oid = tg.tgrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'audit_log'
     and tg.tgname = 'audit_log_no_update_delete'),
  'and the guard is ENABLE ALWAYS, so a leaked service key cannot either');


-- Who may write, and who may read -----------------------------------------------
select test.assert_eq(
  (select coalesce(string_agg(p.polname, ', '), '(none)')
   from pg_policy p
   join pg_class c on c.oid = p.polrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'audit_log' and p.polcmd in ('*', 'w', 'a', 'd')),
  '(none)',
  'audit_log exposes no write policy to anyone');

select test.assert_eq(
  (select coalesce(string_agg(distinct privilege_type, ', ' order by privilege_type), '(none)')
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'audit_log'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  '(none)',
  'and no write grant to anon or authenticated');

-- The strongest property: a client cannot reach the writer at all. If they
-- could, they could manufacture a record of an action nobody took — which is
-- worse than having no log, because it would be believed.
select test.assert(
  not has_function_privilege('authenticated',
    'public.record_audit(text, text, uuid, jsonb, jsonb)', 'execute'),
  'record_audit is not executable by a client role — only from inside a definer function');

select test.assert(
  not has_function_privilege('anon',
    'public.record_audit(text, text, uuid, jsonb, jsonb)', 'execute'),
  'nor by an anonymous one');

set role authenticated;

select test.become('a1111111-0000-4000-e000-000000000001');
select test.assert(
  (select count(*) from public.audit_log) > 0,
  'ops reads the log');

-- No self-read policy, deliberately: this records what OPERATORS did, and the
-- surface a provider appeals against is provider_verification_events, which is
-- scoped for exactly that.
select test.become('a2222222-0000-4000-e000-000000000002');
select test.assert_eq(
  (select count(*)::int from public.audit_log),
  0,
  'the provider the rows are about reads none of them');

select test.become('a3333333-0000-4000-e000-000000000003');
select test.assert_eq(
  (select count(*)::int from public.audit_log),
  0,
  'and a passing customer reads none either');

-- Anon is refused a rung lower than RLS: `select` was granted to
-- `authenticated` only, so the read is denied at the grant layer and never
-- reaches a policy. Two layers, and the outer one is the cheaper to keep.
select test.become_anon();
reset role;
set role anon;
select test.assert_raises(
  $$select count(*) from public.audit_log$$,
  'and an anonymous reader is refused the table outright',
  '42501');

reset role;


-- The address is context, never a claim -----------------------------------------
-- Null here rather than an exception: there is no `request.headers` GUC in a
-- psql session, and an audit row that failed to write because a header was
-- missing would mean the action went unrecorded — the one outcome this table
-- exists to prevent.
select test.assert(
  public.request_client_ip() is null,
  'no request headers means no address, not a failed write');

select set_config('request.headers',
  '{"x-forwarded-for": "1.2.3.4, 10.0.0.1"}', true);
select test.assert_eq(
  public.request_client_ip(),
  '1.2.3.4'::inet,
  'the leftmost forwarded address is taken, as every operations tool means it');

select set_config('request.headers', '{"x-forwarded-for": "not-an-address"}', true);
select test.assert(
  public.request_client_ip() is null,
  'and a malformed one is dropped rather than raised — the action still gets logged');

select set_config('request.headers', 'this is not json', true);
select test.assert(
  public.request_client_ip() is null,
  'as is a headers GUC that is not JSON at all');

rollback;

\echo '   audit log OK'
