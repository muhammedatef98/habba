-- 63 — A refund gets its credit note
--
-- Companion to 0096.

\echo '── credit notes'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-ef63-000000000001', '+966509763001'),  -- customer
  ('22222222-0000-4000-ef63-000000000002', '+966509763002'),  -- technician
  ('33333333-0000-4000-ef63-000000000003', '+966509763003'),  -- operator
  ('44444444-0000-4000-ef63-000000000004', '+966509763004');  -- a stranger

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-ef63-000000000001', 'العميل', '+966509763001'),
  ('22222222-0000-4000-ef63-000000000002', 'الفنّي', '+966509763002'),
  ('33333333-0000-4000-ef63-000000000003', 'المشغّل', '+966509763003'),
  ('44444444-0000-4000-ef63-000000000004', 'غريب', '+966509763004');

select test.grant_role('33333333-0000-4000-ef63-000000000003', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-ef63-000000000001', 'العلا', 'AlUlaCredit', 'المدينة', 'Madinah',
   extensions.st_point(37.9295, 26.6085)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-ef63-000000000001', 'ماركة', 'TestMakeCredit');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-ef63-000000000001', 'a0000000-0000-4000-ef63-000000000001',
   'موديل', 'TestModelCredit', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-ef63-000000000001', '11111111-0000-4000-ef63-000000000001',
   'a0000000-0000-4000-ef63-000000000001', 'b0000000-0000-4000-ef63-000000000001',
   2022, 'KND 6363', 30000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online,
   city_id, acceptance_rate)
values
  ('e0000000-0000-4000-ef63-000000000001', '22222222-0000-4000-ef63-000000000002',
   'individual', 'فنّي العلا', 'approved', true, 'c0000000-0000-4000-ef63-000000000001', 90);

select id as svc from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-ef63-000000000001', :'svc');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-ef63-000000000001',
   extensions.st_point(37.9297, 26.6087)::extensions.geography, now());

-- One order, through to completed and captured.
create function pg_temp.completed_order(p_note text, p_mileage int) returns uuid
language plpgsql as $$
declare v_ord uuid;
begin
  perform test.become('11111111-0000-4000-ef63-000000000001');
  v_ord := public.create_emergency_order(
    (select id from public.services where name_en = 'Battery jump or replacement'),
    37.9296, 26.6086, 'd0000000-0000-4000-ef63-000000000001',
    'العلا القديمة', p_note, p_mileage, '[]'::jsonb);
  perform public.authorise_order_payment(v_ord, 'intent_' || p_note);
  perform public.submit_order(v_ord);

  perform test.become('22222222-0000-4000-ef63-000000000002');
  perform public.accept_order(v_ord);
  update public.orders set status = 'en_route' where id = v_ord;
  update public.orders set status = 'arrived' where id = v_ord;
  update public.orders set status = 'in_progress' where id = v_ord;
  perform public.record_completion_evidence(v_ord, p_mileage + 10, test.completion_photos(v_ord), 30);
  update public.orders set status = 'awaiting_approval' where id = v_ord;

  perform test.become('11111111-0000-4000-ef63-000000000001');
  update public.orders set status = 'completed' where id = v_ord;
  perform public.capture_order_payment(v_ord);
  return v_ord;
end;
$$;

set role authenticated;

-- A partial refund, then the rest ---------------------------------------------------------------
select pg_temp.completed_order('partial', 30100) as ord \gset

select test.assert_eq(
  (select count(*)::int from public.zatca_credit_notes where order_id = :'ord'), 0,
  'an order that was never refunded has no credit note');

select public.open_order_dispute(:'ord', 'البطارية فصلت بعد يوم');
select test.become('33333333-0000-4000-ef63-000000000003');
select public.ops_resolve_dispute(:'ord', 'partial_refund', 10, 'تعويض عن التأخير');

select test.assert_eq(
  (select count(*)::int from public.zatca_credit_notes where order_id = :'ord'), 1,
  'a partial refund issues one credit note');

select test.assert(
  (select c.total_amount = 10
          and c.vat_amount = round(10 * i.vat_rate / (1 + i.vat_rate), 2)
          and c.net_amount + c.vat_amount = 10
          and c.invoice_id = i.id
          and c.seller_id = i.seller_id
          and c.credit_note_number like 'HB-CRN-%'
          and c.reason_ar like '%تعويض عن التأخير%'
          and c.qr_base64 <> ''
     from public.zatca_credit_notes c join public.zatca_invoices i on i.id = c.invoice_id
    where c.order_id = :'ord'),
  'for the amount refunded, VAT split at the invoice''s rate, against that invoice, with the reason');

select test.assert(
  (select position(convert_to('10.00', 'UTF8') in decode(c.qr_base64, 'base64')) > 0
     from public.zatca_credit_notes c where c.order_id = :'ord'),
  'and a QR that carries the credited amount');

select test.assert(
  exists (select 1 from public.audit_log a
           where a.target_table = 'zatca_credit_notes' and a.action = 'insert'
             and a.actor_id = '33333333-0000-4000-ef63-000000000003'),
  'issued by an operator''s refund, so in the audit log');

-- The rest of it, as a full refund on a second dispute.
select test.become('11111111-0000-4000-ef63-000000000001');
select public.open_order_dispute(:'ord', 'وفصلت مرة أخرى');
select test.become('33333333-0000-4000-ef63-000000000003');
select public.ops_resolve_dispute(:'ord', 'full_refund', null, 'استرداد كامل');

