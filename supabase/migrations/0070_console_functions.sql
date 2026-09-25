-- 0070 — The console's reach: every read and every action an operator has
--
-- Each function checks is_ops() itself (0068: an operator role, a second
-- factor, within eight hours) and is SECURITY DEFINER, so what an operator can
-- do is exactly this list — not whatever the RLS policies of forty tables
-- happen to add up to. Every change they make is recorded by the audit
-- triggers (0068, 0069); every read of everything about one person is
-- recorded by audit_ops_read.
--
-- What is deliberately NOT here, and why:
--   * editing or deleting a logbook entry. The logbook is append-only and
--     hash-chained (ADR-0003/0004); a correction is a new entry
--     (ops_annotate_vehicle), and the original stays.
--   * editing the audit log. Nobody can, operators included.
--   * reading card numbers, passwords or OTP codes. Habba never holds the
--     first (the payment provider does) and stores only hashes of the others.
--   * reading KYC ciphertext (national ID, IBAN). 0037 closed those columns to
--     every client; Nafath's verification is what an operator acts on.
--   * signing in as a user. An operator sees everything about an account from
--     the console, and acts through functions that record who acted — never as
--     the person, where the record would say the customer did it.

create or replace function public.assert_ops()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_ops() then
    raise exception 'Only Habba operations may do this' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.ops_session_ok() and public.has_role(auth.uid(), 'super_admin');
$$;

create or replace function public.assert_reason(p_reason text)
returns text
language plpgsql
immutable
as $$
begin
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A reason is required' using errcode = 'check_violation',
      hint = 'State why — it is recorded and may be shown to the person affected.';
  end if;
  return trim(p_reason);
end;
$$;

insert into public.platform_settings
  (key, value, value_type, min_value, max_value, is_public, category, label_ar, unit_ar, description_ar, sort_order)
values
  ('dispute_window_days', '14', 'integer', 1, 365, true, 'app',
   'مدة فتح شكوى بعد اكتمال الطلب', 'يوم', null, 90)
on conflict (key) do nothing;

-- An operator's note on a car is Habba's own statement, like registration.
create or replace function public.derive_timeline_provenance(p_event_type public.timeline_event_type, p_order_id uuid, p_attachments jsonb)
returns public.timeline_provenance
language sql
immutable parallel safe
as $$
  select case
    when p_order_id is not null then 'habba_verified'::public.timeline_provenance
    when p_event_type in ('vehicle_registered', 'ownership_transferred', 'alert_raised',
                          'alert_dismissed', 'record_annotated')
      then 'habba_verified'::public.timeline_provenance
    when jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0
      then 'self_documented'::public.timeline_provenance
    else 'self_reported'::public.timeline_provenance
  end;
$$;

-- Announcements outlive a status update: a broadcast about tomorrow's
-- closure is still worth delivering to a phone that was off tonight.
create or replace function public.notification_ttl(p_kind text)
returns interval
language sql
immutable
as $$
  select case
    when p_kind = 'job_offer' then interval '5 minutes'
    when p_kind = 'booking_confirmed' then interval '12 hours'
    when p_kind = 'care_reminder' then interval '12 hours'
    when p_kind = 'announcement' then interval '24 hours'
    when p_kind = 'job_assigned' then interval '30 minutes'
    else interval '30 minutes'
  end;
$$;


-- ===========================================================================
-- For the app
-- ===========================================================================
create or replace function public.get_public_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
    from public.platform_settings s where s.is_public;
$$;

revoke execute on function public.get_public_settings() from public;
grant execute on function public.get_public_settings() to anon, authenticated;

create or replace function public.my_account_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'suspended', s.id is not null,
    'reason', s.reason,
    'since', s.suspended_at)
  from (select 1) as one
  left join public.account_suspensions s
    on s.user_id = auth.uid() and s.lifted_at is null;
$$;

revoke execute on function public.my_account_status() from public, anon;
grant execute on function public.my_account_status() to authenticated;

-- The customer's own complaint about a finished job.
create or replace function public.open_order_dispute(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_reason text := public.assert_reason(p_reason);
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if v_order.customer_id is distinct from auth.uid() and not public.is_ops() then
    raise exception 'Only the customer may dispute their order' using errcode = 'insufficient_privilege';
  end if;

  if v_order.status <> 'completed' then
    raise exception 'Only a completed order can be disputed (order is %)', v_order.status
      using errcode = 'check_violation';
  end if;

  if not public.is_ops()
     and v_order.completed_at < now() - make_interval(days => public.setting_number('dispute_window_days', 14)::int) then
    raise exception 'The window for a complaint on this order has closed'
      using errcode = 'check_violation',
            hint = 'A problem with the work itself may still be covered by its warranty.';
  end if;

  insert into public.order_disputes (order_id, opened_by, reason)
  values (p_order_id, auth.uid(), v_reason);

  update public.orders set status = 'disputed' where id = p_order_id;
end;
$$;

revoke execute on function public.open_order_dispute(uuid, text) from public, anon;
grant execute on function public.open_order_dispute(uuid, text) to authenticated;


-- ===========================================================================
-- Reading: the overview
-- ===========================================================================
create or replace function public.ops_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  perform public.assert_ops();

  return jsonb_build_object(
    'orders_today', (select count(*) from public.orders o
                      where o.status <> 'draft'
                        and (o.created_at at time zone 'Asia/Riyadh')::date = v_today),
    'completed_today', (select count(*) from public.orders o
                         where o.status = 'completed'
                           and (o.completed_at at time zone 'Asia/Riyadh')::date = v_today),
    'active_now', (select count(*) from public.orders o
                    where o.status in ('searching', 'quoted', 'accepted', 'checked_in', 'en_route',
                                       'arrived', 'in_progress', 'awaiting_approval')),
    'searching_now', (select count(*) from public.orders o where o.status = 'searching'),
    'disputes_open', (select count(*) from public.order_disputes d where d.resolved_at is null),
    'gmv_today', (select coalesce(sum(o.total_amount - o.refunded_amount), 0) from public.orders o
                   where o.escrow_status in ('captured', 'refunded')
                     and (o.completed_at at time zone 'Asia/Riyadh')::date = v_today),
    'gmv_7d', (select coalesce(sum(o.total_amount - o.refunded_amount), 0) from public.orders o
                where o.escrow_status in ('captured', 'refunded')
                  and o.completed_at >= now() - interval '7 days'),
    'gmv_30d', (select coalesce(sum(o.total_amount - o.refunded_amount), 0) from public.orders o
                 where o.escrow_status in ('captured', 'refunded')
                   and o.completed_at >= now() - interval '30 days'),
    'orders_7d', (select count(*) from public.orders o
                   where o.status <> 'draft' and o.created_at >= now() - interval '7 days'),
    'cancelled_7d', (select count(*) from public.orders o
                      where o.status = 'cancelled' and o.cancelled_at >= now() - interval '7 days'),
    'providers_online', (select count(*) from public.providers p where p.is_online),
    'providers_approved', (select count(*) from public.providers p where p.verification_status = 'approved'),
    'pending_verifications', (select count(*) from public.providers p
                               where p.verification_status in ('pending', 'in_review')),
    'customers_total', (select count(*) from public.profiles p where not p.is_guest),
    'customers_new_7d', (select count(*) from public.profiles p
                          where not p.is_guest and p.created_at >= now() - interval '7 days'),
    'vehicles_total', (select count(*) from public.vehicles v where v.is_active),
    'pending_payment_operations', (select count(*) from public.payment_operations po where po.status = 'pending'),
    'suspended_accounts', (select count(*) from public.account_suspensions s where s.lifted_at is null),
    'avg_rating_30d', (select round(avg(r.stars)::numeric, 2) from public.ratings r
                        where r.hidden_at is null and r.created_at >= now() - interval '30 days'),
    'new_orders_paused', public.setting_bool('new_orders_paused', false),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', d.day, 'orders', d.orders, 'completed', d.completed, 'gmv', d.gmv) order by d.day), '[]'::jsonb)
        from (
          select g.day::date as day,
                 (select count(*) from public.orders o
                   where o.status <> 'draft' and (o.created_at at time zone 'Asia/Riyadh')::date = g.day::date) as orders,
                 (select count(*) from public.orders o
                   where o.status = 'completed' and (o.completed_at at time zone 'Asia/Riyadh')::date = g.day::date) as completed,
                 (select coalesce(sum(o.total_amount - o.refunded_amount), 0) from public.orders o
                   where o.escrow_status in ('captured', 'refunded')
                     and (o.completed_at at time zone 'Asia/Riyadh')::date = g.day::date) as gmv
            from generate_series((v_today - 13)::timestamp, v_today::timestamp, interval '1 day') as g(day)
        ) d)
  );
end;
$$;

-- One box that finds anything: an order number, a phone, an email, a name, a
-- plate in either script, a VIN, a business or a CR number.
create or replace function public.ops_search(p_query text)
returns table (kind text, id uuid, title text, subtitle text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q      text := trim(coalesce(p_query, ''));
  v_digits text := regexp_replace(v_q, '[^0-9٠-٩]', '', 'g');
  v_plate  text;
begin
  perform public.assert_ops();
  if length(v_q) < 2 then
    return;
  end if;

  v_digits := translate(v_digits, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  -- A local number typed the way people say it (05…) finds the stored +9665….
  if v_digits like '05%' then
    v_digits := '966' || substr(v_digits, 2);
  end if;

  begin
    v_plate := public.normalise_plate(v_q);
  exception when others then
    v_plate := null;
  end;

  return query
  (select 'order'::text, o.id, o.order_number, s.name_ar, o.status::text
     from public.orders o join public.services s on s.id = o.service_id
    where o.order_number ilike '%' || v_q || '%'
    order by o.created_at desc limit 8)
  union all
  (select 'user'::text, p.id, p.full_name, coalesce(p.phone, p.email, ''),
          case when public.is_suspended(p.id) then 'suspended' else 'active' end
     from public.profiles p
    where p.full_name ilike '%' || v_q || '%'
       or p.email ilike '%' || v_q || '%'
       or (length(v_digits) >= 4 and p.phone like '%' || v_digits || '%')
    order by p.created_at desc limit 8)
  union all
  (select 'vehicle'::text, v.id, v.plate_ar || ' · ' || v.plate_en,
          concat_ws(' ', mk.name_ar, md.name_ar, v.year::text), case when v.is_active then 'active' else 'inactive' end
     from public.vehicles v
     left join public.vehicle_makes mk on mk.id = v.make_id
     left join public.vehicle_models md on md.id = v.model_id
    where (v_plate is not null and v.plate_normalised like '%' || v_plate || '%')
       or v.vin ilike '%' || v_q || '%'
    order by v.created_at desc limit 8)
  union all
  (select 'provider'::text, pr.id, pr.business_name_ar,
          case pr.provider_type when 'workshop' then 'ورشة' else 'فنّي' end, pr.verification_status::text
     from public.providers pr
    where pr.business_name_ar ilike '%' || v_q || '%'
       or pr.business_name_en ilike '%' || v_q || '%'
       or pr.cr_number = v_q
    order by pr.created_at desc limit 8);
end;
$$;


-- ===========================================================================
-- Reading: orders
-- ===========================================================================
create or replace function public.ops_list_orders(
  p_status text default null,
  p_query  text default null,
  p_mode   text default null,
  p_from   date default null,
  p_to     date default null,
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  id uuid, order_number text, status text, fulfilment_mode text, service_name_ar text,
  customer_id uuid, customer_name text, customer_phone text, provider_id uuid, provider_name_ar text,
  total_amount numeric, refunded_amount numeric, escrow_status text, created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();

  return query
  select o.id, o.order_number, o.status::text, o.fulfilment_mode::text, s.name_ar,
         o.customer_id, cp.full_name, cp.phone, o.provider_id, pr.business_name_ar,
         coalesce(o.total_amount, o.quoted_amount), o.refunded_amount, o.escrow_status::text, o.created_at,
         count(*) over ()
    from public.orders o
    join public.services s on s.id = o.service_id
    join public.profiles cp on cp.id = o.customer_id
    left join public.providers pr on pr.id = o.provider_id
   where (p_status is null
          or (p_status = 'open' and o.status not in ('draft', 'completed', 'cancelled'))
          or o.status::text = p_status)
     and (p_mode is null or o.fulfilment_mode::text = p_mode)
     and (p_from is null or (o.created_at at time zone 'Asia/Riyadh')::date >= p_from)
     and (p_to is null or (o.created_at at time zone 'Asia/Riyadh')::date <= p_to)
     and (p_query is null or trim(p_query) = ''
          or o.order_number ilike '%' || trim(p_query) || '%'
          or cp.full_name ilike '%' || trim(p_query) || '%'
          or cp.phone like '%' || regexp_replace(p_query, '\D', '', 'g') || '%' and length(regexp_replace(p_query, '\D', '', 'g')) >= 4
          or pr.business_name_ar ilike '%' || trim(p_query) || '%')
   order by o.created_at desc
   limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.ops_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.assert_ops();

  select jsonb_build_object(
    'order', to_jsonb(o) - 'service_location'
             || jsonb_build_object(
                  'lat', extensions.st_y(o.service_location::extensions.geometry),
                  'lon', extensions.st_x(o.service_location::extensions.geometry)),
    'service', jsonb_build_object('id', s.id, 'name_ar', s.name_ar, 'name_en', s.name_en, 'category', s.category),
    'customer', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone,
                                           'email', p.email, 'suspended', public.is_suspended(p.id))
                   from public.profiles p where p.id = o.customer_id),
    'provider', (select jsonb_build_object('id', pr.id, 'business_name_ar', pr.business_name_ar,
                                           'provider_type', pr.provider_type, 'owner_profile_id', pr.owner_profile_id,
                                           'phone', pp.phone, 'verification_status', pr.verification_status,
                                           'rating_avg', pr.rating_avg, 'is_online', pr.is_online)
                   from public.providers pr join public.profiles pp on pp.id = pr.owner_profile_id
                  where pr.id = o.provider_id),
    'vehicle', (select jsonb_build_object('id', v.id, 'plate_ar', v.plate_ar, 'plate_en', v.plate_en,
                                          'vin', v.vin, 'year', v.year, 'make_ar', mk.name_ar, 'model_ar', md.name_ar)
                  from public.vehicles v
                  left join public.vehicle_makes mk on mk.id = v.make_id
                  left join public.vehicle_models md on md.id = v.model_id
                 where v.id = o.vehicle_id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                 'from', e.from_status, 'to', e.to_status, 'actor_id', e.actor_id,
                 'actor_name', ap.full_name, 'note', e.note, 'at', e.created_at) order by e.created_at), '[]'::jsonb)
                 from public.order_events e left join public.profiles ap on ap.id = e.actor_id
                where e.order_id = o.id),
    'parts', (select coalesce(jsonb_agg(to_jsonb(op) order by op.created_at), '[]'::jsonb)
                from public.order_parts op where op.order_id = o.id),
    'offers', (select coalesce(jsonb_agg(jsonb_build_object(
                 'provider_id', f.provider_id, 'provider_name_ar', fp.business_name_ar, 'round', f.round,
                 'radius_m', f.radius_m, 'sent_at', f.sent_at, 'viewed_at', f.viewed_at,
                 'responded_at', f.responded_at, 'outcome', f.outcome) order by f.sent_at), '[]'::jsonb)
                 from public.order_offers f join public.providers fp on fp.id = f.provider_id
                where f.order_id = o.id),
    'handover', (select jsonb_build_object('attempts', h.attempts, 'verified_at', h.verified_at, 'created_at', h.created_at)
                   from public.order_handovers h where h.order_id = o.id),
    'rating', (select to_jsonb(r) from public.ratings r where r.order_id = o.id limit 1),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', z.id, 'invoice_number', z.invoice_number, 'invoice_type', z.invoice_type,
                   'net_amount', z.net_amount, 'vat_amount', z.vat_amount, 'total_amount', z.total_amount,
                   'issued_at', z.issued_at) order by z.issued_at), '[]'::jsonb)
                   from public.zatca_invoices z where z.order_id = o.id),
    'disputes', (select coalesce(jsonb_agg(to_jsonb(d) order by d.opened_at), '[]'::jsonb)
                   from public.order_disputes d where d.order_id = o.id),
    'payment_operations', (select coalesce(jsonb_agg(to_jsonb(po) order by po.created_at), '[]'::jsonb)
                             from public.payment_operations po where po.order_id = o.id),
    'payout', (select jsonb_build_object('payout_id', py.id, 'status', py.status, 'paid_at', py.paid_at)
                 from public.payout_orders pyo join public.payouts py on py.id = pyo.payout_id
                where pyo.order_id = o.id limit 1),
    'parent_order', (select jsonb_build_object('id', po.id, 'order_number', po.order_number)
                       from public.orders po where po.id = o.parent_order_id),
    'notes', public.ops_notes_for('orders', o.id)
  )
  into v_result
  from public.orders o
  join public.services s on s.id = o.service_id
  where o.id = p_order_id;

  if v_result is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;
  return v_result;