select test.assert(
  (select sum(c.total_amount) = i.total_amount and sum(c.vat_amount) = i.vat_amount
          and sum(c.net_amount) = i.net_amount and count(*) = 2
     from public.zatca_credit_notes c join public.zatca_invoices i on i.id = c.invoice_id
    where c.order_id = :'ord'
    group by i.total_amount, i.vat_amount, i.net_amount),
  'a full refund reverses the invoice exactly — total, VAT and net, to the halala');

select test.assert_eq(public.ops_issue_credit_notes(:'ord'), 0,
  'and nothing more is owed on it');

-- Who can read them ----------------------------------------------------------------------------------
select test.become('11111111-0000-4000-ef63-000000000001');
select test.assert_eq(
  (select count(*)::int from public.zatca_credit_notes where order_id = :'ord'), 2,
  'the customer reads their credit notes');

select test.become('22222222-0000-4000-ef63-000000000002');
select test.assert_eq(
  (select count(*)::int from public.zatca_credit_notes where order_id = :'ord'), 2,
  'so does the technician who did the job');

select test.become('44444444-0000-4000-ef63-000000000004');
select test.assert_eq(
  (select count(*)::int from public.zatca_credit_notes), 0,
  'a stranger reads none');

-- Nobody writes them by hand -------------------------------------------------------------------------
select test.become('33333333-0000-4000-ef63-000000000003');
select test.assert_raises(
  format($$insert into public.zatca_credit_notes
             (invoice_id, order_id, seller_id, credit_note_number, reason_ar,
              net_amount, vat_amount, total_amount, vat_rate, qr_base64)
           select i.id, i.order_id, i.seller_id, 'HB-CRN-FAKE', 'x', 1, 0, 1, 0.15, 'x'
             from public.zatca_invoices i where i.order_id = %L$$, :'ord'),
  'not even an operator inserts a credit note', '42501');

select test.assert_raises(
  format($$select public.issue_zatca_credit_note(%L, 1, 'x')$$, :'ord'),
  'nor calls the issuer directly', '42501');

reset role;
select test.assert_raises(
  format($$update public.zatca_credit_notes set total_amount = 1 where order_id = %L$$, :'ord'),
  'an issued credit note is never edited — not even by the owner of the table', '42501');
select test.assert_raises(
  format($$delete from public.zatca_credit_notes where order_id = %L$$, :'ord'),
  'nor deleted', '42501');

select test.assert_raises(
  format($$select public.issue_zatca_credit_note(%L, 1, 'x')$$, :'ord'),
  'and an invoice is never credited past its total', '23514');


-- A refund before the invoice exists -----------------------------------------------------------------
-- No seller at completion: the order completes uninvoiced (0074), is
-- refunded, and only then invoiced from the console — for the full total.
update public.invoice_sellers set is_active = false where provider_id is null;

set role authenticated;
select pg_temp.completed_order('late', 30300) as late \gset

select test.assert(
  not exists (select 1 from public.zatca_invoices where order_id = :'late'),
  'completed with no seller, so uninvoiced');

select public.open_order_dispute(:'late', 'الفنّي تأخر ساعتين');
select test.become('33333333-0000-4000-ef63-000000000003');
select public.ops_resolve_dispute(:'late', 'partial_refund', 25, 'تعويض عن التأخير');

select test.assert(
  (select refunded_amount = 25 from public.orders where id = :'late')
    and not exists (select 1 from public.zatca_credit_notes where order_id = :'late'),
  'the refund happens, with no invoice yet to credit — and does not fail');

reset role;
update public.invoice_sellers set is_active = true where provider_id is null;

set role authenticated;
select test.become('33333333-0000-4000-ef63-000000000003');
select public.ops_issue_invoice(:'late');

select test.assert(
  (select c.total_amount = 25 and i.total_amount = o.total_amount
     from public.zatca_credit_notes c
     join public.zatca_invoices i on i.id = c.invoice_id
     join public.orders o on o.id = c.order_id
    where c.order_id = :'late'),
  'the invoice is issued for the full total and credited for the refund at once');


-- The catch-up ----------------------------------------------------------------------------------------
-- A refund the trigger could not credit (simulated by refunding with the
-- trigger off) is found and credited by ops_issue_credit_notes.
reset role;
alter table public.orders disable trigger orders_z_credit_note_on_refund;

set role authenticated;
select pg_temp.completed_order('missed', 30500) as missed \gset
select public.open_order_dispute(:'missed', 'خدمة ناقصة');
select test.become('33333333-0000-4000-ef63-000000000003');
select public.ops_resolve_dispute(:'missed', 'partial_refund', 5, 'تعويض بسيط');

reset role;
alter table public.orders enable always trigger orders_z_credit_note_on_refund;

set role authenticated;
select test.assert(
  not exists (select 1 from public.zatca_credit_notes where order_id = :'missed'),
  'a refund left uncredited');

select test.become('11111111-0000-4000-ef63-000000000001');
select test.assert_raises(
  'select public.ops_issue_credit_notes()',
  'the customer cannot run the catch-up', '42501');

select test.become('33333333-0000-4000-ef63-000000000003');
select test.assert_eq(public.ops_issue_credit_notes(), 1, 'the catch-up issues the one note owed');
select test.assert_eq(public.ops_issue_credit_notes(), 0, 'and running it again owes nothing');
select test.assert_eq(
  (select total_amount from public.zatca_credit_notes where order_id = :'missed'), 5.00::numeric,
  'for exactly what was refunded');

reset role;
rollback;

\echo '   credit notes OK'