end;
$$;


-- ===========================================================================
-- Reading: people
-- ===========================================================================
create or replace function public.ops_notes_for(p_table text, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'body', n.body, 'author_name', ap.full_name, 'created_at', n.created_at)
           order by n.created_at desc), '[]'::jsonb)
    from public.ops_notes n left join public.profiles ap on ap.id = n.author_id
   where n.target_table = p_table and n.target_id = p_id and public.is_ops();
$$;

revoke execute on function public.ops_notes_for(text, uuid) from public, anon;

create or replace function public.ops_list_users(
  p_query  text default null,
  p_filter text default 'all',
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  id uuid, full_name text, phone text, email text, is_guest boolean, roles text[],
  suspended boolean, orders_count bigint, created_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
begin
  perform public.assert_ops();
  if v_digits like '05%' then
    v_digits := '966' || substr(v_digits, 2);
  end if;

  return query
  with base as (
    select p.*,
           coalesce((select array_agg(r.role::text order by r.role::text) from public.user_roles r
                      where r.user_id = p.id and r.revoked_at is null), '{}') as active_roles,
           public.is_suspended(p.id) as is_susp
      from public.profiles p
  )
  select b.id, b.full_name, b.phone, b.email, b.is_guest, b.active_roles, b.is_susp,
         (select count(*) from public.orders o where o.customer_id = b.id and o.status <> 'draft'),
         b.created_at, count(*) over ()
    from base b
   where (p_query is null or trim(p_query) = ''
          or b.full_name ilike '%' || trim(p_query) || '%'
          or b.email ilike '%' || trim(p_query) || '%'
          or (length(v_digits) >= 4 and b.phone like '%' || v_digits || '%'))
     and case coalesce(p_filter, 'all')
           when 'customers' then not ('technician' = any(b.active_roles) or 'workshop_admin' = any(b.active_roles))
           when 'providers' then 'technician' = any(b.active_roles) or 'workshop_admin' = any(b.active_roles)
           when 'staff' then 'ops' = any(b.active_roles) or 'super_admin' = any(b.active_roles)
           when 'suspended' then b.is_susp
           when 'guests' then b.is_guest
           else true
         end
   order by b.created_at desc
   limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.ops_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.assert_ops();

  select jsonb_build_object(
    'profile', to_jsonb(p),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object(
                'role', r.role, 'granted_at', r.granted_at, 'revoked_at', r.revoked_at,
                'granted_by_name', gp.full_name) order by r.granted_at desc), '[]'::jsonb)
                from public.user_roles r left join public.profiles gp on gp.id = r.granted_by
               where r.user_id = p.id),
    'suspensions', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', s.id, 'reason', s.reason, 'suspended_at', s.suspended_at,
                      'suspended_by_name', sp.full_name, 'lifted_at', s.lifted_at, 'lift_note', s.lift_note)
                      order by s.suspended_at desc), '[]'::jsonb)
                      from public.account_suspensions s left join public.profiles sp on sp.id = s.suspended_by
                     where s.user_id = p.id),
    'suspended', public.is_suspended(p.id),
    'vehicles', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', v.id, 'plate_ar', v.plate_ar, 'plate_en', v.plate_en, 'year', v.year,
                   'make_ar', mk.name_ar, 'model_ar', md.name_ar, 'is_active', v.is_active,
                   'current_mileage', v.current_mileage) order by v.created_at), '[]'::jsonb)
                   from public.vehicles v
                   left join public.vehicle_makes mk on mk.id = v.make_id
                   left join public.vehicle_models md on md.id = v.model_id
                  where v.owner_id = p.id),
    'orders', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
                 select o.id, o.order_number, o.status, s.name_ar as service_name_ar,
                        coalesce(o.total_amount, o.quoted_amount) as amount, o.created_at
                   from public.orders o join public.services s on s.id = o.service_id
                  where o.customer_id = p.id and o.status <> 'draft'
                  order by o.created_at desc limit 50) x),
    'provider', (select jsonb_build_object('id', pr.id, 'business_name_ar', pr.business_name_ar,
                                           'verification_status', pr.verification_status,
                                           'provider_type', pr.provider_type)
                   from public.providers pr where pr.owner_profile_id = p.id),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object(
                  'platform', d.platform, 'locale', d.locale, 'last_seen_at', d.last_seen_at,
                  'disabled_at', d.disabled_at) order by d.last_seen_at desc), '[]'::jsonb)
                  from public.push_devices d where d.user_id = p.id),
    'transfers', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', t.id, 'vehicle_id', t.vehicle_id, 'status', t.status,
                    'direction', case when t.from_owner_id = p.id then 'out' else 'in' end,
                    'created_at', t.created_at, 'expires_at', t.expires_at) order by t.created_at desc), '[]'::jsonb)
                    from public.ownership_transfers t
                   where t.from_owner_id = p.id or t.to_owner_id = p.id),
    'ratings_given', (select count(*) from public.ratings r where r.rater_id = p.id),
    'data_requests', (select coalesce(jsonb_agg(jsonb_build_object(
                        'kind', dr.kind, 'reason', dr.reason, 'handled_at', dr.handled_at) order by dr.handled_at desc), '[]'::jsonb)
                        from public.data_requests dr where dr.user_id = p.id),
    'notes', public.ops_notes_for('profiles', p.id)
  )
  into v_result
  from public.profiles p
  where p.id = p_user_id;

  if v_result is null then
    raise exception 'User % not found', p_user_id using errcode = 'no_data_found';
  end if;

  perform public.audit_ops_read('profiles', p_user_id::text);
  return v_result;
end;
$$;


-- ===========================================================================
-- Reading: providers and vehicles
-- ===========================================================================
create or replace function public.ops_list_providers(
  p_status text default null,
  p_query  text default null,
  p_online boolean default null,
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  id uuid, business_name_ar text, provider_type text, verification_status text,
  city_name_ar text, owner_profile_id uuid, owner_phone text, is_online boolean,
  rating_avg numeric, rating_count int, jobs_completed int, nafath_verified_at timestamptz,
  suspended boolean, created_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();

  return query
  select pr.id, pr.business_name_ar, pr.provider_type::text, pr.verification_status::text,
         c.name_ar, pr.owner_profile_id, op.phone, pr.is_online, pr.rating_avg, pr.rating_count,
         pr.jobs_completed, pr.nafath_verified_at, public.is_suspended(pr.owner_profile_id),
         pr.created_at, count(*) over ()
    from public.providers pr
    join public.profiles op on op.id = pr.owner_profile_id
    left join public.cities c on c.id = pr.city_id
   where (p_status is null or pr.verification_status::text = p_status)
     and (p_online is null or pr.is_online = p_online)
     and (p_query is null or trim(p_query) = ''
          or pr.business_name_ar ilike '%' || trim(p_query) || '%'
          or pr.business_name_en ilike '%' || trim(p_query) || '%'
          or pr.cr_number = trim(p_query)
          or op.phone like '%' || regexp_replace(p_query, '\D', '', 'g') || '%' and length(regexp_replace(p_query, '\D', '', 'g')) >= 4)
   order by pr.created_at desc
   limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.ops_provider_detail(p_provider_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.assert_ops();

  select jsonb_build_object(
    -- Never the *_encrypted columns (0037).
    'provider', to_jsonb(pr) - 'national_id_encrypted' - 'iban_encrypted'
                || jsonb_build_object('has_national_id', pr.national_id_encrypted is not null,
                                      'has_iban', pr.iban_encrypted is not null),
    'owner', jsonb_build_object('id', op.id, 'full_name', op.full_name, 'phone', op.phone,
                                'email', op.email, 'suspended', public.is_suspended(op.id)),
    'city', (select jsonb_build_object('id', c.id, 'name_ar', c.name_ar) from public.cities c where c.id = pr.city_id),
    'services', (select coalesce(jsonb_agg(jsonb_build_object(
                   'service_id', s.id, 'name_ar', s.name_ar, 'base_price', s.base_price,
                   'custom_price', ps.custom_price, 'offered', ps.provider_id is not null)
                   order by s.sort_order), '[]'::jsonb)
                   from public.services s
                   left join public.provider_services ps on ps.service_id = s.id and ps.provider_id = pr.id
                  where s.is_active or ps.provider_id is not null),
    'workshop', (select to_jsonb(w) - 'location' from public.workshops w where w.provider_id = pr.id),
    'location', (select jsonb_build_object(
                   'lat', extensions.st_y(l.location::extensions.geometry),
                   'lon', extensions.st_x(l.location::extensions.geometry), 'updated_at', l.updated_at)
                   from public.provider_locations l where l.provider_id = pr.id),
    'verification_events', (select coalesce(jsonb_agg(jsonb_build_object(
                              'from', e.from_status, 'to', e.to_status, 'note', e.note,
                              'actor_name', ap.full_name, 'at', e.created_at) order by e.created_at desc), '[]'::jsonb)
                              from public.provider_verification_events e
                              left join public.profiles ap on ap.id = e.actor_id
                             where e.provider_id = pr.id),
    'ratings', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', r.id, 'stars', r.stars, 'comment', r.comment, 'tags', r.tags,
                  'hidden_at', r.hidden_at, 'hidden_reason', r.hidden_reason, 'created_at', r.created_at)
                  order by r.created_at desc), '[]'::jsonb)
                  from public.ratings r where r.provider_id = pr.id),
    'orders', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
                 select o.id, o.order_number, o.status, s.name_ar as service_name_ar,
                        coalesce(o.total_amount, o.quoted_amount) as amount, o.created_at
                   from public.orders o join public.services s on s.id = o.service_id
                  where o.provider_id = pr.id
                  order by o.created_at desc limit 50) x),
    'stats', jsonb_build_object(
               'completed', (select count(*) from public.orders o where o.provider_id = pr.id and o.status = 'completed'),
               'cancelled', (select count(*) from public.orders o where o.provider_id = pr.id and o.status = 'cancelled'),
               'disputed', (select count(*) from public.order_disputes d join public.orders o on o.id = d.order_id
                             where o.provider_id = pr.id),
               'earned', (select coalesce(sum(o.total_amount - o.refunded_amount), 0) from public.orders o
                           where o.provider_id = pr.id and o.escrow_status in ('captured', 'refunded')),
               'offers_sent', (select count(*) from public.order_offers f where f.provider_id = pr.id),
               'offers_accepted', (select count(*) from public.order_offers f
                                    where f.provider_id = pr.id and f.outcome = 'accepted')),
    'payouts', (select coalesce(jsonb_agg(to_jsonb(py) order by py.created_at desc), '[]'::jsonb)
                  from public.payouts py where py.provider_id = pr.id),
    'notes', public.ops_notes_for('providers', pr.id)
  )
  into v_result
  from public.providers pr
  join public.profiles op on op.id = pr.owner_profile_id
  where pr.id = p_provider_id;

  if v_result is null then
    raise exception 'Provider % not found', p_provider_id using errcode = 'no_data_found';
  end if;

  perform public.audit_ops_read('providers', p_provider_id::text);
  return v_result;
end;
$$;

create or replace function public.ops_vehicle_detail(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.assert_ops();

  select jsonb_build_object(
    'vehicle', to_jsonb(v) || jsonb_build_object('make_ar', mk.name_ar, 'model_ar', md.name_ar),
    'owner', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone)
                from public.profiles p where p.id = v.owner_id),
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', t.id, 'seq', t.seq, 'event_type', t.event_type, 'occurred_at', t.occurred_at,
                   'mileage', t.mileage, 'provenance', t.provenance, 'summary_ar', t.summary_ar,
                   'order_id', t.order_id, 'details', t.details,
                   'attachments', jsonb_array_length(t.attachments), 'row_hash', t.row_hash)
                   order by t.seq desc), '[]'::jsonb)
                   from public.vehicle_timeline t where t.vehicle_id = v.id),
    'transfers', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', t.id, 'status', t.status, 'from_owner_id', t.from_owner_id,
                    'to_owner_id', t.to_owner_id, 'to_phone', t.to_phone, 'to_email', t.to_email,
                    'created_at', t.created_at, 'expires_at', t.expires_at, 'accepted_at', t.accepted_at,
                    'failed_attempts', t.failed_attempts, 'locked_at', t.locked_at)
                    order by t.created_at desc), '[]'::jsonb)
                    from public.ownership_transfers t where t.vehicle_id = v.id),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', r.id, 'generated_at', r.generated_at, 'expires_at', r.expires_at,
                  'revoked_at', r.revoked_at, 'chain_valid', r.chain_valid, 'chain_length', r.chain_length)
                  order by r.generated_at desc), '[]'::jsonb)
                  from public.habba_reports r where r.vehicle_id = v.id),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', d.id, 'doc_type', d.doc_type, 'expires_at', d.expires_at, 'note', d.note)
                    order by d.expires_at), '[]'::jsonb)
                    from public.vehicle_documents d where d.vehicle_id = v.id),
    'orders', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
                 select o.id, o.order_number, o.status, s.name_ar as service_name_ar, o.created_at
                   from public.orders o join public.services s on s.id = o.service_id
                  where o.vehicle_id = v.id and o.status <> 'draft'
                  order by o.created_at desc limit 50) x),
    'notes', public.ops_notes_for('vehicles', v.id)
  )
  into v_result
  from public.vehicles v
  left join public.vehicle_makes mk on mk.id = v.make_id
  left join public.vehicle_models md on md.id = v.model_id
  where v.id = p_vehicle_id;

  if v_result is null then
    raise exception 'Vehicle % not found', p_vehicle_id using errcode = 'no_data_found';
  end if;

  perform public.audit_ops_read('vehicles', p_vehicle_id::text);
  return v_result;
end;
$$;


-- ===========================================================================
-- Reading: queues and records
-- ===========================================================================
create or replace function public.ops_list_disputes(p_open boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', d.id, 'order_id', d.order_id, 'order_number', o.order_number,
             'service_name_ar', s.name_ar, 'customer_name', cp.full_name,
             'provider_name_ar', pr.business_name_ar, 'total_amount', o.total_amount,
             'refunded_amount', o.refunded_amount, 'reason', d.reason, 'opened_at', d.opened_at,
             'resolution', d.resolution, 'refund_amount', d.refund_amount,
             'resolution_note', d.resolution_note, 'resolved_at', d.resolved_at,
             'payout_already_built', d.payout_already_built)
             order by d.opened_at desc), '[]'::jsonb)
      from public.order_disputes d
      join public.orders o on o.id = d.order_id
      join public.services s on s.id = o.service_id
      join public.profiles cp on cp.id = o.customer_id
      left join public.providers pr on pr.id = o.provider_id
     where (p_open is null or (p_open and d.resolved_at is null) or (not p_open and d.resolved_at is not null))
  );
end;
$$;

create or replace function public.ops_list_ratings(p_hidden_only boolean default false, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  return (
    select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
      select r.id, r.order_id, o.order_number, r.stars, r.comment, r.tags, r.created_at,
             r.hidden_at, r.hidden_reason, rp.full_name as rater_name, pr.business_name_ar as provider_name_ar,
             r.provider_id
        from public.ratings r
        join public.orders o on o.id = r.order_id
        join public.profiles rp on rp.id = r.rater_id
        left join public.providers pr on pr.id = r.provider_id
       where not coalesce(p_hidden_only, false) or r.hidden_at is not null
       order by r.created_at desc
       limit least(greatest(p_limit, 1), 500)) x
  );
end;
$$;

create or replace function public.ops_list_payment_operations(p_status text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  return (
    select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
      select po.*, o.order_number, o.payment_intent_id, cp.full_name as customer_name,
             rp.full_name as requested_by_name
        from public.payment_operations po
        join public.orders o on o.id = po.order_id
        join public.profiles cp on cp.id = o.customer_id
        left join public.profiles rp on rp.id = po.requested_by
       where p_status is null or po.status = p_status
       order by po.created_at desc limit 500) x
  );
end;
$$;

create or replace function public.ops_list_payouts(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  return (
    select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
      select py.*, pr.business_name_ar as provider_name_ar,
             (pr.iban_encrypted is not null) as provider_has_iban
        from public.payouts py join public.providers pr on pr.id = py.provider_id
       where p_status is null or py.status::text = p_status
       order by py.created_at desc limit 500) x
  );
end;
$$;

-- Money in, money out, over a period — the operator's view of the books.
create or replace function public.ops_finance_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  return (
    select jsonb_build_object(
      'orders', count(*),
      'gross', coalesce(sum(o.total_amount), 0),
      'refunded', coalesce(sum(o.refunded_amount), 0),
      'net_of_vat', coalesce(sum(o.parts_amount + o.labour_amount), 0),
      'vat', coalesce(sum(o.vat_amount), 0),
      'held_authorised', (select coalesce(sum(coalesce(h.total_amount, h.quoted_amount)), 0)
                            from public.orders h where h.escrow_status = 'authorised'),
      'payouts_pending', (select coalesce(sum(py.net_amount), 0) from public.payouts py
                           where py.status in ('pending', 'approved')),
      'payouts_paid', (select coalesce(sum(py.net_amount), 0) from public.payouts py
                        where py.status = 'paid' and py.paid_at::date between p_from and p_to),
      'commission', (select coalesce(sum(pyo.commission), 0) from public.payout_orders pyo
                       join public.orders po on po.id = pyo.order_id
                      where po.completed_at::date between p_from and p_to))
    from public.orders o
    where o.escrow_status in ('captured', 'refunded')
      and (o.completed_at at time zone 'Asia/Riyadh')::date between p_from and p_to
  );
end;
$$;

create or replace function public.ops_list_staff()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone,
             'role', r.role, 'granted_at', r.granted_at, 'granted_by_name', gp.full_name)
             order by r.granted_at), '[]'::jsonb)
      from public.user_roles r
      join public.profiles p on p.id = r.user_id
      left join public.profiles gp on gp.id = r.granted_by
     where r.role in ('ops', 'super_admin') and r.revoked_at is null
  );
end;
$$;

create or replace function public.ops_list_records(p_kind text, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  if p_kind = 'broadcasts' then
    return (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
              select b.*, sp.full_name as sent_by_name
                from public.ops_broadcasts b left join public.profiles sp on sp.id = b.sent_by
               order by b.created_at desc limit p_limit) x);
  elsif p_kind = 'data_requests' then
    return (select coalesce(jsonb_agg(x order by x.handled_at desc), '[]'::jsonb) from (
              select d.*, p.full_name as user_name, hp.full_name as handled_by_name
                from public.data_requests d
                left join public.profiles p on p.id = d.user_id
                left join public.profiles hp on hp.id = d.handled_by
               order by d.handled_at desc limit p_limit) x);
  elsif p_kind = 'transfers' then
    return (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
              select t.id, t.vehicle_id, v.plate_ar, t.status, fp.full_name as from_name,
                     coalesce(tp.full_name, t.to_phone, t.to_email) as to_name, t.created_at,
                     t.expires_at, t.failed_attempts, t.locked_at
                from public.ownership_transfers t
                join public.vehicles v on v.id = t.vehicle_id
                join public.profiles fp on fp.id = t.from_owner_id
                left join public.profiles tp on tp.id = t.to_owner_id
               order by t.created_at desc limit p_limit) x);
  elsif p_kind = 'reports' then
    return (select coalesce(jsonb_agg(x order by x.generated_at desc), '[]'::jsonb) from (
              select r.id, r.vehicle_id, v.plate_ar, r.generated_at, r.expires_at, r.revoked_at,
                     r.chain_valid, r.chain_length
                from public.habba_reports r join public.vehicles v on v.id = r.vehicle_id
               order by r.generated_at desc limit p_limit) x);
  elsif p_kind = 'notifications' then
    return (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
              select n.id, n.kind, n.title_ar, p.full_name as user_name, n.created_at, n.sent_at,
                     n.abandoned_at, n.attempts, n.last_error, n.expires_at
                from public.notification_outbox n left join public.profiles p on p.id = n.user_id
               order by n.created_at desc limit p_limit) x);
  end if;
  raise exception 'Unknown record kind %', p_kind using errcode = 'invalid_parameter_value';
end;
$$;


-- ===========================================================================
-- Acting on orders
-- ===========================================================================
create or replace function public.ops_cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := public.assert_reason(p_reason);
  v_status public.order_status;
begin
  perform public.assert_ops();

  select o.status into v_status from public.orders o where o.id = p_order_id;
  if v_status is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;
  if v_status in ('completed', 'cancelled', 'disputed') then
    raise exception 'A % order cannot be cancelled', v_status using errcode = 'check_violation',
      hint = 'A finished order is refunded through a dispute instead.';
  end if;

  -- The state machine, the slot release and the escrow release (0069) all run
  -- on this one update, exactly as they do when the customer cancels.
  update public.orders
     set status = 'cancelled', cancellation_reason = 'هبّة: ' || v_reason
   where id = p_order_id;

  perform public.begin_privileged_write();
  update public.order_offers set outcome = 'expired', responded_at = now()
   where order_id = p_order_id and outcome in ('pending', 'viewed');
  perform public.end_privileged_write();
end;
$$;

-- For a customer who confirmed by phone, or who cannot use the app.
create or replace function public.ops_confirm_completion(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := public.assert_reason(p_reason);
  v_order  record;
begin
  perform public.assert_ops();

  select * into v_order from public.orders o where o.id = p_order_id;
  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;
  if v_order.status <> 'awaiting_approval' then
    raise exception 'Only an order awaiting the customer''s approval can be confirmed (order is %)', v_order.status
      using errcode = 'check_violation';
  end if;

  update public.orders set status = 'completed' where id = p_order_id;

  if v_order.escrow_status = 'authorised' then
    perform public.capture_order_payment(p_order_id);
  end if;

  insert into public.ops_notes (target_table, target_id, body, author_id)
  values ('orders', p_order_id, 'تأكيد الاكتمال نيابةً عن العميل: ' || v_reason, auth.uid());
end;
$$;

-- Give the job to a named provider: nobody in range accepted, or the one who
-- did has to be replaced before they set off.
create or replace function public.ops_assign_provider(p_order_id uuid, p_provider_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason   text := public.assert_reason(p_reason);
  v_order    record;
  v_provider record;
begin
  perform public.assert_ops();

  select * into v_order from public.orders o where o.id = p_order_id;
  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if v_order.status not in ('searching', 'quoted', 'accepted') then
    raise exception 'A provider can be assigned only before anyone sets off (order is %)', v_order.status
      using errcode = 'check_violation',
            hint = 'Cancel the order and place a new one for the customer.';
  end if;

  select * into v_provider from public.providers pr where pr.id = p_provider_id;
  if v_provider is null or v_provider.verification_status <> 'approved' then
    raise exception 'Only an approved provider can be assigned' using errcode = 'check_violation';
  end if;
  if public.is_suspended(v_provider.owner_profile_id) then
    raise exception 'That provider''s account is suspended' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.provider_services ps
                  where ps.provider_id = p_provider_id and ps.service_id = v_order.service_id) then
    raise exception 'That provider does not offer this service' using errcode = 'check_violation';
  end if;
  if coalesce(v_order.quoted_amount, 0) > 0 and v_order.escrow_status <> 'authorised' then
    raise exception 'This order is not funded' using errcode = 'check_violation';
  end if;
  if v_order.provider_id = p_provider_id then
    return;
  end if;

  update public.orders
     set provider_id = p_provider_id,
         status = 'accepted'
   where id = p_order_id;

  perform public.begin_privileged_write();
  update public.order_offers set outcome = 'expired', responded_at = now()
   where order_id = p_order_id and provider_id <> p_provider_id and outcome in ('pending', 'viewed');
  perform public.end_privileged_write();

  perform public.enqueue_notification(
    v_provider.owner_profile_id, 'job_assigned',
    'أسندت إليك هبّة طلباً', 'Habba assigned you a job',
    'افتح الطلب لتفاصيل الموقع والعميل.', 'Open the job for the location and the customer.',
    jsonb_build_object('route', '/job', 'id', p_order_id),
    format('assigned:%s:%s', p_order_id, p_provider_id));

  insert into public.ops_notes (target_table, target_id, body, author_id)
  values ('orders', p_order_id,
          format('إسناد إلى %s: %s', v_provider.business_name_ar, v_reason), auth.uid());
end;
$$;

-- Search again from the first round: providers may have come online since.
create or replace function public.ops_retry_dispatch(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.order_status;
begin
  perform public.assert_ops();

  select o.status into v_status from public.orders o where o.id = p_order_id;
  if v_status is distinct from 'searching' then
    raise exception 'Only an order that is still searching can be re-dispatched'
      using errcode = 'check_violation';
  end if;

  perform public.begin_privileged_write();
  update public.orders set dispatch_round = 0 where id = p_order_id;
  perform public.end_privileged_write();

  return public.broadcast_order(p_order_id, 1);
end;
$$;

create or replace function public.ops_open_dispute(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  perform public.open_order_dispute(p_order_id, p_reason);
end;
$$;

create or replace function public.ops_resolve_dispute(
  p_order_id      uuid,
  p_resolution    text,
  p_refund_amount numeric,
  p_note          text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note      text := public.assert_reason(p_note);
  v_order     record;
  v_dispute   uuid;
  v_remaining numeric(12,2);
  v_refund    numeric(12,2);
  v_paid_out  boolean;
begin
  perform public.assert_ops();

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if v_order is null or v_order.status <> 'disputed' then
    raise exception 'This order is not in dispute' using errcode = 'check_violation';
  end if;

  select d.id into v_dispute from public.order_disputes d
   where d.order_id = p_order_id and d.resolved_at is null;

  v_remaining := coalesce(v_order.total_amount, 0) - v_order.refunded_amount;

  v_refund := case p_resolution
    when 'upheld' then 0
    when 'full_refund' then v_remaining
    when 'partial_refund' then round(coalesce(p_refund_amount, 0), 2)
  end;

  if v_refund is null then
    raise exception 'Unknown resolution %', p_resolution using errcode = 'invalid_parameter_value';
  end if;
  if p_resolution = 'partial_refund' and (v_refund <= 0 or v_refund >= v_remaining) then
    raise exception 'A partial refund is more than nothing and less than the % SAR paid', v_remaining
      using errcode = 'check_violation';
  end if;
  if v_refund > 0 and v_order.escrow_status not in ('captured', 'refunded') then
    raise exception 'Nothing was captured on this order to refund (escrow is %)', v_order.escrow_status
      using errcode = 'check_violation';
  end if;

  v_paid_out := exists (select 1 from public.payout_orders po where po.order_id = p_order_id);

  update public.order_disputes
     set resolution = p_resolution, refund_amount = v_refund, resolution_note = v_note,
         resolved_by = auth.uid(), resolved_at = now(),
         payout_already_built = v_paid_out
   where id = v_dispute;

  if v_refund > 0 then
    perform public.begin_privileged_write();
    update public.orders
       set refunded_amount = refunded_amount + v_refund,
           escrow_status = case when refunded_amount + v_refund >= coalesce(total_amount, 0)
                                then 'refunded'::public.escrow_status else escrow_status end
     where id = p_order_id;
    perform public.end_privileged_write();

    insert into public.payment_operations (order_id, kind, amount, reason, requested_by)
    values (p_order_id, 'refund', v_refund, v_note, auth.uid());
  end if;

  update public.orders set status = 'completed' where id = p_order_id;

  perform public.enqueue_notification(
    v_order.customer_id, 'dispute_resolved',
    'تمت مراجعة شكواك', 'Your complaint was reviewed',
    case when v_refund > 0 then format('سيُعاد إليك %s ريال إلى وسيلة الدفع.', v_refund)
         else 'راجعت هبّة الطلب ولم يُقرَّر استرداد. التفاصيل في التطبيق.' end,
    case when v_refund > 0 then format('%s SAR will be returned to your payment method.', v_refund)
         else 'Habba reviewed the order and no refund was decided. Details are in the app.' end,
    jsonb_build_object('route', '/tracking', 'id', p_order_id),
    format('dispute:%s', v_dispute));
end;
$$;

-- Until a payment provider is connected, an operator carries out the void or
-- refund in the PSP's dashboard and records it here with its reference.
create or replace function public.ops_record_payment_operation(
  p_operation_id uuid, p_status text, p_reference text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform public.assert_ops();

  select po.status into v_status from public.payment_operations po where po.id = p_operation_id for update;
  if v_status is null then
    raise exception 'Payment operation % not found', p_operation_id using errcode = 'no_data_found';
  end if;
  if v_status = 'succeeded' then
    raise exception 'This operation is already recorded as done' using errcode = 'check_violation';
  end if;
  if p_status not in ('succeeded', 'failed') then
    raise exception 'Status is succeeded or failed' using errcode = 'invalid_parameter_value';
  end if;
  if p_status = 'succeeded' and length(trim(coalesce(p_reference, ''))) = 0 then
    raise exception 'Record the payment provider''s reference' using errcode = 'check_violation';
  end if;

  update public.payment_operations
     set status = p_status, psp_reference = nullif(trim(coalesce(p_reference, '')), ''),
         last_error = p_error, processed_at = now(), processed_by = auth.uid()
   where id = p_operation_id;
end;
$$;

create or replace function public.ops_set_payout_status(p_payout_id uuid, p_status text, p_reference text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.payout_status;
begin
  perform public.assert_ops();

  select py.status into v_status from public.payouts py where py.id = p_payout_id for update;
  if v_status is null then
    raise exception 'Payout % not found', p_payout_id using errcode = 'no_data_found';
  end if;
  if v_status = 'paid' then
    raise exception 'A paid payout is final' using errcode = 'check_violation';
  end if;
  if p_status = 'paid' and length(trim(coalesce(p_reference, ''))) = 0 then
    raise exception 'Record the bank transfer reference' using errcode = 'check_violation';
  end if;

  update public.payouts
     set status = p_status::public.payout_status,
         paid_at = case when p_status = 'paid' then now() end,
         reference = coalesce(nullif(trim(coalesce(p_reference, '')), ''), reference)
   where id = p_payout_id;
end;
$$;


-- ===========================================================================
-- Acting on people
-- ===========================================================================
create or replace function public.ops_set_suspension(p_user_id uuid, p_suspend boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := public.assert_reason(p_reason);
begin
  perform public.assert_ops();

  if p_user_id = auth.uid() then
    raise exception 'You cannot suspend or reinstate yourself' using errcode = 'check_violation';
  end if;
  if (public.has_role(p_user_id, 'ops') or public.has_role(p_user_id, 'super_admin'))
     and not public.is_super_admin() then
    raise exception 'Only a super admin may suspend a member of staff' using errcode = 'insufficient_privilege';
  end if;

  if p_suspend then
    if public.is_suspended(p_user_id) then
      return;
    end if;
    insert into public.account_suspensions (user_id, reason, suspended_by)
    values (p_user_id, v_reason, auth.uid());

    -- Off the road at once: no more offers, no position on anyone's map.
    perform public.begin_privileged_write();
    update public.providers set is_online = false where owner_profile_id = p_user_id;
    delete from public.provider_locations l
     using public.providers pr where pr.id = l.provider_id and pr.owner_profile_id = p_user_id;
    perform public.end_privileged_write();

    perform public.sync_auth_ban(p_user_id, true);
  else
    update public.account_suspensions
       set lifted_at = now(), lifted_by = auth.uid(), lift_note = v_reason
     where user_id = p_user_id and lifted_at is null;
    perform public.sync_auth_ban(p_user_id, false);
  end if;
end;
$$;

-- Staff roles only. Customer is everyone's; technician and workshop_admin
-- follow an approved provider record (0043) and are changed by approving or
-- suspending that record, never by hand.
create or replace function public.ops_set_staff_role(p_user_id uuid, p_role text, p_grant boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin manages staff roles' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('ops', 'super_admin') then
    raise exception 'Only staff roles are managed here' using errcode = 'invalid_parameter_value',
      hint = 'Provider roles follow the provider''s verification.';
  end if;

  if p_grant then
    if public.has_role(p_user_id, p_role::public.user_role) then
      return;
    end if;
    if public.is_suspended(p_user_id) then
      raise exception 'A suspended account cannot be made staff' using errcode = 'check_violation';
    end if;
    perform public.begin_privileged_write();
    insert into public.user_roles (user_id, role, granted_by)
    values (p_user_id, p_role::public.user_role, auth.uid());
    perform public.end_privileged_write();
  else
    if p_user_id = auth.uid() and p_role = 'super_admin' then
      raise exception 'You cannot remove your own super admin role' using errcode = 'check_violation',
        hint = 'Another super admin has to do it — so there is always one left.';
    end if;
    perform public.begin_privileged_write();
    -- clock_timestamp, not now(): a grant stamped earlier in the same
    -- transaction would otherwise be "revoked before it was granted".
    update public.user_roles set revoked_at = greatest(clock_timestamp(), granted_at)
     where user_id = p_user_id and role = p_role::public.user_role and revoked_at is null;
    perform public.end_privileged_write();
  end if;
end;
$$;

create or replace function public.ops_update_profile(p_user_id uuid, p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'A name is required' using errcode = 'check_violation';
  end if;
  perform public.begin_privileged_write();
  update public.profiles set full_name = trim(p_full_name) where id = p_user_id;
  perform public.end_privileged_write();
end;
$$;

create or replace function public.ops_add_note(p_table text, p_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  insert into public.ops_notes (target_table, target_id, body, author_id)
  values (p_table, p_id, trim(p_body), auth.uid());
end;
$$;


-- ===========================================================================
-- Acting on providers, reviews, cars
-- ===========================================================================
create or replace function public.ops_force_offline(p_provider_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := public.assert_reason(p_reason);
begin
  perform public.assert_ops();
  perform public.begin_privileged_write();
  update public.providers set is_online = false where id = p_provider_id;
  delete from public.provider_locations where provider_id = p_provider_id;
  perform public.end_privileged_write();

  insert into public.ops_notes (target_table, target_id, body, author_id)
  values ('providers', p_provider_id, 'إيقاف الاتصال: ' || v_reason, auth.uid());
end;
$$;

create or replace function public.ops_set_provider_service(
  p_provider_id uuid, p_service_id uuid, p_offered boolean, p_custom_price numeric default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_ops();
  if p_custom_price is not null and p_custom_price < 0 then
    raise exception 'A price cannot be negative' using errcode = 'check_violation';
  end if;

  perform public.begin_privileged_write();
  if p_offered then
    insert into public.provider_services (provider_id, service_id, custom_price)
    values (p_provider_id, p_service_id, round(p_custom_price, 2))
    on conflict (provider_id, service_id) do update set custom_price = excluded.custom_price;
  else
    delete from public.provider_services where provider_id = p_provider_id and service_id = p_service_id;
  end if;
  perform public.end_privileged_write();
end;
$$;

create or replace function public.ops_set_rating_hidden(p_rating_id uuid, p_hidden boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider uuid;
begin
  perform public.assert_ops();

  update public.ratings
     set hidden_at = case when p_hidden then now() end,
         hidden_by = case when p_hidden then auth.uid() end,
         hidden_reason = case when p_hidden then public.assert_reason(p_reason) end
   where id = p_rating_id
  returning provider_id into v_provider;

  if v_provider is null then
    raise exception 'Rating % not found', p_rating_id using errcode = 'no_data_found';
  end if;
  perform public.recompute_provider_rating(v_provider);
end;
$$;

create or replace function public.ops_revoke_report(p_report_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := public.assert_reason(p_reason);
  v_vehicle uuid;
begin
  perform public.assert_ops();
  update public.habba_reports set revoked_at = coalesce(revoked_at, now())
   where id = p_report_id returning vehicle_id into v_vehicle;
  if v_vehicle is null then
    raise exception 'Report % not found', p_report_id using errcode = 'no_data_found';
  end if;
  insert into public.ops_notes (target_table, target_id, body, author_id)
  values ('vehicles', v_vehicle, 'إلغاء تقرير هبّة: ' || v_reason, auth.uid());
end;
$$;

create or replace function public.ops_cancel_transfer(p_transfer_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason  text := public.assert_reason(p_reason);
  v_vehicle uuid;
begin
  perform public.assert_ops();
  perform public.begin_privileged_write();
  update public.ownership_transfers set status = 'cancelled'
   where id = p_transfer_id and status = 'pending'
  returning vehicle_id into v_vehicle;
  perform public.end_privileged_write();

  if v_vehicle is null then
    raise exception 'No pending transfer %', p_transfer_id using errcode = 'check_violation';
  end if;
  insert into public.ops_notes (target_table, target_id, body, author_id)
  values ('vehicles', v_vehicle, 'إلغاء نقل ملكية: ' || v_reason, auth.uid());
end;
$$;

-- A correction to the logbook is an entry of its own, signed by Habba, that
-- says what was wrong. The original stays; the report shows both.
create or replace function public.ops_annotate_vehicle(p_vehicle_id uuid, p_note_ar text, p_note_en text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := public.assert_reason(p_note_ar);
begin
  perform public.assert_ops();
  return public.append_vehicle_timeline_event(
    p_vehicle_id => p_vehicle_id,
    p_event_type => 'record_annotated',
    p_summary_ar => 'ملاحظة من هبّة: ' || v_note,
    p_summary_en => 'Note from Habba: ' || coalesce(nullif(trim(coalesce(p_note_en, '')), ''), v_note),
    p_details    => jsonb_build_object('note_ar', v_note)
  );
end;
$$;

create or replace function public.ops_set_vehicle_active(p_vehicle_id uuid, p_active boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := public.assert_reason(p_reason);
begin
  perform public.assert_ops();
  update public.vehicles set is_active = p_active where id = p_vehicle_id;
  insert into public.ops_notes (target_table, target_id, body, author_id)
  values ('vehicles', p_vehicle_id,
          case when p_active then 'إعادة تفعيل: ' else 'إيقاف: ' end || v_reason, auth.uid());
end;
$$;


-- ===========================================================================
-- Telling people
-- ===========================================================================
create or replace function public.ops_broadcast(
  p_audience text, p_city_id uuid,
  p_title_ar text, p_body_ar text, p_title_en text, p_body_en text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_count int;
begin
  perform public.assert_ops();
  if length(trim(coalesce(p_title_ar, ''))) = 0 or length(trim(coalesce(p_body_ar, ''))) = 0 then
    raise exception 'A title and a message are required' using errcode = 'check_violation';
  end if;

  insert into public.ops_broadcasts (audience, city_id, title_ar, body_ar, title_en, body_en, sent_by)
  values (p_audience, case when p_audience = 'city' then p_city_id end,
          trim(p_title_ar), trim(p_body_ar),
          coalesce(nullif(trim(coalesce(p_title_en, '')), ''), trim(p_title_ar)),
          coalesce(nullif(trim(coalesce(p_body_en, '')), ''), trim(p_body_ar)),
          auth.uid())
  returning id into v_id;

  insert into public.notification_outbox
    (user_id, kind, title_ar, title_en, body_ar, body_en, data, dedupe_key, expires_at)
  select p.id, 'announcement', b.title_ar, b.title_en, b.body_ar, b.body_en,
         jsonb_build_object('route', '/'), format('broadcast:%s:%s', v_id, p.id),
         now() + public.notification_ttl('announcement')
    from public.profiles p
    cross join public.ops_broadcasts b
   where b.id = v_id
     and not public.is_suspended(p.id)
     and exists (select 1 from public.push_devices d where d.user_id = p.id and d.disabled_at is null)
     and case p_audience
           when 'customers' then not exists (select 1 from public.providers pr
                                              where pr.owner_profile_id = p.id and pr.verification_status = 'approved')
           when 'providers' then exists (select 1 from public.providers pr
                                          where pr.owner_profile_id = p.id and pr.verification_status = 'approved')
           when 'city' then p.city_id = p_city_id
                            or exists (select 1 from public.providers pr
                                        where pr.owner_profile_id = p.id and pr.city_id = p_city_id)
           else true
         end
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  update public.ops_broadcasts set recipients = v_count where id = v_id;
  return v_count;
end;
$$;


-- ===========================================================================
-- PDPL: access and erasure
-- ===========================================================================
-- Everything Habba holds about one person, as one document to hand them.
create or replace function public.ops_export_user_data(p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := public.assert_reason(p_reason);
  v_result jsonb;
begin
  perform public.assert_ops();

  select jsonb_build_object(
    'generated_at', now(),
    'profile', to_jsonb(p),
    'roles', (select coalesce(jsonb_agg(to_jsonb(r) - 'granted_by'), '[]'::jsonb)
                from public.user_roles r where r.user_id = p.id),
    'vehicles', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
                   from public.vehicles v where v.owner_id = p.id),
    'logbook', (select coalesce(jsonb_agg(jsonb_build_object(
                  'vehicle_id', t.vehicle_id, 'event_type', t.event_type, 'occurred_at', t.occurred_at,
                  'mileage', t.mileage, 'summary_ar', t.summary_ar, 'details', t.details) order by t.seq), '[]'::jsonb)
                  from public.vehicle_timeline t
                  join public.vehicles v on v.id = t.vehicle_id and v.owner_id = p.id),
    'vehicle_documents', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
                            from public.vehicle_documents d
                            join public.vehicles v on v.id = d.vehicle_id and v.owner_id = p.id),
    'orders', (select coalesce(jsonb_agg(to_jsonb(o) - 'service_location'
                                         || jsonb_build_object('service_name_ar', s.name_ar)), '[]'::jsonb)
                 from public.orders o join public.services s on s.id = o.service_id
                where o.customer_id = p.id),
    'ratings_given', (select coalesce(jsonb_agg(to_jsonb(r) - 'hidden_by'), '[]'::jsonb)
                        from public.ratings r where r.rater_id = p.id),
    'ownership_transfers', (select coalesce(jsonb_agg(to_jsonb(t) - 'otp_code_hash'), '[]'::jsonb)
                              from public.ownership_transfers t
                             where t.from_owner_id = p.id or t.to_owner_id = p.id),
    'provider', (select to_jsonb(pr) - 'national_id_encrypted' - 'iban_encrypted'
                   from public.providers pr where pr.owner_profile_id = p.id),
    'devices', (select coalesce(jsonb_agg(to_jsonb(d) - 'token'), '[]'::jsonb)
                  from public.push_devices d where d.user_id = p.id),
    'suspensions', (select coalesce(jsonb_agg(to_jsonb(s) - 'suspended_by' - 'lifted_by'), '[]'::jsonb)
                      from public.account_suspensions s where s.user_id = p.id)
  )
  into v_result
  from public.profiles p where p.id = p_user_id;

  if v_result is null then
    raise exception 'User % not found', p_user_id using errcode = 'no_data_found';
  end if;

  insert into public.data_requests (user_id, kind, reason, handled_by)
  values (p_user_id, 'export', v_reason, auth.uid());
  perform public.audit_ops_read('profiles', p_user_id::text, jsonb_build_object('export', true, 'reason', v_reason));

  return v_result;
end;
$$;

-- Erasure, as anonymisation (ADR-0010). The account keeps its id — every
-- invoice, payout and logbook entry that points at it stays valid, and the
-- logbook's hash chain covers that id, so it must not change. What goes is
-- everything that says who the person was.
--
-- The logbook stays with the car: it is the vehicle's history, and the next
-- owner's. Invoices stay: ZATCA requires them to be kept.
create or replace function public.ops_anonymise_user(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := public.assert_reason(p_reason);
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin may erase an account' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot erase your own account' using errcode = 'check_violation';
  end if;
  if public.has_role(p_user_id, 'ops') or public.has_role(p_user_id, 'super_admin') then
    raise exception 'Remove the staff role first' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.orders o
              left join public.providers pr on pr.id = o.provider_id
              where (o.customer_id = p_user_id or pr.owner_profile_id = p_user_id)
                and o.status not in ('draft', 'completed', 'cancelled')) then
    raise exception 'This person has an order in progress or in dispute' using errcode = 'check_violation',
      hint = 'Finish or cancel it first.';
  end if;
  if exists (select 1 from public.payouts py join public.providers pr on pr.id = py.provider_id
              where pr.owner_profile_id = p_user_id and py.status in ('pending', 'approved')) then
    raise exception 'This provider has a payout still to be paid' using errcode = 'check_violation';
  end if;

  insert into public.data_requests (user_id, kind, reason, handled_by)
  values (p_user_id, 'erasure', v_reason, auth.uid());

  if not public.is_suspended(p_user_id) then
    insert into public.account_suspensions (user_id, reason, suspended_by)
    values (p_user_id, 'حُذفت بيانات الحساب بطلب صاحبه', auth.uid());
  end if;

  perform public.begin_privileged_write();

  update public.profiles
     set full_name = 'مستخدم محذوف', phone = null, email = null, avatar_url = null,
         phone_verified = false, email_verified = false, is_guest = true
   where id = p_user_id;

  delete from public.push_devices where user_id = p_user_id;

  update public.orders
     set service_address_ar = null, problem_description = null, triage_media = '[]'::jsonb
   where customer_id = p_user_id;

  update public.vehicles set nickname = null, photo_url = null, is_active = false
   where owner_id = p_user_id;

  update public.ownership_transfers set status = 'cancelled'
   where (from_owner_id = p_user_id or to_owner_id = p_user_id) and status = 'pending';

  update public.providers
     set is_online = false,
         verification_status = 'suspended',
         business_name_ar = case when provider_type = 'individual' then 'مقدّم خدمة محذوف' else business_name_ar end,
         business_name_en = case when provider_type = 'individual' then null else business_name_en end
   where owner_profile_id = p_user_id;

  delete from public.provider_locations l
   using public.providers pr where pr.id = l.provider_id and pr.owner_profile_id = p_user_id;

  update public.ratings set comment = null where rater_id = p_user_id;

  perform public.end_privileged_write();

  -- Sign-in identifiers, so the phone number is free to sign up again as a
  -- new person, and the old one cannot sign back in.
  begin
    update auth.users set phone = null, email = null where id = p_user_id;
  exception when others then
    null;
  end;
  perform public.sync_auth_ban(p_user_id, true);
end;
$$;


-- ===========================================================================
-- Who may call what
-- ===========================================================================
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.ops_dashboard()',
    'public.ops_search(text)',
    'public.ops_list_orders(text, text, text, date, date, int, int)',
    'public.ops_order_detail(uuid)',
    'public.ops_list_users(text, text, int, int)',
    'public.ops_user_detail(uuid)',
    'public.ops_list_providers(text, text, boolean, int, int)',
    'public.ops_provider_detail(uuid)',
    'public.ops_vehicle_detail(uuid)',
    'public.ops_list_disputes(boolean)',
    'public.ops_list_ratings(boolean, int)',
    'public.ops_list_payment_operations(text)',
    'public.ops_list_payouts(text)',
    'public.ops_finance_summary(date, date)',
    'public.ops_list_staff()',
    'public.ops_list_records(text, int)',
    'public.ops_cancel_order(uuid, text)',
    'public.ops_confirm_completion(uuid, text)',
    'public.ops_assign_provider(uuid, uuid, text)',
    'public.ops_retry_dispatch(uuid)',
    'public.ops_open_dispute(uuid, text)',
    'public.ops_resolve_dispute(uuid, text, numeric, text)',
    'public.ops_record_payment_operation(uuid, text, text, text)',
    'public.ops_set_payout_status(uuid, text, text)',
    'public.ops_set_suspension(uuid, boolean, text)',
    'public.ops_set_staff_role(uuid, text, boolean)',
    'public.ops_update_profile(uuid, text)',
    'public.ops_add_note(text, uuid, text)',
    'public.ops_force_offline(uuid, text)',
    'public.ops_set_provider_service(uuid, uuid, boolean, numeric)',
    'public.ops_set_rating_hidden(uuid, boolean, text)',
    'public.ops_revoke_report(uuid, text)',
    'public.ops_cancel_transfer(uuid, text)',
    'public.ops_annotate_vehicle(uuid, text, text)',
    'public.ops_set_vehicle_active(uuid, boolean, text)',
    'public.ops_broadcast(text, uuid, text, text, text, text)',
    'public.ops_export_user_data(uuid, text)',
    'public.ops_anonymise_user(uuid, text)',
    'public.assert_ops()',
    'public.is_super_admin()'
  ] loop
    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end
$$;
